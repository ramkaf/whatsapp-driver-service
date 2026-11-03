import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configuer, EEnvironment } from './index.ts';
import { validateEnvironment } from './config.validation.ts';

describe('application configuration', () => {
  beforeEach(() => {
    for (const key of [
      'NODE_ENV',
      'APP_NAME',
      'APP_PORT',
      'PORT',
      'FRONTEND_DOMAIN',
      'BACKEND_DOMAIN',
      'APP_CORS_ORIGINS',
      'API_PREFIX',
    ]) {
      vi.stubEnv(key, undefined);
    }
  });

  afterEach(() => vi.unstubAllEnvs());

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

  it('rejects unknown environments and invalid domain URLs without exposing values', () => {
    expect(() => validateEnvironment({ NODE_ENV: 'invalid' })).toThrow(
      'NODE_ENV',
    );
    expect(() => validateEnvironment({ BACKEND_DOMAIN: 'invalid' })).toThrow(
      'BACKEND_DOMAIN',
    );
  });
});
