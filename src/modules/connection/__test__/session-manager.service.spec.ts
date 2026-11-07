import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';
import { DisconnectReason } from '@whiskeysockets/baileys';
import type {
  AuthenticationState,
  WASocket,
  ConnectionState,
} from '@whiskeysockets/baileys';
import type { IAppConfig } from '@libs/common';
import type { WaSession } from '@libs/prisma';
import { SessionManagerService } from '../providers/session-manager.service.ts';
import { ConnectionHandlerService } from '../providers/connection-handler.service.ts';
import { ConnectionSupervisorService } from '../providers/connection-supervisor.service.ts';
import type { SessionRepository } from '../../sessions/session.repository.ts';
import type {
  AuthStateService,
} from '../../auth-state/providers/auth-state.service.ts';
import type { SocketFactoryService } from '../providers/socket-factory.service.ts';
import { AuthContext } from '../../auth-state/context/auth-state.context.ts';

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
    maxRetries: 3,
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
    phone: null,
    status: 'DISCONNECTED',
    enabled: true,
    pairingMethod: 'QR',
    retryCount: 0,
    lastConnectedAt: null,
    lastDisconnectedAt: null,
    lastDisconnectCode: null,
    lastError: null,
    instanceId: null,
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
  let rows: Map<string, WaSession>;
  let sockets: ReturnType<typeof socket>[];
  let contexts: AuthContext[];
  let authenticated: Set<string>;
  let repository: {
    require: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    transition: ReturnType<typeof vi.fn>;
    recoverable: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  let authStore: {
    hasIdentity: ReturnType<typeof vi.fn>;
    open: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
  };
  let factory: { create: ReturnType<typeof vi.fn> };
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
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    rows = new Map([['one', row('one')]]);
    sockets = [];
    contexts = [];
    authenticated = new Set();
    const update = vi.fn(async (id: string, data: Partial<WaSession>) =>
      Object.assign(rows.get(id)!, data),
    );
    repository = {
      require: vi.fn(async (id: string) => ({ ...rows.get(id)! })),
      update,
      transition: vi.fn(async (id: string, data: Partial<WaSession>) =>
        update(id, data),
      ),
      recoverable: vi.fn(async () =>
        [...rows.values()].filter(
          (value) => value.enabled && value.status !== 'LOGGED_OUT',
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
      create: vi.fn(() => {
        const next = socket();
        sockets.push(next);
        return next as unknown as WASocket;
      }),
    };
    manager = new SessionManagerService(
      repository as unknown as SessionRepository,
      authStore as unknown as AuthStateService,
      factory as unknown as SocketFactoryService,
      new ConnectionHandlerService(),
      new ConnectionSupervisorService(config),
      config,
    );
  });
  afterEach(async () => {
    await manager.onModuleDestroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
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
    await manager.preparePairing('one', 'CODE', '989121234567');
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
    await manager.preparePairing('one', 'CODE', '989121234567');
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
          code === DisconnectReason.badSession,
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

  it('bounds reconnect loops even if restartRequired repeats', async () => {
    authenticated.add('one');
    await manager.start('one');
    for (let index = 0; index < 3; index++) {
      await event(index, close(DisconnectReason.restartRequired));
      await vi.advanceTimersByTimeAsync(250);
    }
    await event(3, close(DisconnectReason.restartRequired));
    await vi.advanceTimersByTimeAsync(120000);
    expect(factory.create).toHaveBeenCalledTimes(4);
    expect(manager.snapshot('one').status).toBe('FAILED');
    expect(manager.snapshot('one').reason).toBe('RETRY_LIMIT_REACHED');
  });

  it('rate limits repeated unsuccessful pairing code requests', async () => {
    await manager.preparePairing('one', 'CODE', '989121234567');
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
    await expect(manager.preparePairing('one', 'QR')).rejects.toThrow(
      'use reconnect',
    );
    expect(factory.create).not.toHaveBeenCalled();
  });

  it('only clears known-invalid credentials after an explicit new pairing request', async () => {
    authenticated.add('one');
    await manager.start('one');
    await event(0, close(DisconnectReason.loggedOut));
    expect(authStore.clear).not.toHaveBeenCalled();
    await manager.preparePairing('one', 'QR');
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
    expect(rows.get('one')!.enabled).toBe(false);
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
    rows.set('disabled', row('disabled', { enabled: false }));
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
    expect(rows.get('one')!.enabled).toBe(false);
  });

  it('shuts down without logout, flushes auth and never recreates sockets', async () => {
    await manager.start('one');
    await manager.onModuleDestroy();
    expect(sockets[0]!.end).toHaveBeenCalled();
    expect(sockets[0]!.logout).not.toHaveBeenCalled();
    expect(contexts[0]!.close).toHaveBeenCalledOnce();
    await expect(manager.start('one')).rejects.toThrow('shutting down');
  });
});
