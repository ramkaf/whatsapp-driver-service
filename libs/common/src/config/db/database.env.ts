export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit: number;
  allowPublicKeyRetrieval: boolean;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];

  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing environment variable: ${key}`);
  }

  return value;
}

function positiveInteger(raw: string, key: string, max: number): number {
  const value = Number(raw);

  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`Invalid environment variable: ${key}`);
  }

  return value;
}

export function readDatabaseConfig(
  env: NodeJS.ProcessEnv = process.env,
): DatabaseConfig {
  const allowPublicKeyRetrieval = env.DB_ALLOW_PUBLIC_KEY_RETRIEVAL ?? 'false';
  if (!['true', 'false'].includes(allowPublicKeyRetrieval)) {
    throw new Error(
      'Invalid environment variable: DB_ALLOW_PUBLIC_KEY_RETRIEVAL',
    );
  }

  return {
    host: required(env, 'DB_HOST'),
    port: positiveInteger(required(env, 'DB_PORT'), 'DB_PORT', 65535),
    user: required(env, 'DB_USER'),
    password: required(env, 'DB_PASSWORD'),
    database: required(env, 'DB_NAME'),
    connectionLimit: positiveInteger(
      env.DB_CONNECTION_LIMIT ?? '10',
      'DB_CONNECTION_LIMIT',
      1000,
    ),
    allowPublicKeyRetrieval: allowPublicKeyRetrieval === 'true',
  };
}

export function createDatabaseUrl(config: DatabaseConfig): string {
  const url = new URL('mysql://localhost');

  url.hostname = config.host;
  url.port = String(config.port);
  url.username = encodeURIComponent(config.user);
  url.password = encodeURIComponent(config.password);
  url.pathname = `/${encodeURIComponent(config.database)}`;

  return url.toString();
}
