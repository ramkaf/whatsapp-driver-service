import { PairingMethodEnum } from '../../sessions/interfaces/session.interface.ts';
import type { MockInstance } from 'vitest';
import type {
  SessionPersistence,
  SessionAuthentication,
  SessionSocketFactory,
} from '../interfaces/session-dependencies.ts';
import * as disconnectClassifier from '../utils/disconnect-classifier.util.ts';
import { SessionRuntimeService } from '../providers/session/session-runtime.service.ts';
import { SocketLifecycleService } from '../providers/socket/socket-lifecycle.service.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Logger, NotFoundException } from '@nestjs/common';
import { DisconnectReason } from '@whiskeysockets/baileys';
import type {
  AuthenticationState,
  WASocket,
  ConnectionState,
} from '@whiskeysockets/baileys';
import type { IAppConfig } from '@libs/common';
import type { WaSession } from '@database/client.js';
import { SessionManagerService } from '../providers/session/session-manager.service.ts';
import { ConnectionSupervisorService } from '../providers/recovery/connection-supervisor.service.ts';
import type { AuthContext } from '../../auth-state/context/auth-state.context.ts';

vi.mock('node:timers/promises', () => ({
  setTimeout: (
    milliseconds: number,
    value?: unknown,
    options?: { signal?: AbortSignal },
  ) =>
    new Promise((resolve, reject) => {
      if (options?.signal?.aborted) {
        reject(new Error('Aborted'));
        return;
      }
      const abort = () => {
        clearTimeout(timer);
        reject(new Error('Aborted'));
      };
      const timer = setTimeout(() => {
        options?.signal?.removeEventListener('abort', abort);
        resolve(value);
      }, milliseconds);
      options?.signal?.addEventListener('abort', abort, { once: true });
    }),
}));

const config = {
  whatsapp: {
    maxSessions: 50,
    startupConcurrency: 2,
    startupStaggerMs: 500,
    pairingTtlMs: 60000,
    pairingCodeTtlMs: 180000,
    pairingRateLimitMs: 30000,
    connectionStuckMs: 120000,
    stableConnectionMs: 60000,
  },
} as IAppConfig;
function row(id: string, data: Partial<WaSession> = {}): WaSession {
  return {
    id,
    name: id,
    phone: '989121234567',
    status: 'DISCONNECTED',
    isEnabled: true,
    supersededAt: null,
    pairingMethod: PairingMethodEnum.QR,
    retryCount: 0,
    lastConnectedAt: null,
    lastDisconnectedAt: null,
    lastDisconnectCode: null,
    lastError: null,
    lastHeartbeatAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...data,
  };
}
function socket() {
  return {
    ev: new EventEmitter(),
    ws: { isOpen: true },
    end: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    requestPairingCode: vi.fn().mockResolvedValue('ABCD1234'),
  };
}

describe('SessionManagerService', () => {
  let manager: SessionManagerService;
  let loggerError: MockInstance;
  let rows: Map<string, WaSession>;
  let sockets: ReturnType<typeof socket>[];
  let contexts: AuthContext[];
  let authenticated: Set<string>;
  let repository: {
    require: ReturnType<typeof vi.fn>;
    updateCurrent: ReturnType<typeof vi.fn>;
    transition: ReturnType<typeof vi.fn>;
    recoverable: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    currentByPhone: ReturnType<typeof vi.fn>;
    countEnabledSessions: ReturnType<typeof vi.fn>;
    replaceCurrent: ReturnType<typeof vi.fn>;
  };
  let authStore: {
    hasIdentity: ReturnType<typeof vi.fn>;
    open: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
  };
  let factory: {
    create: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
  };
  const settle = () => vi.advanceTimersByTimeAsync(0);
  const event = async (index: number, update: Partial<ConnectionState>) => {
    sockets[index]!.ev.emit('connection.update', update);
    await settle();
  };
  const close = (code: DisconnectReason): Partial<ConnectionState> => ({
    connection: 'close',
    lastDisconnect: {
      date: new Date(),
      error: Object.assign(new Error('Disconnect'), {
        output: { statusCode: code },
      }),
    },
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    loggerError = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    rows = new Map([['one', row('one')]]);
    sockets = [];
    contexts = [];
    authenticated = new Set();
    const update = vi.fn(async (id: string, data: Partial<WaSession>) =>
      Object.assign(rows.get(id)!, data),
    );
    repository = {
      require: vi.fn(async (id: string) => {
        const value = rows.get(id);
        if (!value || value.supersededAt)
          throw new NotFoundException('Session not found');
        return { ...value };
      }),
      currentByPhone: vi.fn(
        async (phone: string) =>
          [...rows.values()].find(
            (value) => value.phone === phone && !value.supersededAt,
          ) ?? null,
      ),
      countEnabledSessions: vi.fn(
        async () =>
          [...rows.values()].filter(
            (value) => value.isEnabled && !value.supersededAt,
          ).length,
      ),
      replaceCurrent: vi.fn(
        async (data: Pick<WaSession, 'name' | 'phone' | 'pairingMethod'>) => {
          for (const value of rows.values()) {
            if (value.phone === data.phone && !value.supersededAt) {
              value.isEnabled = false;
              value.supersededAt = new Date();
            }
          }
          const next = row('new-' + rows.size, data);
          rows.set(next.id, next);
          return next;
        },
      ),
      updateCurrent: update,
      transition: vi.fn(async (id: string, data: Partial<WaSession>) =>
        update(id, data),
      ),
      recoverable: vi.fn(async () =>
        [...rows.values()].filter(
          (value) =>
            value.isEnabled &&
            !value.supersededAt &&
            (!['LOGGED_OUT', 'FAILED', 'EXPIRED'].includes(value.status) ||
              (value.status === 'FAILED' &&
                value.lastError === 'Reconnect threshold reached')),
        ),
      ),
      remove: vi.fn(async (id: string) => rows.delete(id)),
    };
    authStore = {
      hasIdentity: vi.fn(async (id: string) => authenticated.has(id)),
      open: vi.fn(async (id: string) => {
        const context: AuthContext = {
          state: {
            creds: {
              registered: authenticated.has(id),
              ...(authenticated.has(id)
                ? { me: { id: '989121234567:1@s.whatsapp.net' } }
                : {}),
            },
            keys: {},
          } as AuthenticationState,
          saveCreds: vi.fn().mockResolvedValue(undefined),
          flush: vi.fn().mockResolvedValue(undefined),
          close: vi.fn().mockResolvedValue(undefined),
        };
        contexts.push(context);
        return context;
      }),
      clear: vi.fn(async (id: string) => {
        authenticated.delete(id);
      }),
    };
    factory = {
      release: vi.fn(),
      create: vi.fn(() => {
        const next = socket();
        sockets.push(next);
        return next as unknown as WASocket;
      }),
    };
    manager = new SessionManagerService(
      repository as unknown as SessionPersistence,
      authStore as unknown as SessionAuthentication,
      factory as unknown as SessionSocketFactory,
      new ConnectionSupervisorService(),
      config,
      new SessionRuntimeService(),
      new SocketLifecycleService(),
    );
  });
  afterEach(async () => {
    await manager.onModuleDestroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('replaces a number at capacity, closes its old socket and rejects obsolete IDs', async () => {
    await manager.start('one');
    await event(0, { connection: 'open' });
    const next = await manager.replace(
      {
        name: 'replacement',
        phone: '989121234567',
        pairingMethod: PairingMethodEnum.CODE,
      },
      1,
    );
    expect(rows.get('one')).toMatchObject({
      isEnabled: false,
      supersededAt: expect.any(Date),
    });
    expect(rows.get(next.id)).toMatchObject({
      isEnabled: true,
      supersededAt: null,
    });
    expect(sockets[0]!.end).toHaveBeenCalledOnce();
    expect(factory.release).toHaveBeenCalledWith(sockets[0]);
    expect(factory.create).toHaveBeenCalledTimes(2);
    expect(factory.create.mock.calls[0]![3]()).toBe(false);
    expect(manager.snapshot('one').connected).toBe(false);
    await expect(manager.restart('one')).rejects.toThrow('Session not found');
    await expect(
      manager.preparePairing('one', PairingMethodEnum.QR),
    ).rejects.toThrow('Session not found');
    expect(authStore.clear).not.toHaveBeenCalled();
  });

  it('restores the previous socket if creating its replacement rolls back', async () => {
    await manager.start('one');
    repository.replaceCurrent.mockRejectedValueOnce(new Error('insert failed'));
    await expect(
      manager.replace(
        {
          name: 'replacement',
          phone: '989121234567',
          pairingMethod: PairingMethodEnum.QR,
        },
        1,
      ),
    ).rejects.toThrow('insert failed');
    expect(rows.get('one')).toMatchObject({
      isEnabled: true,
      supersededAt: null,
    });
    expect(factory.create).toHaveBeenCalledTimes(2);
    expect(manager.snapshot('one').status).toBe('CONNECTING');
    expect(authStore.clear).not.toHaveBeenCalled();
  });

  it('does not revive a terminal failure if its replacement cannot be created', async () => {
    await manager.start('one');
    await event(0, close(DisconnectReason.forbidden));
    repository.replaceCurrent.mockRejectedValueOnce(new Error('insert failed'));
    await expect(
      manager.replace(
        {
          name: 'replacement',
          phone: '989121234567',
          pairingMethod: PairingMethodEnum.QR,
        },
        1,
      ),
    ).rejects.toThrow('insert failed');
    expect(factory.create).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60000);
    expect(factory.create).toHaveBeenCalledOnce();
  });

  it('does not retire a current session if authentication cleanup fails', async () => {
    await manager.start('one');
    vi.mocked(contexts[0]!.close).mockRejectedValueOnce(
      new Error('flush failed'),
    );
    await expect(
      manager.replace(
        {
          name: 'replacement',
          phone: '989121234567',
          pairingMethod: PairingMethodEnum.QR,
        },
        1,
      ),
    ).rejects.toThrow('replacement aborted');
    expect(repository.replaceCurrent).not.toHaveBeenCalled();
    expect(rows.get('one')!.supersededAt).toBeNull();
    expect(factory.create).toHaveBeenCalledOnce();
  });

  it('prevents a queued reconnect from reviving the old version and cancels its retry', async () => {
    await manager.start('one');
    await event(0, close(DisconnectReason.connectionLost));
    const replacing = manager.replace(
      {
        name: 'replacement',
        phone: '989121234567',
        pairingMethod: PairingMethodEnum.QR,
      },
      1,
    );
    const restarting = expect(manager.restart('one')).rejects.toThrow(
      'Session not found',
    );
    await Promise.all([replacing, restarting]);
    await vi.advanceTimersByTimeAsync(120000);
    expect(factory.create).toHaveBeenCalledTimes(2);
  });

  it('checks capacity before closing any existing socket for a different number', async () => {
    await manager.start('one');
    await expect(
      manager.replace(
        {
          name: 'another account',
          phone: '989131234567',
          pairingMethod: PairingMethodEnum.QR,
        },
        1,
      ),
    ).rejects.toThrow('Session limit reached');
    expect(sockets[0]!.end).not.toHaveBeenCalled();
    expect(repository.replaceCurrent).not.toHaveBeenCalled();
  });

  it('handles connecting and open updates without classifying a disconnect', async () => {
    authenticated.add('one');
    await manager.start('one');
    const classify = vi.spyOn(disconnectClassifier, 'classifyDisconnect');

    await event(0, { connection: 'connecting' });
    await event(0, { connection: 'open' });

    expect(manager.snapshot('one').connected).toBe(true);
    expect(classify).not.toHaveBeenCalled();
  });

  it('recovers a close update that has no disconnect error', async () => {
    await manager.start('one');
    const classify = vi.spyOn(disconnectClassifier, 'classifyDisconnect');

    await event(0, { connection: 'close' });

    expect(classify).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(manager.snapshot('one')).toMatchObject({
      status: 'RECONNECTING',
      reason: 'UNKNOWN_CLOSE',
      lastDisconnectCode: null,
    });
  });

  it('classifies the original error from a close update', async () => {
    await manager.start('one');
    const classify = vi.spyOn(disconnectClassifier, 'classifyDisconnect');
    const update = close(DisconnectReason.loggedOut);

    await event(0, update);

    expect(classify).toHaveBeenCalledExactlyOnceWith(
      update.lastDisconnect!.error,
    );
    expect(manager.snapshot('one')).toMatchObject({
      status: 'LOGGED_OUT',
      reason: 'LOGGED_OUT',
    });
  });

  it('prevents simultaneous requests from creating duplicate sockets', async () => {
    await Promise.all([
      manager.start('one'),
      manager.start('one'),
      manager.start('one'),
    ]);
    expect(factory.create).toHaveBeenCalledOnce();
  });

  it('restores persisted authentication and confirms open only with identity', async () => {
    authenticated.add('one');
    rows.get('one')!.status = 'CONNECTED';
    await manager.start('one');
    expect(manager.snapshot('one').connected).toBe(false);
    await event(0, { connection: 'open' });
    expect(manager.snapshot('one').connected).toBe(true);
    expect(rows.get('one')!.phone).toBe('989121234567');
    expect(contexts[0]!.saveCreds).toHaveBeenCalled();
  });

  it('reads account phone from the live socket instead of the session record', async () => {
    expect(manager.snapshot('one').accountPhone).toBeNull();
    authenticated.add('one');
    await manager.start('one');
    await event(0, { connection: 'open' });
    // No identity on the socket: the database phone must not be a fallback.
    expect(manager.snapshot('one').accountPhone).toBeNull();
    Object.assign(sockets[0]!, {
      user: { id: '989189876543:12@s.whatsapp.net' },
    });
    expect(manager.snapshot('one').accountPhone).toBe('989189876543');
    Object.assign(sockets[0]!, { user: { id: '266391353573408@lid' } });
    expect(manager.snapshot('one').accountPhone).toBeNull();
    Object.assign(sockets[0]!, { user: { id: '989189876543@s.whatsapp.net' } });
    sockets[0]!.ws.isOpen = false;
    expect(manager.snapshot('one').accountPhone).toBeNull();
  });

  it('captures QR refreshes, scopes them to a session and expires them', async () => {
    await manager.start('one');
    await event(0, { qr: 'first-secret' });
    expect(manager.pairing('one').qr).toBe('first-secret');
    expect(manager.pairing('other').qr).toBeNull();
    await event(0, { qr: 'second-secret' });
    expect(manager.pairing('one').qr).toBe('second-secret');
    await vi.advanceTimersByTimeAsync(60001);
    expect(manager.pairing('one').qr).toBeNull();
  });

  it('waits for readiness before generating a code and reuses the valid code', async () => {
    await manager.preparePairing('one', PairingMethodEnum.CODE, '989121234567');
    const pending = manager.requestPairingCode('one', '989121234567');
    expect(sockets[0]!.requestPairingCode).not.toHaveBeenCalled();
    await event(0, { qr: 'hidden-qr' });
    await vi.advanceTimersByTimeAsync(50);
    expect((await pending).code).toBe('ABCD1234');
    expect(manager.pairing('one').qr).toBeNull();
    expect((await manager.requestPairingCode('one', '989121234567')).code).toBe(
      'ABCD1234',
    );
    expect(sockets[0]!.requestPairingCode).toHaveBeenCalledOnce();
    expect(manager.snapshot('one').connected).toBe(false);
  });

  it('reports a closed live socket before its close event is handled', async () => {
    authenticated.add('one');
    await manager.start('one');
    await event(0, { connection: 'open' });
    sockets[0]!.ws.isOpen = false;
    expect(manager.snapshot('one')).toMatchObject({
      status: 'DISCONNECTED',
      connected: false,
      reason: 'SOCKET_CLOSED',
      requiresPairing: false,
    });
  });

  it('reports an expired pairing code without treating it as account logout', async () => {
    await manager.preparePairing('one', PairingMethodEnum.CODE, '989121234567');
    await event(0, { qr: 'hidden-qr' });
    await manager.requestPairingCode('one', '989121234567');
    await vi.advanceTimersByTimeAsync(config.whatsapp.pairingCodeTtlMs + 1);
    expect(manager.snapshot('one')).toMatchObject({
      status: 'EXPIRED',
      reason: 'PAIRING_CODE_EXPIRED',
      requiresPairing: true,
      lastDisconnectCode: null,
    });
    expect(authStore.clear).not.toHaveBeenCalled();
  });

  it('persists pairing, clears secrets and performs a controlled restartRequired', async () => {
    await manager.start('one');
    await event(0, { qr: 'secret' });
    sockets[0]!.ev.emit('creds.update', {
      me: { id: '989121234567:1@s.whatsapp.net' },
    });
    authenticated.add('one');
    await event(0, { isNewLogin: true });
    expect(manager.pairing('one').qr).toBeNull();
    expect(manager.snapshot('one').status).toBe('AUTHENTICATING');
    await event(0, close(DisconnectReason.restartRequired));
    await vi.advanceTimersByTimeAsync(250);
    expect(factory.create).toHaveBeenCalledTimes(2);
    await event(1, { connection: 'open' });
    expect(manager.snapshot('one').connected).toBe(true);
    expect(authStore.clear).not.toHaveBeenCalled();
  });

  it('reconnects after network failure and resets counters only after a stable connection', async () => {
    authenticated.add('one');
    await manager.start('one');
    await event(0, { connection: 'open' });
    await event(0, close(DisconnectReason.connectionLost));
    expect(manager.snapshot('one')).toMatchObject({
      reason: 'TIMEOUT_OR_CONNECTION_LOST',
      lastDisconnectCode: 408,
      requiresPairing: false,
    });
    expect(manager.snapshot('one').retryCount).toBe(1);
    await vi.advanceTimersByTimeAsync(750);
    expect(factory.create).toHaveBeenCalledTimes(2);
    await event(1, { connection: 'open' });
    expect(manager.snapshot('one').retryCount).toBe(1);
    expect(manager.snapshot('one').reason).toBeNull();
    await vi.advanceTimersByTimeAsync(60000);
    await manager.inspectConnections();
    expect(manager.snapshot('one').retryCount).toBe(0);
  });

  it.each([
    DisconnectReason.loggedOut,
    DisconnectReason.connectionReplaced,
    DisconnectReason.badSession,
    DisconnectReason.multideviceMismatch,
    DisconnectReason.forbidden,
  ])(
    'does not retry or delete credentials after terminal disconnect %s',
    async (code) => {
      authenticated.add('one');
      await manager.start('one');
      await event(0, close(code));
      await vi.advanceTimersByTimeAsync(120000);
      expect(factory.create).toHaveBeenCalledOnce();
      expect(authStore.clear).not.toHaveBeenCalled();
      expect(['LOGGED_OUT', 'FAILED']).toContain(
        manager.snapshot('one').status,
      );
      expect(manager.snapshot('one').lastDisconnectCode).toBe(code);
      expect(manager.snapshot('one').requiresPairing).toBe(
        code === DisconnectReason.loggedOut ||
          code === DisconnectReason.badSession ||
          code === DisconnectReason.multideviceMismatch,
      );
    },
  );

  it('retries transient failures during initial pairing and expires only exhausted QR references', async () => {
    await manager.start('one');
    await event(0, close(DisconnectReason.timedOut));
    expect(manager.snapshot('one').status).toBe('RECONNECTING');
    await vi.advanceTimersByTimeAsync(750);
    const expired = close(DisconnectReason.timedOut);
    expired.lastDisconnect!.error!.message = 'QR refs attempts ended';
    await event(1, expired);
    expect(manager.snapshot('one').status).toBe('EXPIRED');
    expect(manager.snapshot('one')).toMatchObject({
      reason: 'QR_EXPIRED',
      requiresPairing: true,
    });
    await vi.advanceTimersByTimeAsync(120000);
    expect(factory.create).toHaveBeenCalledTimes(2);
  });

  it.each([
    DisconnectReason.connectionLost,
    DisconnectReason.connectionClosed,
    DisconnectReason.unavailableService,
  ])(
    'keeps recovering after a long temporary outage with code %s',
    async (code) => {
      authenticated.add('one');
      await manager.start('one');
      for (let index = 0; index < 20; index++) {
        await event(index, close(code));
        const snapshot = manager.snapshot('one');
        const delay = Date.parse(snapshot.nextRetryAt!) - Date.now();
        expect(snapshot.status).toBe('RECONNECTING');
        expect(snapshot.retryCount).toBe(index + 1);
        expect(delay).toBeGreaterThanOrEqual(500);
        expect(delay).toBeLessThanOrEqual(60000);
        await vi.advanceTimersByTimeAsync(delay - 1);
        expect(factory.create).toHaveBeenCalledTimes(index + 1);
        await vi.advanceTimersByTimeAsync(1);
        expect(factory.create).toHaveBeenCalledTimes(index + 2);
      }
      await event(20, { connection: 'open' });
      expect(manager.snapshot('one').connected).toBe(true);
      expect(manager.snapshot('one').retryCount).toBe(20);
      await vi.advanceTimersByTimeAsync(config.whatsapp.stableConnectionMs);
      await manager.inspectConnections();
      expect(manager.snapshot('one').retryCount).toBe(0);
      expect(authStore.clear).not.toHaveBeenCalled();
    },
  );

  it('backs off repeated protocol restarts without exhausting recovery', async () => {
    authenticated.add('one');
    await manager.start('one');
    let previousDelay = 0;
    for (let index = 0; index < 20; index++) {
      await event(index, close(DisconnectReason.restartRequired));
      const snapshot = manager.snapshot('one');
      const delay = Date.parse(snapshot.nextRetryAt!) - Date.now();
      expect(snapshot.status).toBe('RECONNECTING');
      expect(delay).toBeLessThanOrEqual(60000);
      if (index === 0) expect(delay).toBe(250);
      else expect(delay).toBeGreaterThanOrEqual(previousDelay);
      expect(factory.create).toHaveBeenCalledTimes(index + 1);
      await vi.advanceTimersByTimeAsync(delay);
      previousDelay = delay;
    }
    expect(factory.create).toHaveBeenCalledTimes(21);
    expect(manager.snapshot('one')).toMatchObject({
      status: 'CONNECTING',
      retryCount: 20,
    });
    expect(authStore.clear).not.toHaveBeenCalled();
  });

  it('rate limits repeated unsuccessful pairing code requests', async () => {
    await manager.preparePairing('one', PairingMethodEnum.CODE, '989121234567');
    await event(0, { qr: 'secret' });
    sockets[0]!.requestPairingCode.mockRejectedValueOnce(
      new Error('Not ready'),
    );
    await expect(
      manager.requestPairingCode('one', '989121234567'),
    ).rejects.toThrow('Unable to request');
    await expect(
      manager.requestPairingCode('one', '989121234567'),
    ).rejects.toThrow('rate limited');
    expect(sockets[0]!.requestPairingCode).toHaveBeenCalledOnce();
  });

  it('never creates a pairing socket for already-paired stored credentials', async () => {
    authenticated.add('one');
    await expect(
      manager.preparePairing('one', PairingMethodEnum.QR),
    ).rejects.toThrow('use reconnect');
    expect(factory.create).not.toHaveBeenCalled();
  });

  it('only clears known-invalid credentials after an explicit new pairing request', async () => {
    authenticated.add('one');
    await manager.start('one');
    await event(0, close(DisconnectReason.loggedOut));
    expect(authStore.clear).not.toHaveBeenCalled();
    await manager.preparePairing('one', PairingMethodEnum.QR);
    expect(authStore.clear).toHaveBeenCalledWith('one');
    expect(factory.create).toHaveBeenCalledTimes(2);
  });

  it('ignores events from stale generations', async () => {
    authenticated.add('one');
    await manager.start('one');
    const stale = sockets[0]!.ev.listeners('connection.update')[0]!;
    await manager.restart('one');
    await event(1, { connection: 'open' });
    stale(close(DisconnectReason.loggedOut));
    await settle();
    expect(manager.snapshot('one').status).toBe('CONNECTED');
    expect(sockets[1]!.end).not.toHaveBeenCalled();
  });

  it('cancels retries on manual disconnect and preserves authentication', async () => {
    authenticated.add('one');
    await manager.start('one');
    await event(0, close(DisconnectReason.connectionLost));
    await manager.stop('one');
    expect(manager.snapshot('one')).toMatchObject({
      status: 'DISCONNECTED',
      reason: 'MANUAL_DISCONNECT',
      requiresPairing: false,
    });
    await vi.advanceTimersByTimeAsync(120000);
    expect(factory.create).toHaveBeenCalledOnce();
    expect(rows.get('one')!.isEnabled).toBe(false);
    expect(authStore.clear).not.toHaveBeenCalled();
  });

  it('stops and retains credentials when an authentication write fails', async () => {
    await manager.start('one');
    const onFailure = authStore.open.mock.calls[0]![1] as () => void;
    onFailure();
    await settle();
    expect(manager.snapshot('one').status).toBe('FAILED');
    expect(sockets[0]!.end).toHaveBeenCalled();
    expect(authStore.clear).not.toHaveBeenCalled();
  });

  it('stops safely even if persisting the disconnect event fails after generation fencing', async () => {
    authenticated.add('one');
    await manager.start('one');
    repository.transition.mockRejectedValueOnce(
      new Error('Database unavailable'),
    );
    await event(0, close(DisconnectReason.connectionLost));
    expect(manager.snapshot('one').status).toBe('FAILED');
    expect(manager.snapshot('one').nextRetryAt).toBeNull();
  });

  it('uses bounded staggered startup recovery and runs it only once', async () => {
    rows.set('two', row('two'));
    rows.set('three', row('three'));
    rows.set('disabled', row('disabled', { isEnabled: false }));
    await manager.onApplicationBootstrap();
    await settle();
    expect(factory.create).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(factory.create).toHaveBeenCalledTimes(2);
    // A third handshake must wait for one of the first two to reach pairing/open.
    await event(0, { qr: 'first' });
    await vi.advanceTimersByTimeAsync(600);
    expect(factory.create).toHaveBeenCalledTimes(3);
    await event(1, { qr: 'second' });
    await event(2, { qr: 'third' });
    await manager.onApplicationBootstrap();
    expect(repository.recoverable).toHaveBeenCalledOnce();
  });

  it('restores legacy retry exhaustion without restoring terminal or disabled sessions', async () => {
    rows.clear();
    rows.set(
      'legacy',
      row('legacy', {
        status: 'FAILED',
        retryCount: 25,
        lastError: 'Reconnect threshold reached',
      }),
    );
    rows.set(
      'invalid',
      row('invalid', {
        status: 'FAILED',
        lastDisconnectCode: DisconnectReason.badSession,
        lastError: 'Connection closed: invalid',
      }),
    );
    rows.set(
      'disabled',
      row('disabled', {
        isEnabled: false,
        status: 'FAILED',
        lastError: 'Reconnect threshold reached',
      }),
    );
    rows.set('logged-out', row('logged-out', { status: 'LOGGED_OUT' }));
    rows.set('expired', row('expired', { status: 'EXPIRED' }));
    authenticated.add('legacy');

    await manager.onApplicationBootstrap();
    await settle();
    expect(factory.create).toHaveBeenCalledOnce();
    expect(factory.create.mock.calls[0]![0]).toBe('legacy');
    expect(manager.snapshot('legacy').retryCount).toBe(25);
    await event(0, { connection: 'open' });
    expect(manager.snapshot('legacy').connected).toBe(true);
    expect(authStore.clear).not.toHaveBeenCalled();
  });

  it('does not restart an idle but healthy socket and bounds repeated watchdog recovery', async () => {
    authenticated.add('one');
    await manager.start('one');
    await event(0, { connection: 'open' });
    await vi.advanceTimersByTimeAsync(300000);
    await manager.inspectConnections();
    expect(factory.create).toHaveBeenCalledOnce();
    sockets[0]!.ws.isOpen = false;
    await Promise.all([
      manager.inspectConnections(),
      manager.inspectConnections(),
    ]);
    expect(manager.snapshot('one').retryCount).toBe(1);
    await vi.advanceTimersByTimeAsync(750);
    expect(factory.create).toHaveBeenCalledTimes(2);
  });

  it('logs out remotely only on explicit request and deletes auth after confirmation', async () => {
    authenticated.add('one');
    await manager.start('one');
    await event(0, { connection: 'open' });
    await manager.logout('one');
    expect(sockets[0]!.logout).toHaveBeenCalledOnce();
    expect(authStore.clear).toHaveBeenCalledWith('one');
    expect(rows.get('one')!.status).toBe('LOGGED_OUT');
  });

  it('retains authentication when remote logout fails', async () => {
    authenticated.add('one');
    await manager.start('one');
    await event(0, { connection: 'open' });
    sockets[0]!.logout.mockRejectedValueOnce(new Error('Network unavailable'));
    await expect(manager.logout('one')).rejects.toThrow(
      'authentication retained',
    );
    expect(authStore.clear).not.toHaveBeenCalled();
    expect(rows.get('one')!.isEnabled).toBe(false);
  });

  it('shuts down without logout, flushes auth and never recreates sockets', async () => {
    await manager.start('one');
    await manager.onModuleDestroy();
    expect(sockets[0]!.end).toHaveBeenCalled();
    expect(sockets[0]!.logout).not.toHaveBeenCalled();
    expect(contexts[0]!.close).toHaveBeenCalledOnce();
    await expect(manager.start('one')).rejects.toThrow('shutting down');
  });
  it('respects disabled sessions and explicitly enables a manual start', async () => {
    Object.assign(rows.get('one')!, { isEnabled: false, retryCount: 2 });
    await manager.start('one');
    expect(factory.create).not.toHaveBeenCalled();
    await manager.start('one', true);
    expect(rows.get('one')).toMatchObject({ isEnabled: true, retryCount: 0 });
    expect(manager.snapshot('one').retryCount).toBe(0);
    expect(factory.create).toHaveBeenCalledOnce();
  });

  it('enforces the session limit without allocating another socket', async () => {
    for (let index = 0; index < config.whatsapp.maxSessions; index++) {
      const id = 'session-' + index;
      rows.set(id, row(id));
      await manager.start(id);
    }
    await expect(manager.start('one')).rejects.toThrow('Session limit reached');
    expect(factory.create).toHaveBeenCalledTimes(config.whatsapp.maxSessions);
  });

  it.each(['start', 'restart'] as const)(
    'rejects %s after logout',
    async (action) => {
      rows.get('one')!.status = 'LOGGED_OUT';
      await expect(manager[action]('one')).rejects.toThrow(
        'Pairing is required',
      );
      expect(factory.create).not.toHaveBeenCalled();
    },
  );

  it('rejects restart and pairing during shutdown', async () => {
    await manager.onModuleDestroy();
    await expect(manager.restart('one')).rejects.toThrow('shutting down');
    await expect(
      manager.preparePairing('one', PairingMethodEnum.QR),
    ).rejects.toThrow('shutting down');
    await manager.onApplicationBootstrap();
    expect(repository.recoverable).not.toHaveBeenCalled();
  });

  it.each(['authentication', 'socket'])(
    'stops safely when %s initialization fails',
    async (failure) => {
      if (failure === 'authentication')
        authStore.open.mockRejectedValueOnce(new Error('auth'));
      else
        factory.create.mockImplementationOnce(() => {
          throw new Error('socket');
        });
      await expect(manager.start('one')).rejects.toThrow(
        'Session initialization failed',
      );
      expect(manager.snapshot('one')).toMatchObject({
        status: 'FAILED',
        reason: 'INTERNAL_ERROR',
        nextRetryAt: null,
      });
      expect(authStore.clear).not.toHaveBeenCalled();
      if (failure === 'socket')
        expect(contexts[0]!.close).toHaveBeenCalledOnce();
    },
  );

  it('closes authentication opened after shutdown began without creating a socket', async () => {
    const open = authStore.open.getMockImplementation() as (
      id: string,
    ) => Promise<AuthContext>;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    authStore.open.mockImplementationOnce(async (id: string) => {
      await gate;
      return open(id);
    });
    const starting = manager.start('one');
    await settle();
    const stopping = manager.onModuleDestroy();
    release();
    await Promise.all([starting, stopping]);
    expect(factory.create).not.toHaveBeenCalled();
    expect(contexts[0]!.close).toHaveBeenCalledOnce();
  });

  it('ignores stale credential listeners after a restart', async () => {
    await manager.start('one');
    const stale = sockets[0]!.ev.listeners('creds.update')[0]!;
    await manager.restart('one');
    stale({ registered: true });
    await settle();
    expect(contexts[0]!.saveCreds).not.toHaveBeenCalled();
    expect(contexts[1]!.state.creds.registered).toBe(false);
  });

  it('rechecks generation when an event reaches the queue after restart', async () => {
    await manager.start('one');
    const emitter = sockets[0]!.ev;
    const restarting = manager.restart('one');
    emitter.emit('connection.update', close(DisconnectReason.loggedOut));
    await restarting;
    await settle();
    expect(manager.snapshot('one').status).toBe('CONNECTING');
    expect(sockets[1]!.end).not.toHaveBeenCalled();
  });

  it('stops on credential save rejection and reports failure persistence errors', async () => {
    await manager.start('one');
    vi.mocked(contexts[0]!.saveCreds).mockRejectedValueOnce(new Error('write'));
    repository.transition.mockRejectedValueOnce(new Error('database'));
    sockets[0]!.ev.emit('creds.update', { registered: true });
    await settle();
    expect(manager.snapshot('one').status).toBe('FAILED');
    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'failure_state_write_failed' }),
    );
    expect(authStore.clear).not.toHaveBeenCalled();
  });

  it('reports connection event persistence failures without unhandled rejections', async () => {
    await manager.start('one');
    repository.transition.mockRejectedValue(new Error('database'));
    await event(0, close(DisconnectReason.connectionLost));
    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'connection_event_failed' }),
    );
    expect(manager.snapshot('one').status).toBe('FAILED');
  });

  it('handles cleanup failure while entering the failed state', async () => {
    await manager.start('one');
    vi.mocked(contexts[0]!.close).mockRejectedValueOnce(new Error('flush'));
    const onFailure = authStore.open.mock.calls[0]![1] as () => void;
    onFailure();
    await settle();
    expect(manager.snapshot('one').status).toBe('FAILED');
    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'cleanup_failed' }),
    );
  });

  it('does not duplicate a reconnect while one is scheduled and reports failed recreation', async () => {
    await manager.start('one');
    await event(0, close(DisconnectReason.connectionLost));
    await manager.start('one');
    expect(factory.create).toHaveBeenCalledOnce();
    factory.create.mockImplementationOnce(() => {
      throw new Error('socket');
    });
    await vi.advanceTimersByTimeAsync(750);
    expect(manager.snapshot('one').status).toBe('FAILED');
    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'reconnect_failed' }),
    );
  });

  it.each(['missing identity', 'invalid phone', 'different phone'])(
    'rejects an open socket with %s',
    async (scenario) => {
      if (scenario !== 'missing identity') authenticated.add('one');
      await manager.start('one');
      if (scenario === 'invalid phone')
        contexts[0]!.state.creds.me!.id = 'invalid@s.whatsapp.net';
      if (scenario === 'different phone')
        rows.get('one')!.phone = '989189876543';
      await event(0, { connection: 'open' });
      expect(manager.snapshot('one')).toMatchObject({
        status: 'FAILED',
        connected: false,
      });
      expect(authStore.clear).not.toHaveBeenCalled();
    },
  );

  it('ignores QR updates for an authenticated identity', async () => {
    authenticated.add('one');
    await manager.start('one');
    await event(0, { qr: 'secret' });
    expect(manager.pairing('one').qr).toBeNull();
    expect(manager.snapshot('one').status).toBe('CONNECTING');
  });

  it.each(['restart', 'stop'] as const)(
    'aborts %s when authentication cleanup fails',
    async (action) => {
      await manager.start('one');
      vi.mocked(contexts[0]!.close).mockRejectedValueOnce(new Error('flush'));
      await expect(manager[action]('one')).rejects.toThrow(
        'Authentication cleanup failed',
      );
      expect(manager.snapshot('one').status).toBe('FAILED');
      expect(factory.create).toHaveBeenCalledOnce();
      expect(authStore.clear).not.toHaveBeenCalled();
    },
  );

  it('keeps logout status on manual stop', async () => {
    rows.get('one')!.status = 'LOGGED_OUT';
    await manager.stop('one');
    expect(manager.snapshot('one')).toMatchObject({
      status: 'LOGGED_OUT',
      reason: 'LOGGED_OUT',
    });
    expect(factory.create).not.toHaveBeenCalled();
  });

  it('requires a connected authenticated socket for remote logout', async () => {
    await expect(manager.logout('one')).rejects.toThrow('Connect the session');
    await manager.start('one');
    await expect(manager.logout('one')).rejects.toThrow('Connect the session');
    sockets[0]!.ev.emit('creds.update', {
      me: { id: '989121234567@s.whatsapp.net' },
    });
    await expect(manager.logout('one')).rejects.toThrow('Connect the session');
    expect(authStore.clear).not.toHaveBeenCalled();
  });

  it('retains authentication if cleanup fails after confirmed remote logout', async () => {
    authenticated.add('one');
    await manager.start('one');
    await event(0, { connection: 'open' });
    vi.mocked(contexts[0]!.close).mockRejectedValueOnce(new Error('flush'));
    await expect(manager.logout('one')).rejects.toThrow('cleanup failed');
    expect(authStore.clear).not.toHaveBeenCalled();
  });

  it('soft-deletes a connected session while retaining its authentication and metadata', async () => {
    authenticated.add('one');
    await manager.start('one');
    await event(0, { connection: 'open' });
    await manager.remove('one');
    expect(rows.get('one')).toMatchObject({
      isEnabled: false,
      status: 'DISCONNECTED',
      supersededAt: null,
    });
    expect(rows.get('one')!.lastDisconnectedAt).toBeInstanceOf(Date);
    expect(manager.snapshot('one')).toMatchObject({
      status: 'DISCONNECTED',
      connected: false,
      reason: 'MANUAL_DISCONNECT',
      requiresPairing: false,
      nextRetryAt: null,
    });
    expect(sockets[0]!.end).toHaveBeenCalledOnce();
    expect(contexts[0]!.close).toHaveBeenCalledOnce();
    expect(factory.release).toHaveBeenCalledWith(sockets[0]);
    expect(sockets[0]!.logout).not.toHaveBeenCalled();
    expect(repository.remove).not.toHaveBeenCalled();
    expect(authStore.clear).not.toHaveBeenCalled();
    expect(authenticated.has('one')).toBe(true);
  });

  it('cancels retries on soft deletion and excludes the session from startup recovery', async () => {
    await manager.start('one');
    await event(0, close(DisconnectReason.connectionLost));
    await manager.remove('one');
    await manager.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(120000);
    expect(repository.remove).not.toHaveBeenCalled();
    expect(rows.get('one')!.isEnabled).toBe(false);
    expect(manager.snapshot('one')).toMatchObject({
      status: 'DISCONNECTED',
      connected: false,
      nextRetryAt: null,
    });
    expect(sockets[0]!.logout).not.toHaveBeenCalled();
    expect(factory.create).toHaveBeenCalledOnce();
  });

  it('allows repeated soft deletion, ignores stale callbacks and can explicitly reconnect', async () => {
    authenticated.add('one');
    await manager.start('one');
    await event(0, { connection: 'open' });
    const stale = sockets[0]!.ev.listeners('connection.update')[0]!;
    await manager.remove('one');
    await manager.remove('one');
    stale({ connection: 'open' });
    stale(close(DisconnectReason.connectionLost));
    await vi.advanceTimersByTimeAsync(120000);
    expect(rows.get('one')!.isEnabled).toBe(false);
    expect(manager.snapshot('one').status).toBe('DISCONNECTED');
    expect(sockets[0]!.end).toHaveBeenCalledOnce();
    expect(factory.create).toHaveBeenCalledOnce();
    expect(authStore.clear).not.toHaveBeenCalled();
    await manager.restart('one');
    await event(1, { connection: 'open' });
    expect(rows.get('one')!.isEnabled).toBe(true);
    expect(manager.snapshot('one').connected).toBe(true);
    expect(factory.create).toHaveBeenCalledTimes(2);
  });

  it('retains the session record if cleanup during removal fails', async () => {
    await manager.start('one');
    vi.mocked(contexts[0]!.close).mockRejectedValueOnce(new Error('flush'));
    await expect(manager.remove('one')).rejects.toThrow('cleanup failed');
    expect(repository.remove).not.toHaveBeenCalled();
    expect(rows.get('one')!.isEnabled).toBe(false);
    expect(authStore.clear).not.toHaveBeenCalled();
  });

  it.each([
    DisconnectReason.badSession,
    DisconnectReason.multideviceMismatch,
    DisconnectReason.forbidden,
  ])(
    'clears known invalid credentials %s only on explicit pairing',
    async (code) => {
      authenticated.add('one');
      await manager.start('one');
      await event(0, close(code));
      expect(authStore.clear).not.toHaveBeenCalled();
      await manager.preparePairing('one', PairingMethodEnum.QR);
      expect(authStore.clear).toHaveBeenCalledWith('one');
      expect(factory.create).toHaveBeenCalledTimes(2);
    },
  );

  it('rejects pairing on an authenticated live session', async () => {
    authenticated.add('one');
    await manager.start('one');
    await expect(
      manager.preparePairing('one', PairingMethodEnum.QR),
    ).rejects.toThrow('already authenticated');
    expect(authStore.clear).not.toHaveBeenCalled();
  });

  it('rejects pairing while authentication is in progress', async () => {
    await manager.start('one');
    await event(0, { isNewLogin: true });
    await expect(
      manager.preparePairing('one', PairingMethodEnum.QR),
    ).rejects.toThrow('in progress');
  });

  it('prevents changing the session phone during pairing', async () => {
    rows.get('one')!.phone = '989121234567';
    await expect(
      manager.preparePairing('one', PairingMethodEnum.CODE, '989189876543'),
    ).rejects.toThrow('cannot be changed');
    expect(factory.create).not.toHaveBeenCalled();
  });

  it('rechecks identity when authentication is opened for pairing', async () => {
    authStore.hasIdentity.mockResolvedValueOnce(false);
    authenticated.add('one');
    await expect(
      manager.preparePairing('one', PairingMethodEnum.QR),
    ).rejects.toThrow('use reconnect');
  });

  it('requires a runtime before requesting a code', async () => {
    await expect(
      manager.requestPairingCode('one', '989121234567'),
    ).rejects.toThrow('Start pairing first');
  });

  it('times out code requests without blocking the event queue', async () => {
    await manager.preparePairing('one', PairingMethodEnum.CODE);
    const pending = expect(
      manager.requestPairingCode('one', '989121234567'),
    ).rejects.toThrow('not ready');
    await vi.advanceTimersByTimeAsync(60000);
    await pending;
    expect(sockets[0]!.requestPairingCode).not.toHaveBeenCalled();
  });

  it('rejects a pending code request when its connection changes', async () => {
    await manager.preparePairing('one', PairingMethodEnum.CODE);
    const pending = expect(
      manager.requestPairingCode('one', '989121234567'),
    ).rejects.toThrow('connection changed');
    await manager.restart('one');
    await vi.advanceTimersByTimeAsync(50);
    await pending;
    expect(sockets[1]!.requestPairingCode).not.toHaveBeenCalled();
  });

  it('rejects code requests on a QR pairing session', async () => {
    await manager.start('one');
    await event(0, { connection: 'connecting' });
    await expect(
      manager.requestPairingCode('one', '989121234567'),
    ).rejects.toThrow('connection changed');
  });

  it('rejects code requests once the session has authenticated', async () => {
    await manager.preparePairing('one', PairingMethodEnum.CODE);
    await event(0, { connection: 'connecting' });
    sockets[0]!.ev.emit('creds.update', {
      me: { id: '989121234567@s.whatsapp.net' },
    });
    await expect(
      manager.requestPairingCode('one', '989121234567'),
    ).rejects.toThrow('already authenticated');
  });

  it('renews an expired pairing code and persists its credentials', async () => {
    await manager.preparePairing('one', PairingMethodEnum.CODE);
    await event(0, { connection: 'connecting' });
    await manager.requestPairingCode('one', '989121234567');
    await vi.advanceTimersByTimeAsync(config.whatsapp.pairingCodeTtlMs);
    sockets[0]!.requestPairingCode.mockResolvedValueOnce('NEWCODE1');
    expect((await manager.requestPairingCode('one', '989121234567')).code).toBe(
      'NEWCODE1',
    );
    expect(sockets[0]!.requestPairingCode).toHaveBeenCalledTimes(2);
    expect(contexts[0]!.saveCreds).toHaveBeenCalledTimes(2);
  });

  it('does not expose a code if its credentials cannot be persisted', async () => {
    await manager.preparePairing('one', PairingMethodEnum.CODE);
    await event(0, { connection: 'connecting' });
    vi.mocked(contexts[0]!.saveCreds).mockRejectedValueOnce(new Error('write'));
    await expect(
      manager.requestPairingCode('one', '989121234567'),
    ).rejects.toThrow('write');
    expect(manager.snapshot('one').status).toBe('CONNECTING');
  });

  it('recovers a stuck connection only after the watchdog deadline', async () => {
    await manager.start('one');
    await manager.inspectConnections();
    expect(manager.snapshot('one').retryCount).toBe(0);
    await vi.advanceTimersByTimeAsync(config.whatsapp.connectionStuckMs);
    await manager.inspectConnections();
    expect(manager.snapshot('one')).toMatchObject({
      status: 'RECONNECTING',
      reason: 'CONNECTION_STUCK',
      retryCount: 1,
    });
  });

  it('ignores pairing and intentionally stopped sessions in the watchdog', async () => {
    await manager.start('one');
    await event(0, { qr: 'qr' });
    await vi.advanceTimersByTimeAsync(config.whatsapp.connectionStuckMs);
    await manager.inspectConnections();
    expect(manager.snapshot('one').status).toBe('AWAITING_PAIRING');
    await manager.stop('one');
    await manager.inspectConnections();
    expect(factory.create).toHaveBeenCalledOnce();
  });

  it('continues startup recovery after one session fails', async () => {
    rows.set('two', row('two'));
    authStore.open.mockRejectedValueOnce(new Error('auth'));
    await manager.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(500);
    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'startup_restore_failed' }),
    );
    expect(factory.create).toHaveBeenCalledOnce();
    await event(0, { qr: 'qr' });
  });

  it('recovers handshakes that exhaust their startup deadline', async () => {
    await manager.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(config.whatsapp.connectionStuckMs);
    expect(manager.snapshot('one')).toMatchObject({
      status: 'RECONNECTING',
      reason: 'CONNECTION_STUCK',
    });
  });

  it('aborts staggered startup recovery on shutdown', async () => {
    rows.set('two', row('two'));
    await manager.onApplicationBootstrap();
    await settle();
    await manager.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(1000);
    expect(factory.create).toHaveBeenCalledOnce();
  });

  it('logs shutdown flush errors and still clears runtime state', async () => {
    await manager.start('one');
    vi.mocked(contexts[0]!.close).mockRejectedValueOnce(new Error('flush'));
    await manager.onModuleDestroy();
    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'shutdown_auth_flush_failed' }),
    );
    expect(manager.snapshot('one').generation).toBe(0);
  });

  it('ignores authentication failures reported by an old generation', async () => {
    await manager.start('one');
    const stale = authStore.open.mock.calls[0]![1] as () => void;
    await manager.restart('one');
    stale();
    await settle();
    expect(manager.snapshot('one').status).toBe('CONNECTING');
    expect(sockets[1]!.end).not.toHaveBeenCalled();
  });

  it('reuses a live pairing socket when explicitly preparing pairing again', async () => {
    await manager.preparePairing('one', PairingMethodEnum.QR);
    await manager.preparePairing('one', PairingMethodEnum.CODE);
    expect(factory.create).toHaveBeenCalledOnce();
    await event(0, { connection: 'connecting' });
    expect((await manager.requestPairingCode('one', '989121234567')).code).toBe(
      'ABCD1234',
    );
  });

  it('rejects pairing if the persisted record already marks a live socket as connected', async () => {
    await manager.start('one');
    rows.get('one')!.status = 'CONNECTED';
    await expect(
      manager.preparePairing('one', PairingMethodEnum.QR),
    ).rejects.toThrow('already authenticated');
  });

  it('does not reset retries before stability and resets them only once after stability', async () => {
    authenticated.add('one');
    rows.get('one')!.retryCount = 2;
    await manager.start('one');
    await event(0, { connection: 'open' });
    await manager.inspectConnections();
    expect(manager.snapshot('one').retryCount).toBe(2);
    await vi.advanceTimersByTimeAsync(config.whatsapp.stableConnectionMs);
    await manager.inspectConnections();
    repository.updateCurrent.mockClear();
    await manager.inspectConnections();
    expect(manager.snapshot('one').retryCount).toBe(0);
    expect(repository.updateCurrent).not.toHaveBeenCalled();
  });

  it('does not create a socket if shutdown begins during a manual start database write', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    repository.updateCurrent.mockImplementationOnce(async () => {
      await gate;
      return rows.get('one');
    });
    const starting = manager.start('one', true);
    await settle();
    const stopping = manager.onModuleDestroy();
    release();
    await Promise.all([starting, stopping]);
    expect(factory.create).not.toHaveBeenCalled();
  });

  it('does not schedule reconnection when shutdown begins during disconnect persistence', async () => {
    await manager.start('one');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    repository.transition.mockImplementationOnce(async () => {
      await gate;
      return rows.get('one');
    });
    sockets[0]!.ev.emit(
      'connection.update',
      close(DisconnectReason.connectionLost),
    );
    await settle();
    const stopping = manager.onModuleDestroy();
    release();
    await stopping;
    await vi.advanceTimersByTimeAsync(1000);
    expect(factory.create).toHaveBeenCalledOnce();
  });

  it('fences an already-queued retry when manual restart changes its generation', async () => {
    await manager.start('one');
    await event(0, close(DisconnectReason.connectionLost));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    repository.require.mockImplementationOnce(async () => {
      await gate;
      return { ...rows.get('one')! };
    });
    const restarting = manager.restart('one');
    await settle();
    await vi.advanceTimersByTimeAsync(750);
    release();
    await restarting;
    await settle();
    expect(factory.create).toHaveBeenCalledTimes(2);
    expect(manager.snapshot('one').status).toBe('CONNECTING');
  });

  it('allows a failed pairing code request to be retried at the rate-limit boundary', async () => {
    await manager.preparePairing('one', PairingMethodEnum.CODE);
    await event(0, { connection: 'connecting' });
    sockets[0]!.requestPairingCode.mockRejectedValueOnce(new Error('request'));
    await expect(
      manager.requestPairingCode('one', '989121234567'),
    ).rejects.toThrow('Unable to request');
    await vi.advanceTimersByTimeAsync(config.whatsapp.pairingRateLimitMs);
    expect((await manager.requestPairingCode('one', '989121234567')).code).toBe(
      'ABCD1234',
    );
  });

  it('rejects a missing session without opening authentication', async () => {
    repository.require.mockRejectedValueOnce(new Error('Session not found'));
    await expect(manager.start('missing')).rejects.toThrow('Session not found');
    expect(authStore.open).not.toHaveBeenCalled();
  });

  it('propagates failed soft-deletion persistence without claiming the session was disabled', async () => {
    await manager.start('one');
    repository.transition.mockRejectedValueOnce(new Error('database'));
    await expect(manager.remove('one')).rejects.toThrow('database');
    expect(rows.has('one')).toBe(true);
    expect(rows.get('one')!.isEnabled).toBe(true);
    expect(repository.remove).not.toHaveBeenCalled();
    expect(sockets[0]!.end).not.toHaveBeenCalled();
    expect(sockets[0]!.logout).not.toHaveBeenCalled();
  });

  it('propagates authentication deletion failure after remote logout confirmation', async () => {
    authenticated.add('one');
    await manager.start('one');
    await event(0, { connection: 'open' });
    authStore.clear.mockRejectedValueOnce(new Error('delete'));
    await expect(manager.logout('one')).rejects.toThrow('delete');
    expect(sockets[0]!.logout).toHaveBeenCalledOnce();
    expect(rows.get('one')!.isEnabled).toBe(false);
    expect(rows.get('one')!.status).not.toBe('LOGGED_OUT');
  });
  it('contains an unexpected startup worker failure without rejecting application bootstrap', async () => {
    authStore.open.mockRejectedValueOnce(
      new Error('authentication unavailable'),
    );
    loggerError.mockImplementationOnce(() => {
      throw new Error('logging backend unavailable');
    });
    await expect(manager.onApplicationBootstrap()).resolves.toBeUndefined();
    await settle();
    expect(loggerError).toHaveBeenCalledWith({
      event: 'startup_recovery_failed',
    });
    expect(manager.snapshot('one').status).toBe('FAILED');
    expect(authStore.clear).not.toHaveBeenCalled();
  });
});
