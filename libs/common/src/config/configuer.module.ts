import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { configuer } from './configuer.ts';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuer],
    }),
  ],
})
export class AppConfigModule {}
