import { Module } from '@nestjs/common';
import { PrismaModule, RepositoriesModule } from '@libs/prisma';

// مخزن مشترک داده‌های سشن را برای دسترسی سایر ماژول‌ها به دیتابیس فراهم می‌کند.
@Module({
  imports: [PrismaModule, RepositoriesModule],
  exports: [RepositoriesModule],
})
export class SessionDataModule {}
