import { Module } from '@nestjs/common';
import { AuthStateModule } from '../auth-state/auth-state.module.ts';
import { SessionDataModule } from '../sessions/session-data.module.ts';
import { SessionManagerService } from './session-manager/session-manager.service.ts';
import { SocketFactoryService } from './socket-factory/socket-factory.service.ts';
import { ConnectionSupervisorService } from './connection-supervisor/connection-supervisor.service.ts';
import { ConnectionHandlerService } from './connection-handler/connection-handler.service.ts';

@Module({
  imports: [AuthStateModule, SessionDataModule],
  providers: [
    SessionManagerService,
    SocketFactoryService,
    ConnectionSupervisorService,
    ConnectionHandlerService,
  ],
  exports: [SessionManagerService],
})
export class ConnectionModule {}
