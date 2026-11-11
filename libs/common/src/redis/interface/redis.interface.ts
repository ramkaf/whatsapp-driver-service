import {
  RedisOperationOptions,
  RedisSetOptions,
} from './operation-options.interface.ts';
import { RedisScoreBound } from './type.ts';

export interface IRedis {
  setPrefix(prefix: string): IRedis;
  getPrefix(): string;
  set(key: string, value: string, options?: RedisSetOptions): Promise<void>;
  get(key: string, options?: RedisOperationOptions): Promise<string | null>;
  del(key: string, options?: RedisOperationOptions): Promise<boolean>;
  exists(key: string, options?: RedisOperationOptions): Promise<boolean>; 
  hset(
    key: string,
    field: string,
    value: string,
    options?: RedisOperationOptions,
  ): Promise<number>;
  hget(
    key: string,
    field: string,
    options?: RedisOperationOptions,
  ): Promise<string | null>;
  hdel(
    key: string,
    field: string,
    options?: RedisOperationOptions,
  ): Promise<number>;
  rpush(
    key: string,
    value: string,
    options?: RedisOperationOptions,
  ): Promise<number>;
  lrange(
    key: string,
    start: number,
    stop: number,
    options?: RedisOperationOptions,
  ): Promise<string[]>;
  lrem(
    key: string,
    count: number,
    value: string,
    options?: RedisOperationOptions,
  ): Promise<number>;
  ltrim(
    key: string,
    start: number,
    stop: number,
    options?: RedisOperationOptions,
  ): Promise<void>;
  zadd(
    key: string,
    score: number,
    member: string,
    options?: RedisOperationOptions,
  ): Promise<number>;
  zrem(
    key: string,
    member: string,
    options?: RedisOperationOptions,
  ): Promise<number>;
  zremrangeByScore(
    key: string,
    min: RedisScoreBound,
    max: RedisScoreBound,
    options?: RedisOperationOptions,
  ): Promise<number>;
  zremrangeByRank(
    key: string,
    start: number,
    stop: number,
    options?: RedisOperationOptions,
  ): Promise<number>;
  zrangeByScore(
    key: string,
    min: RedisScoreBound,
    max: RedisScoreBound,
    options?: RedisOperationOptions,
  ): Promise<string[]>;
  zrange(
    key: string,
    start: number,
    stop: number,
    options?: RedisOperationOptions,
  ): Promise<string[]>;
  zrevrange(
    key: string,
    start: number,
    stop: number,
    options?: RedisOperationOptions,
  ): Promise<string[]>;
}
