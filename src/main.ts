import { configuer } from '@libs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import type { IAppConfig } from '../libs/common/src/config/index.ts';
import { PersistenceFilter } from './modules/sessions/filters/persistence.filter.ts';
import { setupSwagger } from './swagger/setup-swagger.ts';
import { Logger, ValidationPipe } from '@nestjs/common';
import { RealtimeService } from './modules/connection/providers/realtime/realtime.service.ts';
import { SessionManagerService } from './modules/connection/providers/session/session-manager.service.ts';
import { WA_SESSION_REPOSITORY, type IWaSessionRepository } from '@libs/prisma';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: new Logger(),
  });
  const config = app.get<IAppConfig>(configuer.KEY);
  app.enableShutdownHooks();
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new PersistenceFilter());
  app.setGlobalPrefix(config.apiPrefix);
  app.enableCors({
    origin: config.corsOrigins.includes('*') ? '*' : config.corsOrigins,
  });

  setupSwagger(app);
  const manager = app.get(SessionManagerService);
  const repository = app.get<IWaSessionRepository>(WA_SESSION_REPOSITORY);
  app.get(RealtimeService).attach(app.getHttpServer(), {
    exists: async (id) => {
      await repository.require(id);
    },
    snapshot: (id) => manager.snapshot(id),
  });
  await app.listen(config.port);
  const logger = new Logger('bootstrap');
  logger.log(`Application listening at ${await app.getUrl()}`);
  logger.log(`Swagger UI: ${await app.getUrl()}/docs`);
}
await bootstrap();
