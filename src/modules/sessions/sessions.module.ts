import { Module } from '@nestjs/common';
import { SessionsService } from './providers/sessions.service.ts';
import { SessionsController } from './controllers/sessions.controller.ts';
import { ConnectionModule } from '../connection/connection.module.ts';
import { PairingModule } from '../pairing/pairing.module.ts';
import { SessionDataModule } from './session-data.module.ts';
import { AdminGuard } from './guards/admin.guard.ts';

// APIهای مدیریت سشن و جفت‌سازی را همراه با سرویس‌ها و کنترل دسترسی آن‌ها فراهم می‌کند.
@Module({
  imports: [SessionDataModule, ConnectionModule, PairingModule],
  providers: [SessionsService, AdminGuard],
  controllers: [SessionsController],
  exports: [SessionsService, AdminGuard, SessionDataModule],
})
export class SessionsModule {}
