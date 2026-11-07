import { Module } from '@nestjs/common';
import { RealtimeService } from './providers/realtime.service.ts';
import { AuthStateModule } from '../auth-state/auth-state.module.ts';
import { SessionDataModule } from '../sessions/session-data.module.ts';
import { SessionManagerService } from './providers/session-manager.service.ts';
import { SocketFactoryService } from './providers/socket-factory.service.ts';
import { ConnectionSupervisorService } from './providers/connection-supervisor.service.ts';
import { ConnectionHandlerService } from './providers/connection-handler.service.ts';

// سرویس‌های ساخت سوکت، مدیریت سشن، بازیابی اتصال و انتشار رویدادهای زنده را فراهم می‌کند.
@Module({
  imports: [AuthStateModule, SessionDataModule],
  providers: [
    RealtimeService,
    SessionManagerService,
    SocketFactoryService,
    ConnectionSupervisorService,
    ConnectionHandlerService,
  ],
  exports: [SessionManagerService, RealtimeService],
})
export class ConnectionModule {}
