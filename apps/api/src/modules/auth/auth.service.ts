import { randomBytes } from 'node:crypto';

import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import {
  emailVerificationTokens,
  passwordResetTokens,
  refreshTokens,
  users,
  type DatabaseConnection,
  type User,
} from '@bokku/database';
import type { EnvConfig } from '@bokku/config';
import type { AuthResponse, AuthTokens, PublicUser } from '@bokku/shared';

import { DRIZZLE_CLIENT, ENV_CONFIG } from '../../config/constants';
import { AuditService } from '../audit/audit.module';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import type { LoginDto, RegisterDto } from './dto/auth.dto';

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const GENERIC_RESET_MESSAGE =
  'If an account exists for that email, a password reset link has been sent.';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(DRIZZLE_CLIENT) private readonly database: DatabaseConnection,
    @Inject(ENV_CONFIG) private readonly env: EnvConfig,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  // ── Registration ────────────────────────────────────────────────
  async register(dto: RegisterDto, meta: RequestMeta): Promise<AuthResponse> {
    const email = dto.email.trim().toLowerCase();
    const passwordHash = await this.passwords.hashPassword(dto.password);

    let user: User;
    try {
      const [created] = await this.database.db
        .insert(users)
        .values({
          email,
          phone: dto.phone?.trim() || null,
          passwordHash,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          role: 'CUSTOMER',
        })
        .returning();
      user = created!;
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException({
          code: 'EMAIL_ALREADY_REGISTERED',
          message: 'An account with this email already exists',
        });
      }
      throw error;
    }

    const verificationToken = await this.createEmailVerificationToken(user.id);
    await this.audit.record({
      actorUserId: user.id,
      action: 'auth.register',
      entityType: 'user',
      entityId: user.id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return {
      user: this.toPublicUser(user),
      tokens: await this.issueTokens(user, meta),
      ...this.devDebug({ emailVerificationToken: verificationToken }),
    };
  }

  // ── Login ───────────────────────────────────────────────────────
  async login(dto: LoginDto, meta: RequestMeta): Promise<AuthResponse> {
    const email = dto.email.trim().toLowerCase();
    const [user] = await this.database.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    // Always run a verify so timing doesn't reveal account existence.
    const hashToCheck = user?.passwordHash ?? (await this.passwords.getDummyHash());
    const ok = await this.passwords.verifyPassword(hashToCheck, dto.password);

    if (!user || !ok) {
      await this.audit.record({
        actorUserId: user?.id ?? null,
        action: 'auth.login.failure',
        entityType: 'user',
        entityId: user?.id,
        metadata: { email },
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      });
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Incorrect email or password',
      });
    }
    if (user.deletedAt) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Incorrect email or password',
      });
    }
    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException({
        code: 'AUTH_ACCOUNT_INACTIVE',
        message: `This account is ${user.status.toLowerCase()}`,
      });
    }

    await this.audit.record({
      actorUserId: user.id,
      action: 'auth.login.success',
      entityType: 'user',
      entityId: user.id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return { user: this.toPublicUser(user), tokens: await this.issueTokens(user, meta) };
  }

  // ── Refresh (rotation + reuse detection) ────────────────────────
  async refresh(refreshToken: string, meta: RequestMeta): Promise<AuthTokens> {
    let payload: { sub: string; jti: string };
    try {
      payload = await this.tokens.verifyRefreshToken(refreshToken);
    } catch {
      throw this.invalidRefresh();
    }

    const tokenHash = this.tokens.hashToken(refreshToken);
    const [row] = await this.database.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.id, payload.jti))
      .limit(1);

    // Token must exist and match the stored hash (defends against JWT
    // signature confusion — the database is the source of truth).
    if (!row || row.tokenHash !== tokenHash || row.expiresAt < new Date()) {
      throw this.invalidRefresh();
    }

    if (row.revokedAt) {
      // A revoked token was presented → possible theft. Kill the session chain.
      await this.revokeAllUserTokens(row.userId);
      await this.audit.record({
        actorUserId: row.userId,
        action: 'auth.refresh.reuse_detected',
        entityType: 'user',
        entityId: row.userId,
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      });
      throw new UnauthorizedException({
        code: 'REFRESH_TOKEN_REUSED',
        message: 'Session was revoked for security reasons, please log in again',
      });
    }

    const [user] = await this.database.db
      .select()
      .from(users)
      .where(eq(users.id, payload.sub))
      .limit(1);
    if (!user || user.deletedAt || user.status !== 'ACTIVE') {
      throw this.invalidRefresh();
    }

    const newRowId = crypto.randomUUID();
    const [newAccessToken, newRefreshToken] = await Promise.all([
      this.tokens.newAccessToken(user),
      this.tokens.newRefreshToken(user.id, newRowId),
    ]);

    await this.database.db.transaction(async (tx) => {
      await tx.insert(refreshTokens).values({
        id: newRowId,
        userId: user.id,
        tokenHash: this.tokens.hashToken(newRefreshToken),
        userAgent: meta.userAgent,
        ipAddress: meta.ip,
        expiresAt: this.tokens.refreshTokenExpiry(),
      });
      await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date(), replacedById: newRowId })
        .where(eq(refreshTokens.id, row.id));
    });

    return this.tokens.buildTokenResponse(newAccessToken, newRefreshToken);
  }

  // ── Logout ──────────────────────────────────────────────────────
  async logout(refreshToken: string, meta: RequestMeta): Promise<void> {
    const tokenHash = this.tokens.hashToken(refreshToken);
    const [row] = await this.database.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);
    if (row && !row.revokedAt) {
      await this.database.db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(refreshTokens.id, row.id));
      await this.audit.record({
        actorUserId: row.userId,
        action: 'auth.logout',
        entityType: 'user',
        entityId: row.userId,
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      });
    }
    // Logout is idempotent — unknown/expired tokens also succeed silently.
  }

  // ── Password reset ──────────────────────────────────────────────
  async forgotPassword(
    emailInput: string,
    meta: RequestMeta,
  ): Promise<{ message: string; debug?: { passwordResetToken: string } }> {
    const email = emailInput.trim().toLowerCase();
    const [user] = await this.database.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    // Identical response whether or not the account exists (no enumeration).
    if (!user || user.deletedAt) {
      return { message: GENERIC_RESET_MESSAGE };
    }

    const token = randomBytes(32).toString('hex');
    await this.database.db.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash: this.tokens.hashToken(token),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    });
    await this.audit.record({
      actorUserId: user.id,
      action: 'auth.password_reset.requested',
      entityType: 'user',
      entityId: user.id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    // Real email delivery arrives with the notifications module (Phase 11).
    // Until then the token is only surfaced outside production for dev/e2e.
    this.logger.log(`Password reset token for ${email}: ${token}`);
    return {
      message: GENERIC_RESET_MESSAGE,
      ...this.devDebug({ passwordResetToken: token }),
    };
  }

  async resetPassword(token: string, newPassword: string, meta: RequestMeta): Promise<void> {
    const tokenHash = this.tokens.hashToken(token);
    const [row] = await this.database.db
      .select()
      .from(passwordResetTokens)
      .where(and(eq(passwordResetTokens.tokenHash, tokenHash), isNull(passwordResetTokens.usedAt)))
      .limit(1);

    if (!row || row.expiresAt < new Date()) {
      throw new GoneException({
        code: 'RESET_TOKEN_INVALID',
        message: 'This reset link is invalid or has expired',
      });
    }

    const passwordHash = await this.passwords.hashPassword(newPassword);
    await this.database.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(users.id, row.userId));
      await tx
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(eq(passwordResetTokens.id, row.id));
      // Password changed → all existing sessions must end.
      await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.userId, row.userId), isNull(refreshTokens.revokedAt)));
    });

    await this.audit.record({
      actorUserId: row.userId,
      action: 'auth.password_reset.completed',
      entityType: 'user',
      entityId: row.userId,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  // ── Email verification ──────────────────────────────────────────
  async verifyEmail(token: string, meta: RequestMeta): Promise<{ message: string }> {
    const tokenHash = this.tokens.hashToken(token);
    const [row] = await this.database.db
      .select()
      .from(emailVerificationTokens)
      .where(
        and(
          eq(emailVerificationTokens.tokenHash, tokenHash),
          isNull(emailVerificationTokens.usedAt),
        ),
      )
      .limit(1);

    if (!row || row.expiresAt < new Date()) {
      throw new GoneException({
        code: 'VERIFICATION_TOKEN_INVALID',
        message: 'This verification link is invalid or has expired',
      });
    }

    await this.database.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
        .where(eq(users.id, row.userId));
      await tx
        .update(emailVerificationTokens)
        .set({ usedAt: new Date() })
        .where(eq(emailVerificationTokens.id, row.id));
    });

    await this.audit.record({
      actorUserId: row.userId,
      action: 'auth.email_verified',
      entityType: 'user',
      entityId: row.userId,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return { message: 'Email verified successfully' };
  }

  // ── Helpers ─────────────────────────────────────────────────────
  private async issueTokens(user: User, meta: RequestMeta): Promise<AuthTokens> {
    const rowId = crypto.randomUUID();
    const [accessToken, refreshToken] = await Promise.all([
      this.tokens.newAccessToken(user),
      this.tokens.newRefreshToken(user.id, rowId),
    ]);
    await this.database.db.insert(refreshTokens).values({
      id: rowId,
      userId: user.id,
      tokenHash: this.tokens.hashToken(refreshToken),
      userAgent: meta.userAgent,
      ipAddress: meta.ip,
      expiresAt: this.tokens.refreshTokenExpiry(),
    });
    return this.tokens.buildTokenResponse(accessToken, refreshToken);
  }

  private async createEmailVerificationToken(userId: string): Promise<string> {
    const token = randomBytes(32).toString('hex');
    await this.database.db.insert(emailVerificationTokens).values({
      userId,
      tokenHash: this.tokens.hashToken(token),
      expiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_MS),
    });
    return token;
  }

  private async revokeAllUserTokens(userId: string): Promise<void> {
    await this.database.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }

  private toPublicUser(user: User): PublicUser {
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      status: user.status,
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
    };
  }

  /** Dev-only debug payloads so flows are testable before email exists. */
  private devDebug<T extends Record<string, string>>(debug: T): { debug?: T } {
    return this.env.NODE_ENV === 'production' ? {} : { debug };
  }

  private invalidRefresh(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'REFRESH_TOKEN_INVALID',
      message: 'Your session has expired, please log in again',
    });
  }

  /** Drizzle wraps driver errors — the PG error code may live on `.cause`. */
  private isUniqueViolation(error: unknown): boolean {
    let current: unknown = error;
    while (typeof current === 'object' && current !== null) {
      if ((current as { code?: string }).code === '23505') return true;
      current = (current as { cause?: unknown }).cause;
    }
    return false;
  }
}
