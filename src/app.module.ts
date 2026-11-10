import { MessagesModule } from './modules/messages/messages.module.ts';
import { Module } from '@nestjs/common';
import { AppConfigModule, RabbitMQModule } from '@libs/common';
import { ConfigService } from '@nestjs/config';
import { AppController } from './app.controller.ts';
import { AppService } from './app.service.ts';
import { PrismaModule } from '@libs/prisma';
import { AppConfigModule, RedisModule } from '@libs/common';
import { SessionsModule } from './modules/sessions/sessions.module.js';
import { AuthStateModule } from './modules/auth-state/auth-state.module.js';
import { ConnectionModule } from './modules/connection/connection.module.js';
import { PairingModule } from './modules/pairing/pairing.module.js';
import { MonitoringModule } from './modules/monitoring/monitoring.module.js';
import { UiTestModule } from './modules/ui-test/ui-test.module.ts';
import { ScheduleModule } from '@nestjs/schedule';

// ماژول اصلی برنامه، ماژول‌های تنظیمات، زیرساخت و قابلیت‌های واتساپ را به هم متصل می‌کند.
@Module({
  imports: [
    ScheduleModule.forRoot(),
    AppConfigModule,
    RabbitMQModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        url: config.get<string>(
          'RABBITMQ_URL',
          'amqp://localhost:5672?heartbeat=30',
        ),
        topologyPath: config.get<string>(
          'RABBITMQ_TOPOLOGY_PATH',
          'config/rabbitmq.topology.json',
        ),
      }),
    }),
    PrismaModule,
  ],
  controllers: [],
  providers: [],
    PrismaModule,
    RedisModule,
    SessionsModule,
    AuthStateModule,
    ConnectionModule,
    PairingModule,
    MonitoringModule,
    UiTestModule,
    MessagesModule,
  ],
})
export class AppModule {}
