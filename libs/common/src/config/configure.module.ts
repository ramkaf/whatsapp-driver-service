import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { configure } from './configure.ts';
import { databaseConfig } from './db/database.config.ts';
import { redisConfig } from './redis/redis.config.ts';
import { minioConfig } from './minio/minio.config.ts';
import { getEnvironmentFile } from './environment-file.ts';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: getEnvironmentFile(),
      load: [configure, databaseConfig, redisConfig, minioConfig],
    }),
  ],
})
export class AppConfigModule {}
