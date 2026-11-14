import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { WASocket } from '@whiskeysockets/baileys';
import type { WaSession } from '@database/client.js';
import type { PrismaService } from '../../../../libs/prisma/prisma.service.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionManagerService } from '../providers/session/session-manager.service.ts';
import { SessionRuntimeService } from '../providers/session/session-runtime.service.ts';
import { SocketLifecycleService } from '../providers/socket/socket-lifecycle.service.ts';
import { ConnectionSessionLogService } from '../providers/logging/connection-session-log.service.ts';
import type { SessionAuthentication } from '../interfaces/session-dependencies.ts';

const managers: SessionManagerService[] = [];

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  await Promise.all(
    managers.splice(0).map((manager) => manager.onModuleDestroy()),
  );
  vi.restoreAllMocks();
});

function fixture() {
  const row = {
    id: 'session-logging',
    phone: '989121234567',
    name: 'logging test',
    pairingMethod: 'QR',
    status: 'DISCONNECTED',
    isEnabled: true,
    retryCount: 0,
  } as WaSession;
  const repository = {
    require: vi.fn().mockResolvedValue(row),
    updateCurrent: vi.fn().mockResolvedValue(row),
    transition: vi.fn().mockResolvedValue(row),
    recoverable: vi.fn().mockResolvedValue([]),
    remove: vi.fn(),
    currentByPhone: vi.fn(),
    countEnabledSessions: vi.fn(),
    replaceCurrent: vi.fn(),
  };
  const auth = {
    state: { creds: { me: { id: `${row.phone}@s.whatsapp.net` } }, keys: {} },
    saveCreds: vi.fn().mockResolvedValue(undefined),
    flush: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const authentication = {
    open: vi.fn().mockResolvedValue(auth),
    clear: vi.fn(),
    hasIdentity: vi.fn().mockResolvedValue(true),
  } as unknown as SessionAuthentication;
  const socket = {
    ev: new EventEmitter(),
    ws: { isOpen: true },
    user: { id: `${row.phone}@s.whatsapp.net` },
    end: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn(),
    requestPairingCode: vi.fn().mockResolvedValue('TEST-CODE-SECRET'),
  };
  const factory = {
    create: vi.fn(() => socket as unknown as WASocket),
    release: vi.fn(),
  };
  const create = vi.fn().mockResolvedValue({});
  const logs = new ConnectionSessionLogService({
    waSessionLog: { create },
  } as unknown as PrismaService);
  const manager = new SessionManagerService(
    repository,
    authentication,
    factory,
    { next: () => 60000 },
    new ConfigService({
      WA_MAX_SESSIONS: 10,
      WA_PAIRING_TTL_MS: 60000,
      WA_PAIRING_CODE_TTL_MS: 1000,
      WA_PAIRING_RATE_LIMIT_MS: 1000,
    }),
    new SessionRuntimeService(logs),
    new SocketLifecycleService(),
    logs,
  );
  managers.push(manager);
  const records = () => create.mock.calls.map(([args]) => args.data);
  return { row, repository, factory, socket, auth, logs, manager, records };
}

describe('connection manager database logging', () => {
  it('records pairing expiry from the watchdog without a browser or a new reconnect', async () => {
    const test = fixture();
    test.row.pairingMethod = 'CODE';
    delete (test.auth.state.creds as { me?: unknown }).me;
    await test.manager.start(test.row.id);
    test.socket.ev.emit('connection.update', { connection: 'connecting' });
    await test.manager.start(test.row.id);
    const pairing = await test.manager.requestPairingCode(
      test.row.id,
      test.row.phone,
    );
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(pairing.expiresAt) + 1);

    await test.manager.inspectConnections();
    await test.manager.inspectConnections();
    await test.logs.flush();
    const expired = test
      .records()
      .filter((row) => row.event === 'pairing_code_expired');
    expect(expired).toHaveLength(1);
    expect(expired[0]).toMatchObject({
      sessionId: test.row.id,
      socketConnected: true,
      expiresAt: new Date(pairing.expiresAt),
    });
    expect(test.factory.create).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(test.records())).not.toContain('TEST-CODE-SECRET');
  });

  it('records disconnect details before teardown and a separate scheduled retry', async () => {
    const test = fixture();
    await test.manager.start(test.row.id);
    test.socket.ev.emit('connection.update', { connection: 'open' });
    await test.manager.start(test.row.id);
    const connectedAt = test.manager.snapshot(test.row.id).connectedAt;
    expect(connectedAt).not.toBeNull();

    const error = Object.assign(new Error('Connection lost'), {
      output: { statusCode: 408 },
    });
    test.socket.ws.isOpen = false;
    test.socket.ev.emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error },
    });
    await test.manager.start(test.row.id);
    await test.logs.flush();

    expect(test.records()).toContainEqual(
      expect.objectContaining({
        event: 'disconnected',
        level: 'WARN',
        sessionId: test.row.id,
        status: 'CONNECTED',
        socketConnected: false,
        connectedAt: new Date(connectedAt!),
        disconnectCode: 408,
        errorMessage: 'Connection lost',
        errorStack: error.stack,
      }),
    );
    expect(test.records()).toContainEqual(
      expect.objectContaining({
        event: 'reconnect_scheduled',
        level: 'RETRY',
        status: 'RECONNECTING',
        retryCount: 1,
        nextRetryAt: expect.any(Date),
        metadata: expect.objectContaining({ delayMs: 60000 }),
      }),
    );
    expect(test.manager.snapshot(test.row.id).status).toBe('RECONNECTING');
  });

  it('keeps the original initialization error while preserving the public failure', async () => {
    const test = fixture();
    const error = new TypeError('Socket initialization failed');
    test.factory.create.mockImplementation(() => {
      throw error;
    });
    await expect(test.manager.start(test.row.id)).rejects.toThrow(
      'Session initialization failed',
    );
    await test.logs.flush();
    expect(test.records()).toContainEqual(
      expect.objectContaining({
        event: 'session_failed',
        level: 'ERROR',
        errorName: 'TypeError',
        errorMessage: error.message,
        errorStack: error.stack,
        status: 'CONNECTING',
      }),
    );
    expect(test.records()).toContainEqual(
      expect.objectContaining({
        event: 'session_command_failed',
        level: 'EXCEPTION',
        sessionId: test.row.id,
      }),
    );
    expect(test.manager.snapshot(test.row.id).status).toBe('FAILED');
  });

  it('logs command exceptions for sessions that have no runtime yet', async () => {
    const test = fixture();
    test.row.status = 'LOGGED_OUT';
    await expect(test.manager.start(test.row.id)).rejects.toThrow(
      'Pairing is required after logout',
    );
    await test.logs.flush();
    expect(test.records()).toContainEqual(
      expect.objectContaining({
        event: 'session_command_failed',
        level: 'EXCEPTION',
        sessionId: test.row.id,
        errorName: 'ConflictException',
        socketConnected: null,
      }),
    );
  });
});
