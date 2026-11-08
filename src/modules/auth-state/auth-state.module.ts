import { Module } from '@nestjs/common';
import { AuthStateService } from './providers/auth-state.service.ts';
import { PrismaModule } from '@libs/prisma';

// سرویس نگهداری اطلاعات احراز هویت واتساپ را با دسترسی به دیتابیس فراهم می‌کند.
@Module({
  imports: [PrismaModule],
  providers: [AuthStateService],
  exports: [AuthStateService],
})
export class AuthStateModule {}
