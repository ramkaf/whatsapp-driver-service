import { ConnectionMessageSource } from './interfaces/message-event-source.ts';
import { SessionRuntimeService } from './providers/session/session-runtime.service.ts';
import { SocketLifecycleService } from './providers/socket/socket-lifecycle.service.ts';
import { SocketEventRegistrarService } from './providers/socket/socket-event-registrar.service.ts';
import { Module } from '@nestjs/common';
import { RealtimeService } from './providers/realtime/realtime.service.ts';
import { AuthStateModule } from '../auth-state/auth-state.module.ts';
import { SessionDataModule } from '../sessions/session-data.module.ts';
import { SessionManagerService } from './providers/session/session-manager.service.ts';
import { SocketFactoryService } from './providers/socket/socket-factory.service.ts';
import { ConnectionSupervisorService } from './providers/recovery/connection-supervisor.service.ts';
import { ConnectionSessionLogService } from './providers/logging/connection-session-log.service.ts';

// Wires session orchestration, socket infrastructure, recovery, and realtime providers.
@Module({
  imports: [AuthStateModule, SessionDataModule],
  providers: [
    ConnectionSessionLogService,
    SessionRuntimeService,
    SocketLifecycleService,
    SocketEventRegistrarService,
    {
      provide: ConnectionMessageSource,
      useExisting: SocketEventRegistrarService,
    },
    RealtimeService,
    SessionManagerService,
    SocketFactoryService,
    ConnectionSupervisorService,
  ],
  exports: [SessionManagerService, RealtimeService, ConnectionMessageSource],
})
export class ConnectionModule {}
