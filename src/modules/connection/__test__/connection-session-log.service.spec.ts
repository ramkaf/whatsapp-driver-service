import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../../../libs/prisma/prisma.service.ts';
import {
  ConnectionSessionLogService,
  type ConnectionSessionLogRuntime,
} from '../providers/logging/connection-session-log.service.ts';

describe('ConnectionSessionLogService', () => {
  const create = vi.fn();
  let service: ConnectionSessionLogService;

  beforeEach(() => {
    create.mockReset().mockResolvedValue({ id: 'log-1' });
    service = new ConnectionSessionLogService({
      waSessionLog: { create },
    } as unknown as PrismaService);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  function record(index = 0) {
    return create.mock.calls[index]![0].data;
  }

  it('captures socket and lifecycle state before later teardown or mutation', async () => {
    const socket = { ws: { isOpen: true } };
    const runtime: ConnectionSessionLogRuntime = {
      sessionId: 'session-1',
      socket: socket as NonNullable<ConnectionSessionLogRuntime['socket']>,
      status: 'CONNECTED',
      generation: 4,
      retryCount: 2,
      connectedAt: 1700000000000,
      stateSince: 1700000000001,
      lastDisconnectedAt: 1699999999999,
      nextRetryAt: 1700000010000,
    };
    const detail = { step: 'before_teardown' };
    const logger = service.createLogger('SessionManagerService', () => runtime);
    logger.log({ sessionId: 'session-1', event: 'connected', detail });

    socket.ws.isOpen = false;
    runtime.socket = null;
    runtime.connectedAt = null;
    runtime.retryCount = 20;
    detail.step = 'after_teardown';
    await service.flush();

    expect(record()).toMatchObject({
      context: 'SessionManagerService',
      sessionId: 'session-1',
      event: 'connected',
      level: 'INFO',
      status: 'CONNECTED',
      socketConnected: true,
      generation: 4,
      retryCount: 2,
      connectedAt: new Date(1700000000000),
      stateSince: new Date(1700000000001),
      nextRetryAt: new Date(1700000010000),
      metadata: { detail: { step: 'before_teardown' } },
      expiresAt: null,
    });
  });

  it('captures a partial registrar runtime without inventing lifecycle fields', async () => {
    await service.write(
      'SocketEventRegistrarService',
      'ERROR',
      { event: 'message_consumer_failed' },
      {
        sessionId: 'session-1',
        socket: {
          ws: { isOpen: true },
        } as NonNullable<ConnectionSessionLogRuntime['socket']>,
      },
    );
    expect(record()).toMatchObject({
      sessionId: 'session-1',
      socketConnected: true,
      status: null,
      generation: null,
      retryCount: null,
      connectedAt: null,
      expiresAt: null,
    });
  });

  it('records exceptions and error details without changing warning severity', async () => {
    const logger = service.createLogger('SessionManagerService');
    const error = new TypeError('Socket initialization failed');
    logger.exception(
      { sessionId: 'session-1', event: 'session_exception' },
      error,
    );
    logger.warn({ sessionId: 'session-1', event: 'disconnected' }, error);
    await service.flush();

    expect(record()).toMatchObject({
      level: 'EXCEPTION',
      errorName: 'TypeError',
      errorMessage: 'Socket initialization failed',
      errorStack: error.stack,
    });
    expect(record(1)).toMatchObject({
      level: 'WARN',
      errorName: 'TypeError',
      errorMessage: error.message,
    });
    expect(Logger.prototype.error).toHaveBeenCalledTimes(1);
    expect(Logger.prototype.warn).toHaveBeenCalledTimes(1);
  });

  it('persists all facade levels and global failures without a session', async () => {
    const logger = service.createLogger('SessionManagerService');
    logger.log({ event: 'startup_started' });
    logger.warn({ event: 'startup_warning' });
    logger.error({ event: 'startup_recovery_failed' });
    logger.exception(
      { event: 'startup_exception' },
      new Error('Recovery failed'),
    );
    logger.retry({
      sessionId: 'session-1',
      event: 'reconnect_scheduled',
      delayMs: 500,
    });
    await service.flush();

    expect(create.mock.calls.map(([call]) => call.data.level)).toEqual([
      'INFO',
      'WARN',
      'ERROR',
      'EXCEPTION',
      'RETRY',
    ]);
    expect(record()).toMatchObject({
      sessionId: null,
      status: null,
      socketConnected: null,
      connectedAt: null,
    });
    expect(record(4).metadata.delayMs).toBe(500);
  });

  it('stores pairing deadlines while redacting QR, codes and credentials', async () => {
    const runtime: ConnectionSessionLogRuntime = {
      sessionId: 'session-1',
      pairingMethod: 'CODE' as ConnectionSessionLogRuntime['pairingMethod'],
      code: { value: 'PAIRING-CODE-SECRET', expiresAt: 1700000180000 },
      qr: { value: 'QR-AUTHENTICATION-SECRET', expiresAt: 1700000060000 },
    };
    await service.write(
      'SessionManagerService',
      'EXCEPTION',
      {
        event: 'pairing_exception',
        message: 'Failed using PAIRING-CODE-SECRET',
        qr: 'QR-AUTHENTICATION-SECRET',
        code: 'PAIRING-CODE-SECRET',
        auth: { creds: 'CREDENTIAL-SECRET' },
        detail: {
          token: 'TOKEN-SECRET',
          password: 'PASSWORD-SECRET',
          context: 'Bearer BEARER-SECRET',
          url: 'mysql://user:URL-SECRET@localhost/app',
        },
      },
      runtime,
      new Error('Failed using QR-AUTHENTICATION-SECRET'),
    );

    const saved = record();
    expect(saved).toMatchObject({
      expiresAt: new Date(1700000180000),
      qrExpiresAt: new Date(1700000060000),
      codeExpiresAt: new Date(1700000180000),
    });
    const serialized = JSON.stringify(saved);
    for (const value of [
      'PAIRING-CODE-SECRET',
      'QR-AUTHENTICATION-SECRET',
      'CREDENTIAL-SECRET',
      'TOKEN-SECRET',
      'PASSWORD-SECRET',
      'BEARER-SECRET',
      'URL-SECRET',
    ])
      expect(serialized).not.toContain(value);
    expect(saved.message).toBe('Failed using [REDACTED]');
    expect(saved.errorMessage).toBe('Failed using [REDACTED]');
  });

  it('serializes cyclic metadata, big integers and binary values safely', async () => {
    const cyclic: Record<string, unknown> = {
      number: 12n,
      binary: Buffer.from('secret'),
    };
    cyclic.self = cyclic;
    await service.write('SessionManagerService', 'INFO', {
      event: 'safe_metadata',
      cyclic,
      enormous: 'x'.repeat(100000),
    });

    expect(record().metadata.cyclic).toEqual({
      number: '12',
      binary: '[BINARY]',
      self: '[CIRCULAR]',
    });
    expect(record().metadata.enormous.length).toBeLessThanOrEqual(8192);
  });

  it('omits Prisma invocation arguments from database and console exception details', async () => {
    const message = [
      'Invalid `prisma.waAuthCreds.upsert()` invocation in',
      '/app/src/modules/auth-state/store.ts:42:11',
      '',
      '  await prisma.waAuthCreds.upsert({',
      '    create: {',
      '      creds: {',
      '        noiseKey: { private: Buffer.from("noise-private-credential") },',
      '        signedIdentityKey: { private: Buffer.from("identity-private-credential") },',
      '        signedPreKey: { keyPair: { private: "signed-key-private" } }',
      '      }',
      '    }',
      '  })',
      'Unique constraint failed on session_id',
    ].join('\n');
    const error = Object.assign(new Error(message), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
    });
    error.stack = `${error.name}: ${message}\n    at persistCredentials (/app/src/modules/auth-state/store.ts:42:11)\n    at async save (/app/src/session.ts:18:7)`;
    service.createLogger('SessionManagerService').exception(
      {
        sessionId: 'session-1',
        event: 'auth_persistence_failed',
        failure: error,
        detail: message,
      },
      error,
    );
    await service.flush();

    expect(record()).toMatchObject({
      level: 'EXCEPTION',
      errorName: 'PrismaClientKnownRequestError',
      errorMessage:
        'Prisma operation failed (P2002); invocation details omitted.',
      metadata: {
        errorCode: 'P2002',
        failure: {
          name: 'PrismaClientKnownRequestError',
          code: 'P2002',
        },
      },
    });
    expect(record().errorStack).toContain(
      'at persistCredentials (/app/src/modules/auth-state/store.ts:42:11)',
    );
    const persisted = JSON.stringify(record());
    const consoleOutput = JSON.stringify(
      vi.mocked(Logger.prototype.error).mock.calls,
    );
    for (const forbidden of [
      'noise-private-credential',
      'identity-private-credential',
      'signed-key-private',
      'Buffer.from',
      'noiseKey',
      'signedIdentityKey',
      'creds: {',
      'Invalid `prisma.waAuthCreds.upsert()` invocation',
    ]) {
      expect(persisted).not.toContain(forbidden);
      expect(consoleOutput).not.toContain(forbidden);
    }
  });

  it('omits credential-bearing blocks in generic exceptions and ordinary text fields', async () => {
    const message =
      'Authentication persistence failed: {"creds":{"noiseKey":{"private":"generic-private-credential"},"signedIdentityKey":{"private":"generic-identity-credential"}}}';
    const error = Object.assign(new Error(message), {
      code: 'AUTH_SAVE_FAILED',
    });
    error.stack = `Error: ${message}\n    at save (/app/src/auth-state.ts:20:9)`;
    await service.write(
      'SessionManagerService',
      'EXCEPTION',
      {
        event: 'auth_persistence_failed',
        message,
        failure: error,
      },
      undefined,
      error,
    );

    expect(record().errorName).toBe('Error');
    expect(record().errorMessage).toBe(
      'Exception details omitted because they contain authentication material.',
    );
    expect(record().errorStack).toContain(
      'at save (/app/src/auth-state.ts:20:9)',
    );
    expect(record().metadata.errorCode).toBe('AUTH_SAVE_FAILED');
    expect(record().message).toBe('[Credential details omitted]');
    for (const value of [
      'generic-private-credential',
      'generic-identity-credential',
    ]) {
      expect(JSON.stringify(record())).not.toContain(value);
      expect(
        JSON.stringify(vi.mocked(Logger.prototype.error).mock.calls),
      ).not.toContain(value);
    }
  });

  it('drains pending writes on shutdown and absorbs persistence failures', async () => {
    let finish!: () => void;
    create.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    service.createLogger('SessionManagerService').log({ event: 'shutdown' });
    let drained = false;
    const drain = service.onApplicationShutdown().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    finish();
    await drain;
    expect(drained).toBe(true);

    create.mockRejectedValueOnce(new Error('Database unavailable'));
    await expect(
      service.write('SessionManagerService', 'INFO', { event: 'connected' }),
    ).resolves.toBeUndefined();
    await expect(service.flush()).resolves.toBeUndefined();
    expect(create).toHaveBeenCalledTimes(2);
    expect(Logger.prototype.error).toHaveBeenCalledExactlyOnceWith({
      event: 'session_log_write_failed',
      sessionId: null,
      source: 'SessionManagerService',
    });
  });
});
