import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id password hashing (OWASP-recommended parameters).
 * Hash format is self-describing ($argon2id$v=19$m=...,t=...,p=...$salt$hash)
 * so parameters can be raised later without invalidating old hashes.
 */
@Injectable()
export class PasswordService {
  /** OWASP minimum recommendations for Argon2id. */
  private static readonly OPTIONS = {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  } as const;

  /**
   * Pre-computed hash compared against when an email doesn't exist,
   * so timing doesn't reveal whether an account is registered.
   * (Dummy plaintext is irrelevant — verification just needs to fail.)
   */
  private static dummyHash: string | null = null;

  async hashPassword(plain: string): Promise<string> {
    return hash(plain, PasswordService.OPTIONS);
  }

  async verifyPassword(hashed: string, plain: string): Promise<boolean> {
    try {
      return await verify(hashed, plain);
    } catch {
      // Malformed hash — treat as mismatch, never throw to caller.
      return false;
    }
  }

  async getDummyHash(): Promise<string> {
    if (!PasswordService.dummyHash) {
      PasswordService.dummyHash = await this.hashPassword(
        `dummy-${Math.random().toString(36)}-${Date.now()}`,
      );
    }
    return PasswordService.dummyHash;
  }
}
