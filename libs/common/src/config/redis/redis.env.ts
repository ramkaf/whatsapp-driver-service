export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db: number;
}

export function readRedisConfig(
  env: NodeJS.ProcessEnv = process.env,
): RedisConfig {
  const host = env.REDIS_HOST?.trim();
  if (!host) throw new Error('Missing environment variable: REDIS_HOST');

  const rawPort = env.REDIS_PORT;
  if (rawPort === undefined || !/^\d+$/.test(rawPort)) {
    throw new Error('Invalid environment variable: REDIS_PORT');
  }
  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid environment variable: REDIS_PORT');
  }

  const rawDb = env.REDIS_DB ?? '0';
  if (!/^\d+$/.test(rawDb) || !Number.isSafeInteger(Number(rawDb))) {
    throw new Error('Invalid environment variable: REDIS_DB');
  }

  return {
    host,
    port,
    password: env.REDIS_PASSWORD || undefined,
    db: Number(rawDb),
  };
}
