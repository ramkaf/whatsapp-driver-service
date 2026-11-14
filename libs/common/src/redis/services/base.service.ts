import type { Redis } from 'ioredis';
import type {
  IRedis,
  RedisConnections,
  RedisOperationOptions,
  RedisScoreBound,
  RedisSetOptions,
} from '../interface/index.ts';

/** Default namespace, database and string TTL for a Redis service. */
export interface BaseRedisDefaults {
  prefix?: string;
  db?: number;
  ttlMs?: number | null;
}

/** Common Redis operations using the configured key prefix and database. */
export abstract class BaseRedis implements IRedis {
  private readonly prefix: string;
  private readonly defaultDb: number | undefined;
  private readonly defaultTtlMs: number | null;

  protected constructor(
    private readonly connections: RedisConnections,
    defaults: BaseRedisDefaults = {},
  ) {
    this.prefix = defaults.prefix ?? '';
    this.defaultDb = defaults.db;
    this.defaultTtlMs = defaults.ttlMs ?? null;
  }
  /** Returns an independent view with the given prefix and shared connections. */
  setPrefix(prefix: string): IRedis {
    return new ScopedRedis(this.connections, {
      prefix,
      db: this.defaultDb,
      ttlMs: this.defaultTtlMs,
    });
  }
  /** Returns the current prefix. */
  getPrefix() {
    return this.prefix;
  }

  /** Builds the Redis key using the current prefix. */
  protected key(key: string): string {
    return this.prefix ? `${this.prefix}:${key}` : key;
  }

  /** Selects the connection for the requested or default database. */
  protected client(options?: RedisOperationOptions): Redis {
    return this.connections.db(options?.db ?? this.defaultDb);
  }

  /** Sets a string; TTL is in milliseconds, or null for no expiration. */
  async set(
    key: string,
    value: string,
    options?: RedisSetOptions,
  ): Promise<void> {
    const ttl =
      options?.ttlMs === undefined ? this.defaultTtlMs : options.ttlMs;
    if (ttl === null) {
      await this.client(options).set(this.key(key), value);
    } else {
      if (!Number.isSafeInteger(ttl) || ttl <= 0)
        throw new Error('ttlMs must be a positive integer or null');
      await this.client(options).set(this.key(key), value, 'PX', ttl);
    }
  }

  /** Returns a string value, or null if the key does not exist. */
  get(key: string, options?: RedisOperationOptions): Promise<string | null> {
    return this.client(options).get(this.key(key));
  }
  /** Returns whether the key exists, regardless of its Redis type. */
  async exists(key: string, options?: RedisOperationOptions): Promise<boolean> {
    return (await this.client(options).exists(this.key(key))) > 0;
  }

 

  /** Deletes an entire key of any type; returns whether it existed. */
  async del(key: string, options?: RedisOperationOptions): Promise<boolean> {
    return (await this.client(options).del(this.key(key))) > 0;
  }

  /** Sets a hash field and returns 1 if the field was added, otherwise 0. */
  hset(
    key: string,
    field: string,
    value: string,
    options?: RedisOperationOptions,
  ): Promise<number> {
    return this.client(options).hset(this.key(key), field, value);
  }

  /** Returns a hash field, or null when the key or field is absent. */
  hget(
    key: string,
    field: string,
    options?: RedisOperationOptions,
  ): Promise<string | null> {
    return this.client(options).hget(this.key(key), field);
  }

  /** Deletes a hash field and returns the number of fields removed. */
  hdel(
    key: string,
    field: string,
    options?: RedisOperationOptions,
  ): Promise<number> {
    return this.client(options).hdel(this.key(key), field);
  }

  /** Appends a value to a list and returns the resulting list length. */
  rpush(
    key: string,
    value: string,
    options?: RedisOperationOptions,
  ): Promise<number> {
    return this.client(options).rpush(this.key(key), value);
  }

  /** Returns list elements in the inclusive index range; negative indexes count from the end. */
  lrange(
    key: string,
    start: number,
    stop: number,
    options?: RedisOperationOptions,
  ): Promise<string[]> {
    return this.client(options).lrange(this.key(key), start, stop);
  }

  /** Removes matching list values; count selects direction and limit, and 0 removes all matches. */
  lrem(
    key: string,
    count: number,
    value: string,
    options?: RedisOperationOptions,
  ): Promise<number> {
    return this.client(options).lrem(this.key(key), count, value);
  }

  /** Keeps the inclusive index range of a list and deletes elements outside it. */
  async ltrim(
    key: string,
    start: number,
    stop: number,
    options?: RedisOperationOptions,
  ): Promise<void> {
    await this.client(options).ltrim(this.key(key), start, stop);
  }

  /** Adds or updates a sorted-set member; returns 1 if it was newly added, otherwise 0. */
  zadd(
    key: string,
    score: number,
    member: string,
    options?: RedisOperationOptions,
  ): Promise<number> {
    return this.client(options).zadd(this.key(key), score, member);
  }

  /** Removes a sorted-set member and returns the number of members removed. */
  zrem(
    key: string,
    member: string,
    options?: RedisOperationOptions,
  ): Promise<number> {
    return this.client(options).zrem(this.key(key), member);
  }

  /** Removes members within an inclusive score range and returns the number removed. */
  zremrangeByScore(
    key: string,
    min: RedisScoreBound,
    max: RedisScoreBound,
    options?: RedisOperationOptions,
  ): Promise<number> {
    return this.client(options).zremrangebyscore(this.key(key), min, max);
  }

  /** Removes members in an inclusive ascending-rank range and returns the number removed. */
  zremrangeByRank(
    key: string,
    start: number,
    stop: number,
    options?: RedisOperationOptions,
  ): Promise<number> {
    return this.client(options).zremrangebyrank(this.key(key), start, stop);
  }

  /** Returns sorted-set members within a score range in ascending order. */
  zrangeByScore(
    key: string,
    min: RedisScoreBound,
    max: RedisScoreBound,
    options?: RedisOperationOptions,
  ): Promise<string[]> {
    return this.client(options).zrange(
      this.key(key),
      min,
      String(max),
      'BYSCORE',
    );
  }

  /** Returns members in the inclusive ascending-rank range. */
  zrange(
    key: string,
    start: number,
    stop: number,
    options?: RedisOperationOptions,
  ): Promise<string[]> {
    return this.client(options).zrange(this.key(key), start, String(stop));
  }

  /** Returns members in the inclusive descending-rank range. */
  zrevrange(
    key: string,
    start: number,
    stop: number,
    options?: RedisOperationOptions,
  ): Promise<string[]> {
    return this.client(options).zrange(
      this.key(key),
      start,
      String(stop),
      'REV',
    );
  }
}

class ScopedRedis extends BaseRedis {
  constructor(connections: RedisConnections, defaults: BaseRedisDefaults) {
    super(connections, defaults);
  }
}
