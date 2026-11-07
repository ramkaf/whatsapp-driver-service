import { Module } from '@nestjs/common';
import { SessionsService } from './sessions/sessions.service.ts';
import { SessionsController } from './sessions/sessions.controller.ts';
import { ConnectionModule } from '../connection/connection.module.ts';
import { PairingModule } from '../pairing/pairing.module.ts';
import { SessionDataModule } from './session-data.module.ts';
import { AdminGuard } from './admin.guard.ts';

@Module({
  imports: [SessionDataModule, ConnectionModule, PairingModule],
  providers: [SessionsService, AdminGuard],
  controllers: [SessionsController],
  exports: [SessionsService, AdminGuard],
})
export class SessionsModule {}
