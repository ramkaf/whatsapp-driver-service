import { Module } from '@nestjs/common';
import { AppConfigModule } from '@libs/common';
import { AppController } from './app.controller.ts';
import { AppService } from './app.service.ts';
import { PrismaModule } from '@libs/prisma';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
