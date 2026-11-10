import { Module } from '@nestjs/common';
import { AppConfigModule, RabbitMQModule } from '@libs/common';
import { ConfigService } from '@nestjs/config';
import { AppController } from './app.controller.ts';
import { AppService } from './app.service.ts';
import { PrismaModule } from '@libs/prisma';

@Module({
  imports: [
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
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
