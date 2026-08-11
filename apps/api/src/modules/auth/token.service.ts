import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { EnvConfig } from '@bokku/config';
import type { User } from '@bokku/database';
import type { AuthTokens } from '@bokku/shared';

import { ENV_CONFIG } from '../../config/constants';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: User['role'];
}

export interface RefreshTokenPayload {
  sub: string;
  /** Refresh-token row id — enables per-session revocation. */
  jti: string;
}

/** JWT signing/verification. Access and refresh tokens use distinct secrets. */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(ENV_CONFIG) private readonly env: EnvConfig,
  ) {}

  async newAccessToken(user: Pick<User, 'id' | 'email' | 'role'>): Promise<string> {
    const payload: AccessTokenPayload = { sub: user.id, email: user.email, role: user.role };
    return this.jwt.signAsync(payload, {
      secret: this.env.JWT_SECRET,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });
  }

  async newRefreshToken(userId: string, tokenId: string): Promise<string> {
    const payload: RefreshTokenPayload = { sub: userId, jti: tokenId };
    return this.jwt.signAsync(payload, {
      secret: this.env.JWT_REFRESH_SECRET,
      expiresIn: REFRESH_TOKEN_TTL_SECONDS,
    });
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    return this.jwt.verifyAsync<AccessTokenPayload>(token, { secret: this.env.JWT_SECRET });
  }

  async verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
    return this.jwt.verifyAsync<RefreshTokenPayload>(token, {
      secret: this.env.JWT_REFRESH_SECRET,
    });
  }

  /** SHA-256 fingerprint — only hashes of tokens are ever stored. */
  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  buildTokenResponse(accessToken: string, refreshToken: string): AuthTokens {
    return {
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      tokenType: 'Bearer',
    };
  }

  refreshTokenExpiry(): Date {
    return new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);
  }
}
