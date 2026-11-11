import type { RedisOptions as RO } from 'ioredis';

export interface RedisOptions {
  redis: RO;
}

export const REDIS_OPTIONS = Symbol('REDIS_OPTIONS');