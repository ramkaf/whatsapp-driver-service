import { Module } from '@nestjs/common';
import { AppConfigModule } from '@libs/common';
import { AppController } from './app.controller.ts';
import { AppService } from './app.service.ts';

@Module({
  imports: [
    AppConfigModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
