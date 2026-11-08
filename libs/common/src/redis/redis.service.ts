import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { setTimeout as delay } from 'node:timers/promises';
import { configuer } from '../config/configuer.ts';
import type { IAppConfig, IRedisConfig } from '../config/config.interface.ts';

// اتصال Redis، تلاش‌های اتصال مجدد و بستن اتصال هنگام توقف برنامه را مدیریت می‌کند.
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;
  private readonly config: IRedisConfig;
  private started = false;
  private stopping = false;

  constructor(@Inject(configuer.KEY) config: IAppConfig) {
    this.config = config.redis;
    this.client = new Redis({
      host: this.config.host,
      port: this.config.port,
      password: this.config.password,
      db: this.config.db,
      connectTimeout: this.config.connectTimeoutMs,
      commandTimeout: this.config.connectTimeoutMs,
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: (failures) => {
        // Startup retries are awaited explicitly by the Nest lifecycle hook.
        if (!this.started || this.stopping) return null;
        if (failures >= this.config.connectionAttempts) {
          this.logger.error('Redis reconnection attempts exhausted');
          return null;
        }
        return this.retryDelay(failures);
      },
    });
    this.client.on('ready', () =>
      this.logger.log('Redis connected successfully'),
    );
    this.client.on('error', (error: NodeJS.ErrnoException) => {
      this.logger.warn(`Redis connection error (${error.code ?? error.name})`);
    });
    this.client.on('close', () => {
      if (!this.stopping) this.logger.warn('Redis connection closed');
    });
    this.client.on('reconnecting', (milliseconds: number) => {
      this.logger.warn(`Redis reconnecting in ${milliseconds}ms`);
    });
    this.client.on('end', () => {
      if (!this.stopping) this.logger.warn('Redis connection ended');
    });
  }

  private retryDelay(failures: number): number {
    const windowMs = Math.min(
      this.config.maxRetryDelayMs,
      this.config.retryDelayMs * 2 ** (failures - 1),
    );
    return Math.floor(Math.random() * windowMs);
  }

  async onModuleInit(): Promise<void> {
    for (
      let attempt = 1;
      attempt <= this.config.connectionAttempts;
      attempt++
    ) {
      this.logger.log(
        `Connecting to Redis (attempt ${attempt}/${this.config.connectionAttempts})`,
      );
      try {
        await this.client.connect();
        this.started = true;
        return;
      } catch (error) {
        // Cancel any remaining socket work before the next explicit attempt.
        this.client.disconnect();
        this.logger.warn(
          `Redis connection failed (attempt ${attempt}/${this.config.connectionAttempts})`,
        );
        if (attempt === this.config.connectionAttempts) {
          this.logger.error(
            'Redis connection attempts exhausted; startup failed',
          );
          throw error;
        }
        const milliseconds = this.retryDelay(attempt);
        this.logger.warn(`Retrying Redis connection in ${milliseconds}ms`);
        await delay(milliseconds);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    try {
      if (this.client.status === 'ready') await this.client.quit();
      this.logger.log('Redis disconnected');
    } catch (error) {
      this.logger.error('Redis disconnect failed');
      throw error;
    } finally {
      this.client.disconnect();
    }
  }
}
