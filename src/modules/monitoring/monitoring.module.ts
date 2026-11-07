import { Module } from '@nestjs/common';
import { ConnectionWatchdogService } from './connection-watchdog/connection-watchdog.service.ts';
import { ConnectionModule } from '../connection/connection.module.ts';
import { SessionsModule } from '../sessions/sessions.module.ts';
import { HealthController } from './health.controller.ts';

@Module({
  imports: [ConnectionModule, SessionsModule],
  providers: [ConnectionWatchdogService],
  controllers: [HealthController],
})
export class MonitoringModule {}
