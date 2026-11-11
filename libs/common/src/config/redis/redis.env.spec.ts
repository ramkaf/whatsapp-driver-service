import { describe, expect, it } from 'vitest';
import { readRedisConfig } from './redis.env.ts';

const validEnv = { REDIS_HOST: 'localhost', REDIS_PORT: '6379' };

describe('Redis environment configuration', () => {
  it('parses settings and defaults to database 0 without a password', () => {
    expect(readRedisConfig(validEnv)).toEqual({
      host: 'localhost',
      port: 6379,
      password: undefined,
      db: 0,
    });
    expect(
      readRedisConfig({
        ...validEnv,
        REDIS_PASSWORD: 'secret',
        REDIS_DB: '12',
      }),
    ).toEqual({ host: 'localhost', port: 6379, password: 'secret', db: 12 });
  });

  it.each(['', '0', '65536', '1.5', '6379abc', ' 6379 '])(
    'rejects invalid port %j',
    (REDIS_PORT) => {
      expect(() => readRedisConfig({ ...validEnv, REDIS_PORT })).toThrow(
        'REDIS_PORT',
      );
    },
  );

  it.each(['', '-1', '1.5', 'abc', '9007199254740992'])(
    'rejects invalid database %j',
    (REDIS_DB) => {
      expect(() => readRedisConfig({ ...validEnv, REDIS_DB })).toThrow(
        'REDIS_DB',
      );
    },
  );

  it('rejects missing or blank host and missing port', () => {
    expect(() => readRedisConfig({ ...validEnv, REDIS_HOST: ' ' })).toThrow(
      'REDIS_HOST',
    );
    expect(() => readRedisConfig({ REDIS_HOST: 'localhost' })).toThrow(
      'REDIS_PORT',
    );
  });
});
