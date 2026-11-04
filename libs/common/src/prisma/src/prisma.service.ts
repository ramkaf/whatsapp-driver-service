import { Inject, Injectable, Logger } from '@nestjs/common';
import { setTimeout as delay } from 'node:timers/promises';
import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { configuer } from '@libs/common';
import type { IAppConfig } from '@libs/common';
import { PrismaClient } from './generated/client.ts';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly connectionAttempts = 5;
  private readonly initialRetryDelayMs = 1_000;
  private readonly maxRetryDelayMs = 30_000;

  constructor(@Inject(configuer.KEY) config: IAppConfig) {
    if (!config.databaseUrl) {
      throw new Error('DATABASE_URL is required for Prisma');
    }
    super({ adapter: new PrismaMariaDb(config.databaseUrl) });
  }

  async onModuleInit(): Promise<void> {
    for (let attempt = 1; attempt <= this.connectionAttempts; attempt++) {
      this.logger.log(
        `Connecting to database (attempt ${attempt}/${this.connectionAttempts})`,
      );
      try {
        await this.$connect();
      } catch (error) {
        this.logger.warn(
          `Database connection failed (attempt ${attempt}/${this.connectionAttempts})`,
        );

        if (attempt === this.connectionAttempts) {
          this.logger.error(
            'Database connection attempts exhausted; startup failed',
          );
          throw error;
        }

        // Full jitter: choose a random delay within the exponential window.
        const windowMs = Math.min(
          this.maxRetryDelayMs,
          this.initialRetryDelayMs * 2 ** (attempt - 1),
        );
        const retryDelayMs = Math.floor(Math.random() * windowMs);
        this.logger.warn(`Retrying database connection in ${retryDelayMs}ms`);
        await delay(retryDelayMs);
        continue;
      }

      this.logger.log('Database connected successfully');
      return;
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.$disconnect();
      this.logger.log('Database disconnected');
    } catch (error) {
      this.logger.error('Database disconnect failed');
      throw error;
    }
  }
}
