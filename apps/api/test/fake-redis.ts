import type { Redis } from 'ioredis';

/**
 * Minimal in-memory Redis double for provider unit tests (get/set with the
 * `EX ttl` variant the mock providers use). Not for integration specs —
 * those run against the real Redis on db index 1.
 */
export function createFakeRedis(): Redis {
  const store = new Map<string, string>();
  return {
    get: (key: string) => Promise.resolve(store.get(key) ?? null),
    set: (
      key: string,
      value: string,
      ..._args: unknown[]
    ) => {
      store.set(key, value);
      return Promise.resolve('OK');
    },
    del: (...keys: string[]) => {
      let removed = 0;
      for (const key of keys) if (store.delete(key)) removed += 1;
      return Promise.resolve(removed);
    },
  } as unknown as Redis;
}
