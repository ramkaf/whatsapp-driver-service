import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { configuer } from './configuer.ts';
import { databaseConfig } from './db/database.config.ts';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuer, databaseConfig],
    }),
  ],
})
export class AppConfigModule {}
