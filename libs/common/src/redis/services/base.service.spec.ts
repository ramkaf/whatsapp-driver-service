import { describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { BaseRedis, type BaseRedisDefaults } from './base.service.ts';
import type { RedisConnections } from '../interface/index.ts';

class TestRedis extends BaseRedis {
  constructor(connections: RedisConnections, defaults: BaseRedisDefaults = {}) {
    super(connections, defaults);
  }
}

describe('BaseRedis', () => {
  it('isolates prefixes while reusing connections and preserving defaults', async () => {
    const set = vi.fn().mockResolvedValue('OK');
    const db = vi.fn().mockReturnValue({ set } as unknown as Redis);
    const original = new TestRedis(
      { db },
      { prefix: 'default', db: 2, ttlMs: 500 },
    );
    const users = original.setPrefix('users');
    const admins = original.setPrefix('admins');

    await Promise.all([
      users.set('1', 'a'),
      admins.set('1', 'b', { db: 3 }),
      original.set('1', 'c'),
    ]);

    expect(original.getPrefix()).toBe('default');
    expect(users.getPrefix()).toBe('users');
    expect(admins.getPrefix()).toBe('admins');
    expect(db.mock.calls.map(([index]) => index)).toEqual([2, 3, 2]);
    expect(set.mock.calls).toEqual([
      ['users:1', 'a', 'PX', 500],
      ['admins:1', 'b', 'PX', 500],
      ['default:1', 'c', 'PX', 500],
    ]);
  });

  it('uses EXISTS for keys of any type and retains the legacy alias', async () => {
    const exists = vi
      .fn()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);
    const db = vi.fn().mockReturnValue({ exists } as unknown as Redis);
    const redis = new TestRedis({ db }, { prefix: 'test' });

    expect(await redis.exists('empty-string')).toBe(true);
    expect(await redis.exists('hash', { db: 4 })).toBe(true);
    expect(await redis.exists('missing')).toBe(false);
    expect(exists.mock.calls).toEqual([
      ['test:empty-string'],
      ['test:hash'],
      ['test:missing'],
    ]);
    expect(db.mock.calls[1]).toEqual([4]);
  });
});
