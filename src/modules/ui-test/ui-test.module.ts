import { Module } from '@nestjs/common';
import { ConnectionModule } from '../connection/connection.module.ts';
import { AdminGuard } from '../sessions/guards/admin.guard.ts';
import { UiTestController } from './ui-test.controller.ts';

// صفحهٔ آزمایشی و API تصویر QR مخصوص UI را مستقل از APIهای اصلی برنامه فراهم می‌کند.
@Module({
  imports: [ConnectionModule],
  controllers: [UiTestController],
  providers: [AdminGuard],
})
export class UiTestModule {}
