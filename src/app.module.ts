import { Module } from '@nestjs/common';
import {
  AppConfigModule,
} from '@libs/common';
import { PrismaModule } from '@libs/prisma';
import { MessagesModule } from './modules/messages/messages.module.ts';
import { UiTestModule } from './modules/ui-test/ui-test.module.ts';
import { MonitoringModule } from './modules/monitoring/monitoring.module.ts';
import { PairingModule } from './modules/pairing/pairing.module.ts';
import { ConnectionModule } from './modules/connection/connection.module.ts';
import { AuthStateModule } from './modules/auth-state/auth-state.module.ts';
import { SessionsModule } from './modules/sessions/sessions.module.ts';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    AppConfigModule,
    //   RabbitMQModule.forRootAsync({
    //   inject: [ConfigService],
    //   useFactory: (config: ConfigService) => ({
    //     url: config.get<string>(
    //       'RABBITMQ_URL',
    //       'amqp://localhost:5672?heartbeat=30',
    //     ),
    //     topologyPath: config.get<string>(
    //       'RABBITMQ_TOPOLOGY_PATH',
    //       'config/rabbitmq.topology.json',
    //     ),
    //   }),
    // }),
    PrismaModule,
    ScheduleModule.forRoot(),
    AppConfigModule,
    PrismaModule,
    SessionsModule,
    AuthStateModule,
    ConnectionModule,
    PairingModule,
    MonitoringModule,
    UiTestModule,
    MessagesModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
