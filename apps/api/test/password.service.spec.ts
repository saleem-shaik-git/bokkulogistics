import { describe, expect, it } from 'vitest';

import { PasswordService } from '../src/modules/auth/password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes with Argon2id and never returns plaintext', async () => {
    const hash = await service.hashPassword('Sup3rSecret!');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain('Sup3rSecret!');
  });

  it('verifies a correct password', async () => {
    const hash = await service.hashPassword('Sup3rSecret!');
    await expect(service.verifyPassword(hash, 'Sup3rSecret!')).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await service.hashPassword('Sup3rSecret!');
    await expect(service.verifyPassword(hash, 'wrong-password')).resolves.toBe(false);
  });

  it('rejects malformed hashes without throwing', async () => {
    await expect(service.verifyPassword('not-a-hash', 'x')).resolves.toBe(false);
  });

  it('produces different hashes for the same password (salted)', async () => {
    const [a, b] = await Promise.all([
      service.hashPassword('SamePass1'),
      service.hashPassword('SamePass1'),
    ]);
    expect(a).not.toBe(b);
  });
});
