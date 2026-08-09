import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ApiResponse, AuthResponse } from '@bokku/shared';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { TEST_DATABASE_URL } from './global-setup';

/**
 * Full auth journey against a real PostgreSQL instance (bokku_test):
 * register → login → me → refresh rotation + reuse detection → logout →
 * forgot/reset password → email verification → RBAC/401 handling.
 */

interface Envelope<T> {
  status: number;
  body: ApiResponse<T> & Record<string, unknown>;
}

let app: INestApplication;
let baseUrl: string;
let adminSql: postgres.Sql;

const testUser = {
  email: 'Amara.Okafor@Example.com',
  phone: '+234 801 234 5678',
  password: 'Passw0rd!23',
  firstName: 'Amara',
  lastName: 'Okafor',
};

async function call<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {},
): Promise<Envelope<T>> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? (options.body ? 'POST' : 'GET'),
    headers: {
      'content-type': 'application/json',
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as Envelope<T>['body'] };
}

beforeAll(async () => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.NODE_ENV = 'test';
  adminSql = postgres(TEST_DATABASE_URL, { max: 2 });

  app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  await app.listen(0);
  const address = app.getHttpServer().address();
  if (typeof address === 'string' || !address) throw new Error('no address');
  baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
}, 60_000);

beforeEach(async () => {
  await adminSql`TRUNCATE users CASCADE`;
});

afterAll(async () => {
  await app?.close();
  await adminSql?.end();
});

describe('auth journey (real PostgreSQL)', () => {
  it('keeps the health endpoint public', async () => {
    const res = await call('/health');
    expect(res.status).toBe(200);
  });

  it('registers a customer and returns sanitized user + tokens', async () => {
    const res = await call<AuthResponse>('/auth/register', { body: testUser });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    const data = (res.body as { data: AuthResponse }).data;
    expect(data.user.email).toBe('amara.okafor@example.com'); // lowercased
    expect(data.user.role).toBe('CUSTOMER');
    expect('passwordHash' in data.user).toBe(false);
    expect(data.tokens.tokenType).toBe('Bearer');
    expect(data.debug?.emailVerificationToken).toBeTruthy();

    const [row] =
      await adminSql`SELECT password_hash, role FROM users WHERE email = ${'amara.okafor@example.com'}`;
    expect(row!.password_hash).toMatch(/^\$argon2id\$/);
    expect(row!.role).toBe('CUSTOMER'); // role assigned server-side, not from payload
  });

  it('rejects duplicate registration with the standard error envelope', async () => {
    await call('/auth/register', { body: testUser });
    const res = await call('/auth/register', { body: testUser });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect((res.body as { error: { code: string } }).error.code).toBe('EMAIL_ALREADY_REGISTERED');
    expect(typeof (res.body as { requestId: string }).requestId).toBe('string');
  });

  it('rejects invalid payloads with a 400 envelope', async () => {
    const res = await call('/auth/register', { body: { ...testUser, email: 'not-an-email' } });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('rejects wrong passwords with identical messaging to unknown emails', async () => {
    await call('/auth/register', { body: testUser });
    const [wrongPw, unknownEmail] = await Promise.all([
      call('/auth/login', { body: { email: testUser.email, password: 'WrongPass1' } }),
      call('/auth/login', { body: { email: 'nobody@example.com', password: 'WrongPass1' } }),
    ]);

    for (const res of [wrongPw, unknownEmail]) {
      expect(res.status).toBe(401);
      expect((res.body as { error: { code: string } }).error.code).toBe('INVALID_CREDENTIALS');
      expect((res.body as { error: { message: string } }).error.message).toBe(
        'Incorrect email or password',
      );
    }
    const strip = (body: unknown) => {
      const { requestId: _requestId, ...rest } = body as Record<string, unknown>;
      return rest;
    };
    expect(strip(wrongPw.body)).toEqual(strip(unknownEmail.body));
  });

  it('logs in, returns the profile at /auth/me, and audits the login', async () => {
    await call('/auth/register', { body: testUser });
    const login = await call<AuthResponse>('/auth/login', {
      body: { email: testUser.email, password: testUser.password },
    });
    expect(login.status).toBe(200);
    const { tokens } = (login.body as { data: AuthResponse }).data;

    const me = await call('/auth/me', { token: tokens.accessToken });
    expect(me.status).toBe(200);
    expect((me.body as { data: { email: string } }).data.email).toBe('amara.okafor@example.com');

    const audits = await adminSql`SELECT action FROM audit_logs WHERE action LIKE 'auth.login%'`;
    expect(audits.map((r) => r.action)).toEqual(['auth.login.success']);
  });

  it('rejects /auth/me without a token', async () => {
    const res = await call('/auth/me');
    expect(res.status).toBe(401);
    expect((res.body as { error: { code: string } }).error.code).toBe('AUTH_TOKEN_MISSING');
  });

  it('rotates refresh tokens and detects reuse (revokes the chain)', async () => {
    const reg = await call<AuthResponse>('/auth/register', { body: testUser });
    const { tokens } = (reg.body as { data: AuthResponse }).data;

    const rotated = await call<AuthResponse['tokens']>('/auth/refresh', {
      body: { refreshToken: tokens.refreshToken },
    });
    expect(rotated.status).toBe(200);
    const newTokens = (rotated.body as { data: AuthResponse['tokens'] }).data;
    expect(newTokens.refreshToken).not.toBe(tokens.refreshToken);

    // Reuse the OLD token → theft handling.
    const reuse = await call('/auth/refresh', { body: { refreshToken: tokens.refreshToken } });
    expect(reuse.status).toBe(401);
    expect((reuse.body as { error: { code: string } }).error.code).toBe('REFRESH_TOKEN_REUSED');

    // Chain revoked → even the legitimate replacement no longer works.
    const afterRevoke = await call('/auth/refresh', {
      body: { refreshToken: newTokens.refreshToken },
    });
    expect(afterRevoke.status).toBe(401);
  });

  it('logout revokes the refresh token', async () => {
    const reg = await call<AuthResponse>('/auth/register', { body: testUser });
    const { tokens } = (reg.body as { data: AuthResponse }).data;

    const out = await call('/auth/logout', { body: { refreshToken: tokens.refreshToken } });
    expect(out.status).toBe(200);

    const refresh = await call('/auth/refresh', { body: { refreshToken: tokens.refreshToken } });
    expect(refresh.status).toBe(401);
  });

  it('never reveals whether an email exists on forgot-password', async () => {
    const unknown = await call('/auth/forgot-password', {
      body: { email: 'ghost@example.com' },
    });
    expect(unknown.status).toBe(200);
    expect((unknown.body as { data: { debug?: unknown } }).data.debug).toBeUndefined();
  });

  it('resets the password, kills sessions, and consumes the token once', async () => {
    const reg = await call<AuthResponse>('/auth/register', { body: testUser });
    const { tokens } = (reg.body as { data: AuthResponse }).data;

    const forgot = await call<{ debug?: { passwordResetToken: string } }>('/auth/forgot-password', {
      body: { email: testUser.email },
    });
    const resetToken = (forgot.body as { data: { debug: { passwordResetToken: string } } }).data
      .debug.passwordResetToken;

    const reset = await call('/auth/reset-password', {
      body: { token: resetToken, password: 'N3wPassw0rd!' },
    });
    expect(reset.status).toBe(200);

    // Old sessions revoked.
    const oldRefresh = await call('/auth/refresh', { body: { refreshToken: tokens.refreshToken } });
    expect(oldRefresh.status).toBe(401);

    // Old password dead, new password alive.
    const oldLogin = await call('/auth/login', {
      body: { email: testUser.email, password: testUser.password },
    });
    expect(oldLogin.status).toBe(401);
    const newLogin = await call('/auth/login', {
      body: { email: testUser.email, password: 'N3wPassw0rd!' },
    });
    expect(newLogin.status).toBe(200);

    // Single-use token.
    const twice = await call('/auth/reset-password', {
      body: { token: resetToken, password: 'An0therPass!' },
    });
    expect(twice.status).toBe(410);
  });

  it('verifies the email address with the registration token', async () => {
    const reg = await call<AuthResponse>('/auth/register', { body: testUser });
    const data = (reg.body as { data: AuthResponse }).data;

    const verify = await call('/auth/verify-email', {
      body: { token: data.debug!.emailVerificationToken },
    });
    expect(verify.status).toBe(200);

    const me = await call('/auth/me', { token: data.tokens.accessToken });
    expect(
      (me.body as { data: { emailVerifiedAt: string | null } }).data.emailVerifiedAt,
    ).not.toBeNull();

    const again = await call('/auth/verify-email', {
      body: { token: data.debug!.emailVerificationToken },
    });
    expect(again.status).toBe(410);
  });

  it('lets users update only their own profile', async () => {
    const reg = await call<AuthResponse>('/auth/register', { body: testUser });
    const { tokens } = (reg.body as { data: AuthResponse }).data;

    const patch = await call('/users/me', {
      method: 'PATCH',
      token: tokens.accessToken,
      body: { firstName: 'Chiamaka' },
    });
    expect(patch.status).toBe(200);
    expect((patch.body as { data: { firstName: string } }).data.firstName).toBe('Chiamaka');
    expect((patch.body as { data: { lastName: string } }).data.lastName).toBe('Okafor');
  });
});
