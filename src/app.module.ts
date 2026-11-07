import { Module } from '@nestjs/common';
import { PrismaModule } from '@libs/prisma';
import { AppConfigModule, RedisModule } from '@libs/common';
import { SessionsModule } from './modules/sessions/sessions.module.js';
import { AuthStateModule } from './modules/auth-state/auth-state.module.js';
import { ConnectionModule } from './modules/connection/connection.module.js';
import { PairingModule } from './modules/pairing/pairing.module.js';
import { MonitoringModule } from './modules/monitoring/monitoring.module.js';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    RedisModule,
    SessionsModule,
    AuthStateModule,
    ConnectionModule,
    PairingModule,
    MonitoringModule,
  ],
})
export class AppModule {}
