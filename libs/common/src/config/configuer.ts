import { registerAs } from '@nestjs/config';
import { EEnvironment } from './config.enum.ts';
import type { IAppConfig } from './config.interface.ts';
import { validateEnvironment } from './config.validation.ts';
import { getDatabaseUrl } from './database.config.ts';

export const configuer = registerAs('app', (): IAppConfig => {
  const env = validateEnvironment(process.env);

  return {
    whatsapp: {
      adminApiKey: env.WA_ADMIN_API_KEY ?? '',
      maxSessions: env.WA_MAX_SESSIONS ?? 50,
      startupConcurrency: env.WA_STARTUP_CONCURRENCY ?? 2,
      startupStaggerMs: env.WA_STARTUP_STAGGER_MS ?? 500,
      watchdogIntervalMs: env.WA_WATCHDOG_INTERVAL_MS ?? 30000,
      connectionStuckMs: env.WA_CONNECTION_STUCK_MS ?? 120000,
      stableConnectionMs: env.WA_STABLE_CONNECTION_MS ?? 60000,
      pairingTtlMs: env.WA_PAIRING_TTL_MS ?? 60000,
      pairingCodeTtlMs: env.WA_PAIRING_CODE_TTL_MS ?? 180000,
      pairingRateLimitMs: env.WA_PAIRING_RATE_LIMIT_MS ?? 30000,
    },
    redis: {
      host: env.REDIS_HOST ?? '127.0.0.1',
      port: env.REDIS_PORT ?? 6379,
      password: env.REDIS_PASSWORD || undefined,
      db: env.REDIS_DB ?? 0,
      connectTimeoutMs: env.REDIS_CONNECT_TIMEOUT_MS ?? 5_000,
      connectionAttempts: env.REDIS_CONNECTION_ATTEMPTS ?? 5,
      retryDelayMs: env.REDIS_RETRY_DELAY_MS ?? 1_000,
      maxRetryDelayMs: env.REDIS_MAX_RETRY_DELAY_MS ?? 30_000,
    },
    minio: {
      endpoint: env.MINIO_ENDPOINT!,
      port: env.MINIO_PORT!,
      useSsl: env.MINIO_USE_SSL!,
      accessKey: env.MINIO_ACCESS_KEY!,
      secretKey: env.MINIO_SECRET_KEY!,
      bucket: env.MINIO_BUCKET!,
    },
    databaseUrl: getDatabaseUrl(env as unknown as NodeJS.ProcessEnv),
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
