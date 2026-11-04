import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/configuer.module.ts';
import { RedisService } from './redis.service.ts';

@Module({
  imports: [AppConfigModule],
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
