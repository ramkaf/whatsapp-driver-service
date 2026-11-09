import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configuer, EEnvironment } from '../index.ts';
import { validateEnvironment } from '../config.validation.ts';

describe('application configuration', () => {
  beforeEach(() => {
    vi.stubEnv('MYSQL_HOST', 'localhost');
    vi.stubEnv('MYSQL_PORT', '3306');
    vi.stubEnv('MYSQL_DATABASE', 'whatsapp');
    vi.stubEnv('MYSQL_USER', 'test_user');
    vi.stubEnv('MYSQL_PASSWORD', 'test_password');
    for (const key of [
      'NODE_ENV',
      'DATABASE_URL',
      'APP_NAME',
      'APP_PORT',
      'PORT',
      'FRONTEND_DOMAIN',
      'BACKEND_DOMAIN',
      'APP_CORS_ORIGINS',
      'API_PREFIX',
      'REDIS_HOST',
      'REDIS_PORT',
      'REDIS_PASSWORD',
      'REDIS_DB',
      'REDIS_CONNECT_TIMEOUT_MS',
      'REDIS_CONNECTION_ATTEMPTS',
      'REDIS_RETRY_DELAY_MS',
      'REDIS_MAX_RETRY_DELAY_MS',
      'MINIO_ENDPOINT',
      'MINIO_PORT',
      'MINIO_USE_SSL',
      'MINIO_ACCESS_KEY',
      'MINIO_SECRET_KEY',
      'MINIO_BUCKET',
    ]) {
      vi.stubEnv(key, undefined);
    }
  });

  afterEach(() => vi.unstubAllEnvs());

  it('provides MinIO defaults and resolves environment settings', () => {
    expect(configuer().minio).toEqual({
      endpoint: '127.0.0.1',
      port: 9000,
      useSsl: false,
      accessKey: '',
      secretKey: '',
      bucket: 'whatsapp-media',
    });
    vi.stubEnv('MINIO_ENDPOINT', 'minio');
    vi.stubEnv('MINIO_PORT', '9443');
    vi.stubEnv('MINIO_USE_SSL', 'true');
    vi.stubEnv('MINIO_ACCESS_KEY', 'test-access');
    vi.stubEnv('MINIO_SECRET_KEY', 'test-secret');
    vi.stubEnv('MINIO_BUCKET', 'attachments');
    expect(configuer().minio).toEqual({
      endpoint: 'minio',
      port: 9443,
      useSsl: true,
      accessKey: 'test-access',
      secretKey: 'test-secret',
      bucket: 'attachments',
    });
    vi.stubEnv('MINIO_USE_SSL', 'false');
    expect(configuer().minio.useSsl).toBe(false);
  });

  it.each([
    ['MINIO_PORT', '0'],
    ['MINIO_PORT', '65536'],
    ['MINIO_PORT', '9000abc'],
    ['MINIO_PORT', '1.5'],
    ['MINIO_PORT', ''],
    ['MINIO_USE_SSL', 'yes'],
    ['MINIO_USE_SSL', '1'],
    ['MINIO_ENDPOINT', ''],
    ['MINIO_BUCKET', ''],
    ['MINIO_ACCESS_KEY', ''],
    ['MINIO_SECRET_KEY', ''],
  ])('rejects invalid MinIO configuration %s', (key, value) => {
    expect(() => validateEnvironment({ [key]: value })).toThrow(key);
  });

  it('provides Redis defaults and resolves numeric environment settings', () => {
    expect(configuer().redis).toEqual({
      host: '127.0.0.1',
      port: 6379,
      password: undefined,
      db: 0,
      connectTimeoutMs: 5000,
      connectionAttempts: 5,
      retryDelayMs: 1000,
      maxRetryDelayMs: 30000,
    });
    vi.stubEnv('REDIS_HOST', 'redis');
    vi.stubEnv('REDIS_PORT', '6380');
    vi.stubEnv('REDIS_DB', '2');
    vi.stubEnv('REDIS_PASSWORD', 'test-password');
    vi.stubEnv('REDIS_CONNECT_TIMEOUT_MS', '2000');
    vi.stubEnv('REDIS_CONNECTION_ATTEMPTS', '3');
    vi.stubEnv('REDIS_RETRY_DELAY_MS', '100');
    vi.stubEnv('REDIS_MAX_RETRY_DELAY_MS', '500');
    expect(configuer().redis).toEqual({
      host: 'redis',
      port: 6380,
      password: 'test-password',
      db: 2,
      connectTimeoutMs: 2000,
      connectionAttempts: 3,
      retryDelayMs: 100,
      maxRetryDelayMs: 500,
    });
  });

  it.each([
    ['REDIS_PORT', '0'],
    ['REDIS_PORT', '65536'],
    ['REDIS_PORT', '6379abc'],
    ['REDIS_DB', '-1'],
    ['REDIS_DB', '16'],
    ['REDIS_DB', '1.5'],
    ['REDIS_CONNECT_TIMEOUT_MS', '0'],
    ['REDIS_CONNECTION_ATTEMPTS', '0'],
    ['REDIS_CONNECTION_ATTEMPTS', '101'],
    ['REDIS_RETRY_DELAY_MS', ''],
    ['REDIS_MAX_RETRY_DELAY_MS', '2147483648'],
  ])('rejects invalid Redis configuration %s=%s', (key, value) => {
    expect(() => validateEnvironment({ [key]: value })).toThrow(key);
  });

  it.each([
    ['WA_MAX_SESSIONS', '51'],
    ['WA_STARTUP_CONCURRENCY', '6'],
    ['WA_WATCHDOG_INTERVAL_MS', '0'],
    ['WA_PAIRING_TTL_MS', '60001'],
    ['WA_ADMIN_API_KEY', 'short-secret'],
  ])('rejects invalid WhatsApp configuration %s', (key, value) => {
    expect(() => validateEnvironment({ [key]: value })).toThrow(key);
  });

  it('resolves a MySQL URL and rejects unsupported database protocols', () => {
    expect(configuer().databaseUrl).toBe(
      'mysql://test_user:test_password@localhost:3306/whatsapp',
    );
    expect(() =>
      validateEnvironment({ DATABASE_URL: 'postgresql://localhost/wa' }),
    ).toThrow('DATABASE_URL');
  });

  it('provides defaults when environment variables are absent', () => {
    expect(configuer()).toMatchObject({
      nodeEnv: EEnvironment.Development,
      name: 'boilerplate',
      port: 3000,
      apiPrefix: '',
      corsOrigins: ['*'],
      workingDirectory: process.cwd(),
    });
  });

  it('uses PORT as fallback and gives APP_PORT precedence, including zero', () => {
    vi.stubEnv('PORT', '4001');
    expect(configuer().port).toBe(4001);
    vi.stubEnv('APP_PORT', '0');
    expect(configuer().port).toBe(0);
  });

  it('resolves and trims CORS origins and permits an empty API prefix', () => {
    vi.stubEnv('FRONTEND_DOMAIN', 'http://localhost:5173');
    expect(configuer().corsOrigins).toEqual(['http://localhost:5173']);
    vi.stubEnv(
      'APP_CORS_ORIGINS',
      'http://localhost:5173, https://example.com, ',
    );
    vi.stubEnv('API_PREFIX', '');
    expect(configuer().corsOrigins).toEqual([
      'http://localhost:5173',
      'https://example.com',
    ]);
    expect(configuer().apiPrefix).toBe('');
  });

  it.each(['3000abc', '1.5', '-1', '65536', '', ' '])(
    'rejects invalid ports: %j',
    (port) => {
      expect(() => validateEnvironment({ APP_PORT: port })).toThrow('APP_PORT');
      expect(() => validateEnvironment({ PORT: port })).toThrow('PORT');
    },
  );

  it.each(['3306', ' 3306 ', 3306])('normalizes MySQL port %j', (port) => {
    expect(validateEnvironment({ MYSQL_PORT: port }).MYSQL_PORT).toBe(3306);
  });

  it.each(['3306abc', '1.5', '-1', '0', '65536', '', ' ', null])(
    'rejects invalid MySQL port %j',
    (port) => {
      expect(() => validateEnvironment({ MYSQL_PORT: port })).toThrow(
        'MYSQL_PORT',
      );
    },
  );

  it('rejects unknown environments and invalid domain URLs without exposing values', () => {
    expect(() => validateEnvironment({ NODE_ENV: 'invalid' })).toThrow(
      'NODE_ENV',
    );
    expect(() => validateEnvironment({ BACKEND_DOMAIN: 'invalid' })).toThrow(
      'BACKEND_DOMAIN',
    );
  });
});
