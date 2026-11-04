import type { EEnvironment } from './config.enum.ts';

/** Resolved application configuration; environment variable names live in the DTO. */
export interface IAppConfig {
  redis: IRedisConfig;
  databaseUrl?: string;
  nodeEnv: EEnvironment;
  name: string;
  workingDirectory: string;
  frontendDomain?: string;
  backendDomain: string;
  corsOrigins: string[];
  port: number;
  apiPrefix: string;
}

export interface IRedisConfig {
  host: string;
  port: number;
  password?: string;
  db: number;
  connectTimeoutMs: number;
  connectionAttempts: number;
  retryDelayMs: number;
  maxRetryDelayMs: number;
}
