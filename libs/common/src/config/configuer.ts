import { registerAs } from '@nestjs/config';
import { EEnvironment } from './config.enum.ts';
import type { IAppConfig } from './config.interface.ts';
import { validateEnvironment } from './config.validation.ts';

export const configuer = registerAs('app', (): IAppConfig => {
  const env = validateEnvironment(process.env);

  return {
    nodeEnv: env.NODE_ENV ?? EEnvironment.Development,
    name: env.APP_NAME ?? 'boilerplate',
    workingDirectory: process.cwd(),
    frontendDomain: env.FRONTEND_DOMAIN,
    backendDomain: env.BACKEND_DOMAIN ?? 'http://localhost',
    corsOrigins: (env.APP_CORS_ORIGINS || env.FRONTEND_DOMAIN || '*')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    port: env.APP_PORT ?? env.PORT ?? 3000,
    apiPrefix: env.API_PREFIX ?? '',
  };
});
