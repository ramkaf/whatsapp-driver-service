import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { configure } from './configure.ts';
import { databaseConfig } from './db/database.config.ts';
import { redisConfig } from './redis/redis.config.ts';
import { minioConfig } from './minio/minio.config.ts';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configure, databaseConfig, redisConfig, minioConfig],
    }),
  ],
})
export class AppConfigModule {}
