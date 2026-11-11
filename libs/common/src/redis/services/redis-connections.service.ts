import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { setTimeout as delay } from 'node:timers/promises';
import { REDIS_OPTIONS, type RedisOptions } from '../redis.types.ts';
import type { RedisConnections } from '../interface/index.ts';

@Injectable()
export class RedisConnectionsService
  implements RedisConnections, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(RedisConnectionsService.name);
  private readonly clients = new Map<number, Redis>();

  constructor(@Inject(REDIS_OPTIONS) private readonly options: RedisOptions) {}

  async onModuleInit(): Promise<void> {
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const probe = new Redis({
        ...this.options.redis,
        lazyConnect: true,
        retryStrategy: null,
        enableOfflineQueue: false,
      });
      probe.on('error', () => {});
      try {
        await probe.connect();
        await probe.ping();
        this.logger.log('REDIS_CONNECTED');
        return;
      } catch (error) {
        if (attempt === maxAttempts) {
          this.logger.error(
            `REDIS_CONNECTION_FAILED after ${maxAttempts} attempts`,
          );
          throw error;
        }
        const retryDelay = Math.min(1000 * 2 ** (attempt - 1), 10000);
        this.logger.warn(
          `REDIS_CONNECTION_RETRY attempt=${attempt} delayMs=${retryDelay}`,
        );
      } finally {
        probe.disconnect();
      }
      await delay(Math.min(1000 * 2 ** (attempt - 1), 10000));
    }
  }

  db(index = this.options.redis.db ?? 0): Redis {
    if (!Number.isInteger(index) || index < 0) {
      throw new Error('Redis DB must be a non-negative integer');
    }
    const existing = this.clients.get(index);
    if (existing) return existing;

    const client = new Redis({
      ...this.options.redis,
      db: index,
      maxRetriesPerRequest: 5,
      retryStrategy: (attempt) => {
        if (attempt > 5) return null;
        const retryDelay = Math.min(1000 * 2 ** (attempt - 1), 10000);
        this.logger.warn(
          `REDIS_RECONNECT db=${index} attempt=${attempt} delayMs=${retryDelay}`,
        );
        return retryDelay;
      },
    });
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
