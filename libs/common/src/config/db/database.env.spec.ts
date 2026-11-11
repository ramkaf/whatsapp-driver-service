import { describe, expect, it } from 'vitest';
import { createDatabaseUrl, readDatabaseConfig } from './database.env.ts';

const env = {
  DB_HOST: '127.0.0.1',
  DB_PORT: '3306',
  DB_USER: 'app',
  DB_PASSWORD: 'p@ss:/?#%',
  DB_NAME: 'workflow_service',
};

describe('database configuration', () => {
  it('converts numeric settings and defaults the pool size', () => {
    expect(readDatabaseConfig(env)).toMatchObject({
      port: 3306,
      connectionLimit: 10,
      allowPublicKeyRetrieval: false,
    });
  });

  it.each([
    ['true', true],
    ['false', false],
  ] as const)(
    'reads DB_ALLOW_PUBLIC_KEY_RETRIEVAL=%s as a boolean',
    (DB_ALLOW_PUBLIC_KEY_RETRIEVAL, expected) => {
      expect(
        readDatabaseConfig({ ...env, DB_ALLOW_PUBLIC_KEY_RETRIEVAL })
          .allowPublicKeyRetrieval,
      ).toBe(expected);
    },
  );

  it.each(['', '1', 'yes', 'invalid'])(
    'rejects an invalid public key retrieval setting %j',
    (DB_ALLOW_PUBLIC_KEY_RETRIEVAL) => {
      expect(() =>
        readDatabaseConfig({ ...env, DB_ALLOW_PUBLIC_KEY_RETRIEVAL }),
      ).toThrow('DB_ALLOW_PUBLIC_KEY_RETRIEVAL');
    },
  );

  it.each(['', '0', '65536', '1.5', '3306abc'])(
    'rejects invalid port %j',
    (DB_PORT) => {
      expect(() => readDatabaseConfig({ ...env, DB_PORT })).toThrow('DB_PORT');
    },
  );

  it('rejects missing credentials without exposing their values', () => {
    expect(() => readDatabaseConfig({ ...env, DB_PASSWORD: '' })).toThrow(
      'DB_PASSWORD',
    );
  });

  it('encodes credentials and uses the configured existing database', () => {
    const config = readDatabaseConfig(env);
    const primary = new URL(createDatabaseUrl(config));
    expect(decodeURIComponent(primary.password)).toBe(env.DB_PASSWORD);
    expect(primary.pathname).toBe('/workflow_service');
  });
});
