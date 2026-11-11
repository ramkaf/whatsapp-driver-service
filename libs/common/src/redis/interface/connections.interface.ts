import { Redis } from 'ioredis';

export interface RedisConnections {
  db(index?: number): Redis;
}
