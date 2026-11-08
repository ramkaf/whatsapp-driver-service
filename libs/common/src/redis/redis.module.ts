import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/configuer.module.ts';
import { RedisService } from './redis.service.ts';

// سرویس اتصال Redis را همراه با تنظیمات موردنیاز در اختیار ماژول‌های دیگر قرار می‌دهد.
@Module({
  imports: [AppConfigModule],
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
