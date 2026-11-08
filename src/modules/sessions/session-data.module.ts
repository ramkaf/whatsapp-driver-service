import { Module } from '@nestjs/common';
import { PrismaModule } from '@libs/prisma';
import { SessionRepository } from './session.repository.ts';

// مخزن مشترک داده‌های سشن را برای دسترسی سایر ماژول‌ها به دیتابیس فراهم می‌کند.
@Module({
  imports: [PrismaModule],
  providers: [SessionRepository],
  exports: [SessionRepository],
})
export class SessionDataModule {}
