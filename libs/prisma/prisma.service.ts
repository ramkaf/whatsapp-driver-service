import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { setTimeout as delay } from 'node:timers/promises';

import type { DatabaseConfig } from '@libs/common';
import { PrismaClient } from '@database/client.js';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService) {
    const database = config.getOrThrow<DatabaseConfig>('database');
    const adapter = new PrismaMariaDb({
      host: database.host,
      port: database.port,
      user: database.user,
      password: database.password,
      database: database.database,
      connectionLimit: database.connectionLimit,
      allowPublicKeyRetrieval: true
    });

    super({ adapter, log: ['warn', 'error'] });
  }

  async onModuleInit(): Promise<void> {
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.$connect();
        // Check the selected database, not only whether the pool can be created.
        await this.$queryRaw`SELECT 1`;
        this.logger.log('DB_CONNECTED');
        return;
      } catch (error) {
        if (attempt === maxAttempts) {
          this.logger.error(
            `DB_CONNECTION_FAILED after ${maxAttempts} attempts`,
          );
          await this.$disconnect();
          throw error;
        }
        const retryDelay = Math.min(1000 * 2 ** (attempt - 1), 10000);
        this.logger.warn(
          `DB_CONNECTION_RETRY attempt=${attempt} delayMs=${retryDelay}`,
        );
        await delay(retryDelay);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('DB_CONNECTION_CLOSED');
  }
}
