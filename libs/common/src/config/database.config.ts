export function getDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const { MYSQL_HOST, MYSQL_PORT, MYSQL_DATABASE, MYSQL_USER, MYSQL_PASSWORD } =
    env;

  const requiredVariables = {
    MYSQL_HOST,
    MYSQL_PORT,
    MYSQL_DATABASE,
    MYSQL_USER,
    MYSQL_PASSWORD,
  };

  for (const [key, value] of Object.entries(requiredVariables)) {
    if (!value) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }

  const port = Number(MYSQL_PORT);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('MYSQL_PORT must be a valid port between 1 and 65535');
  }

  const credentials = `${encodeURIComponent(MYSQL_USER!)}:${encodeURIComponent(MYSQL_PASSWORD!)}`;

  const database = encodeURIComponent(MYSQL_DATABASE!);

  return `mysql://${credentials}@${MYSQL_HOST}:${port}/${database}`;
}

export function getShadowDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const {
    MYSQL_HOST,
    MYSQL_PORT,
    MYSQL_SHADOW_DATABASE,
    MYSQL_USER,
    MYSQL_PASSWORD,
  } = env;

  const requiredVariables = {
    MYSQL_HOST,
    MYSQL_PORT,
    MYSQL_SHADOW_DATABASE,
    MYSQL_USER,
    MYSQL_PASSWORD,
  };

  for (const [key, value] of Object.entries(requiredVariables)) {
    if (!value) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }

  const port = Number(MYSQL_PORT);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('MYSQL_PORT must be a valid port between 1 and 65535');
  }

  const credentials = `${encodeURIComponent(MYSQL_USER!)}:${encodeURIComponent(MYSQL_PASSWORD!)}`;

  const shadowdatabase = encodeURIComponent(MYSQL_SHADOW_DATABASE!);

  return `mysql://${credentials}@${MYSQL_HOST}:${port}/${shadowdatabase}`;
}
