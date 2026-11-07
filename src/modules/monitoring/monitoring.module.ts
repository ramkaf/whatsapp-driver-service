import { Module } from '@nestjs/common';
import { ConnectionWatchdogService } from './providers/connection-watchdog.service.ts';
import { ConnectionModule } from '../connection/connection.module.ts';
import { SessionsModule } from '../sessions/sessions.module.ts';
import { HealthController } from './controllers/health.controller.ts';

// پایش دوره‌ای اتصال سشن‌ها و API سلامت برنامه را فراهم می‌کند.
@Module({
  imports: [ConnectionModule, SessionsModule],
  providers: [ConnectionWatchdogService],
  controllers: [HealthController],
})
export class MonitoringModule {}
