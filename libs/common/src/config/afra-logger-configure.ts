import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { getEnvironmentFile } from './environment-file.ts';

export const afraLoggerConfigure = () => {
  const envFile = getEnvironmentFile();
  if (existsSync(envFile)) {
    loadEnvFile(envFile);
  }

  const serverUrl = process.env.ELASTIC_APM_SERVER_URL?.trim();

  return {
    active: Boolean(serverUrl),
    serviceName: process.env.ELASTIC_APM_SERVICE_NAME,
    serverUrl: serverUrl || 'http://localhost:8200',
    secretToken: process.env.ELASTIC_APM_SECRET_TOKEN,
  };
};
