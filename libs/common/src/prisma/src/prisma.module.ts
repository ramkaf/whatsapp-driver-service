import { Module } from '@nestjs/common';
import { AppConfigModule } from '@libs/common';
import { PrismaService } from './prisma.service.ts';

// سرویس Prisma و وابستگی تنظیمات اتصال دیتابیس را برای ماژول‌های دیگر فراهم می‌کند.
@Module({
  imports: [AppConfigModule],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
