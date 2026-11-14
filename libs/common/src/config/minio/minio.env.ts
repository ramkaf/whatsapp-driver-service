export interface MinioConfig {
  endpoint: string;
  port: number;
  useSsl?: boolean;
  accessKey: string;
  secretKey: string;
  bucket: string;
}

export function readMinioConfig(
  env: NodeJS.ProcessEnv = process.env,
): MinioConfig {
  const endpoint = env.MINIO_ENDPOINT?.trim();
  if (!endpoint)
    throw new Error('Missing environment variable: MINIO_ENDPOINT');
  const rawPort = env.MINIO_PORT?.trim();
  const port = Number(rawPort);
  if (
    !rawPort ||
    !/^\d+$/.test(rawPort) ||
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error('Invalid environment variable: MINIO_PORT');
  }
  const accessKey = env.MINIO_ACCESS_KEY?.trim();
  if (!accessKey)
    throw new Error('Missing environment variable: MINIO_ACCESS_KEY');
  const secretKey = env.MINIO_SECRET_KEY?.trim();
  if (!secretKey)
    throw new Error('Missing environment variable: MINIO_SECRET_KEY');
  const bucket = env.MINIO_BUCKET?.trim();
  if (!bucket) throw new Error('Missing environment variable: MINIO_BUCKET');
  const useSsl = env.MINIO_USE_SSL?.trim().toLowerCase();
  if (useSsl !== undefined && useSsl !== 'true' && useSsl !== 'false') {
    throw new Error('Invalid environment variable: MINIO_USE_SSL');
  }
  return {
    endpoint,
    port,
    useSsl: useSsl === 'true',
    accessKey,
    secretKey,
    bucket,
  };
}
