import { validateSync } from 'class-validator';
import { EnvironmentVariablesValidator } from './config.dto.ts';

export function validateEnvironment(
  env: Record<string, unknown>,
): EnvironmentVariablesValidator {
  const variables = Object.assign(new EnvironmentVariablesValidator(), env);

  for (const key of [
    'WA_MAX_SESSIONS',
    'WA_MAX_RETRIES',
    'WA_STARTUP_CONCURRENCY',
    'WA_STARTUP_STAGGER_MS',
    'WA_WATCHDOG_INTERVAL_MS',
    'WA_CONNECTION_STUCK_MS',
    'WA_STABLE_CONNECTION_MS',
    'WA_PAIRING_TTL_MS',
    'WA_PAIRING_CODE_TTL_MS',
    'WA_PAIRING_RATE_LIMIT_MS',
    'APP_PORT',
    'PORT',
    'MYSQL_PORT',
    'REDIS_PORT',
    'REDIS_DB',
    'REDIS_CONNECT_TIMEOUT_MS',
    'REDIS_CONNECTION_ATTEMPTS',
    'REDIS_RETRY_DELAY_MS',
    'REDIS_MAX_RETRY_DELAY_MS',
  ] as const) {
    if (env[key] !== undefined) {
      const value = env[key];
      variables[key] =
        typeof value === 'number'
          ? value
          : typeof value === 'string' && value.trim() !== ''
            ? Number(value)
            : Number.NaN;
    }
  }

  const errors = validateSync(variables);
  if (errors.length > 0) {
    const details = errors.map(
      (error) =>
        `${error.property}: ${Object.values(error.constraints ?? {}).join(', ')}`,
    );
    throw new Error(
      `Invalid environment configuration:\n${details.join('\n')}`,
    );
  }

  return variables;
}
