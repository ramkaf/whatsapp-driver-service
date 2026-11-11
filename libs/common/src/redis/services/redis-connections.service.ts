import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_OPTIONS, type RedisOptions } from '../redis.types.ts';
import type { RedisConnections } from '../interface/index.ts';

@Injectable()
export class RedisConnectionsService
  implements RedisConnections, OnModuleDestroy
{
  private readonly logger = new Logger(RedisConnectionsService.name);
  private readonly clients = new Map<number, Redis>();

  constructor(@Inject(REDIS_OPTIONS) private readonly options: RedisOptions) {}

  db(index = this.options.redis.db ?? 0): Redis {
    if (!Number.isInteger(index) || index < 0) {
      throw new Error('Redis DB must be a non-negative integer');
    }
    const existing = this.clients.get(index);
    if (existing) return existing;

    const client = new Redis({ ...this.options.redis, db: index });
    client.on('error', (error: Error) => {
      this.logger.error(`Redis DB ${index}: ${error.message}`);
    });
    this.clients.set(index, client);
    return client;
  }

  onModuleDestroy(): void {
    for (const client of this.clients.values()) client.disconnect();
    this.clients.clear();
  }
}
