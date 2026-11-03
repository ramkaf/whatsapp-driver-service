import type { EEnvironment } from './config.enum.ts';

/** Resolved application configuration; environment variable names live in the DTO. */
export interface IAppConfig {
  nodeEnv: EEnvironment;
  name: string;
  workingDirectory: string;
  frontendDomain?: string;
  backendDomain: string;
  corsOrigins: string[];
  port: number;
  apiPrefix: string;
}
