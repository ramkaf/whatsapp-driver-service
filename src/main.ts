import { configure, AfraLogger, InitAfraLogger } from '@libs/common';
InitAfraLogger();
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.ts';
import type { IAppConfig } from '../libs/common/src/config/index.ts';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // logger: new AfraLogger(),
  });
  app.enableShutdownHooks();
  const config = app.get<IAppConfig>(configure.KEY);
  app.setGlobalPrefix(config.apiPrefix);
  app.enableCors({
    origin: config.corsOrigins.includes('*') ? '*' : config.corsOrigins,
  });
  await app.listen(config.port);
  const logger = new Logger('bootstrap');
  logger.log('test', await app.getUrl());
}
await bootstrap();
