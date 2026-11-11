import { DisconnectAction } from '../../interfaces/connection-update.ts';
import type {
  SessionPersistence,
  SessionAuthentication,
  SessionSocketFactory,
} from '../../interfaces/session-dependencies.ts';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { setTimeout as delay } from 'node:timers/promises';
import { DisconnectReason } from '@whiskeysockets/baileys';
import type {
  ConnectionState,
  AuthenticationCreds,
  WASocket,
} from '@whiskeysockets/baileys';
import { configuer } from '@libs/common';
import type { IAppConfig } from '@libs/common';
import { SessionRuntimeService } from './session-runtime.service.ts';
import { SocketLifecycleService } from '../socket/socket-lifecycle.service.ts';
import type {
  PairingCode,
  PairingQr,
  SessionSnapshot,
} from '../../interfaces/session-results.ts';
import type { WaSession } from '@database/client.js';
import { AuthStateService } from '../../../auth-state/providers/auth-state.service.ts';
import { WA_SESSION_REPOSITORY } from '@libs/prisma';
import { SocketFactoryService } from '../socket/socket-factory.service.ts';
import { ConnectionSupervisorService } from '../recovery/connection-supervisor.service.ts';
import { SessionQueue } from '../../session-queue.ts';
import type { SessionRuntime } from '../../interfaces/session-runtime.ts';
import { CONNECTION_REASONS } from '../../interfaces/connection-status.ts';
import { PairingMethodEnum } from '../../../sessions/interfaces/session.interface.ts';
import { classifyDisconnect } from '../../utils/disconnect-classifier.util.ts';

// Orchestrates serialized session commands, pairing, and connection recovery.
@Injectable()
export class SessionManagerService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(SessionManagerService.name);
  private readonly runtimes = new Map<string, SessionRuntime>();
  private readonly queue = new SessionQueue();
  private readonly phones = new SessionQueue();
  private readonly sessionPhones = new Map<string, string>();
  private stopping = false;
  private restored = false;
  private recovery: Promise<void> | null = null;
  private readonly startupAbort = new AbortController();

  constructor(
    @Inject(WA_SESSION_REPOSITORY)
    private readonly repository: SessionPersistence,
    @Inject(AuthStateService) private readonly authStore: SessionAuthentication,
    @Inject(SocketFactoryService)
    private readonly factory: SessionSocketFactory,
    private readonly supervisor: ConnectionSupervisorService,
    @Inject(configuer.KEY) private readonly config: IAppConfig,
    private readonly runtimeState: SessionRuntimeService,
    private readonly lifecycle: SocketLifecycleService,
  ) {}

  private runtime(row: WaSession): SessionRuntime {
    this.sessionPhones.set(row.id, row.phone);
    let runtime = this.runtimes.get(row.id);
    if (!runtime) {
      if (
        row.isEnabled &&
        [...this.runtimes.values()].filter((entry) => !entry.intentionalStop)
          .length >= this.config.whatsapp.maxSessions
      )
        throw new ConflictException('Session limit reached');
      runtime = this.runtimeState.create(row);
      this.runtimes.set(row.id, runtime);
    }
    return runtime;
  }

  getSocket(sessionId: string): WASocket | undefined {
    return this.runtimes.get(sessionId)?.socket ?? undefined;
  }

  getSockets(): Map<string, WASocket> {
    const sockets = new Map<string, WASocket>();

    for (const [sessionId, runtime] of this.runtimes) {
      if (runtime.socket) {
        sockets.set(sessionId, runtime.socket);
      }
    }

    return sockets;
  }

  getConnectedSockets(): Map<string, WASocket> {
    const sockets = new Map<string, WASocket>();

    for (const [sessionId, runtime] of this.runtimes) {
      if (runtime.status === 'CONNECTED' && runtime.socket?.ws.isOpen) {
        sockets.set(sessionId, runtime.socket);
      }
    }

    return sockets;
  }

  // Account commands share a lock with replacement, even when their row IDs differ.
  private command<T>(id: string, work: () => Promise<T>): Promise<T> {
    const enqueue = (phone: string) =>
      this.phones.run(phone, () =>
        this.queue.run(id, async () => {
          await this.repository.require(id);
          return work();
        }),
      );
    const phone = this.sessionPhones.get(id);
    if (phone) return enqueue(phone);
    return this.repository.require(id).then((row) => enqueue(row.phone));
  }

  async replace(
    data: Pick<WaSession, 'name' | 'phone' | 'pairingMethod'>,
    maxSessions: number,
  ): Promise<WaSession> {
    return this.phones.run(data.phone, async () => {
      if (this.stopping)
        throw new ServiceUnavailableException('Application is shutting down');
      const existing = await this.repository.currentByPhone(data.phone);
      const count = await this.repository.countEnabledSessions();
      if (count - (existing?.isEnabled ? 1 : 0) >= maxSessions)
        throw new ConflictException('Session limit reached');
      const previous = existing ? this.runtimes.get(existing.id) : undefined;
      const resumePrevious = existing?.isEnabled && !previous?.intentionalStop;
      if (previous) {
        await this.queue.run(previous.sessionId, async () => {
          previous.intentionalStop = true;
          try {
            await this.lifecycle.teardown(previous);
          } catch {
            await this.failLocked(
              previous,
              'Authentication cleanup failed during replacement',
            );
            throw new ServiceUnavailableException(
              'Authentication cleanup failed; replacement aborted',
            );
          }
          this.runtimeState.state(previous, 'DISCONNECTED');
        });
      }
      let row: WaSession;
      try {
        row = await this.repository.replaceCurrent(data, maxSessions);
      } catch (error) {
        // A failed insert rolls back retirement; restore the previous account's socket.
        if (previous && resumePrevious) {
          previous.intentionalStop = false;
          try {
            await this.queue.run(previous.sessionId, () =>
              this.startLocked(previous),
            );
          } catch {
            this.logger.error({
              sessionId: previous.sessionId,
              event: 'replacement_restore_failed',
            });
          }
        }
        throw error;
      }
      if (existing) {
        this.runtimes.delete(existing.id);
        this.sessionPhones.delete(existing.id);
      }
      try {
        await this.queue.run(row.id, () => this.startLocked(this.runtime(row)));
      } catch {
        this.logger.warn({
          sessionId: row.id,
          event: 'initial_connection_failed',
        });
      }
      return row;
    });
  }

  private current(runtime: SessionRuntime, generation: number): boolean {
    return (
      !this.stopping &&
      !runtime.intentionalStop &&
      runtime.generation === generation
    );
  }

  async start(id: string, manual = false): Promise<void> {
    return this.command(id, async () => {
      if (this.stopping)
        throw new ServiceUnavailableException('Application is shutting down');
      const row = await this.repository.require(id);
      if (row.status === 'LOGGED_OUT')
        throw new ConflictException('Pairing is required after logout');
      const runtime = this.runtime(row);
      if (manual) {
        await this.repository.updateCurrent(id, {
          isEnabled: true,
          retryCount: 0,
        });
        runtime.retryCount = 0;
        runtime.intentionalStop = false;
      }
      if (
        (!row.isEnabled && !manual) ||
        runtime.socket ||
        runtime.reconnectTimer
      )
        return;
      await this.startLocked(runtime);
    });
  }

  private async startLocked(runtime: SessionRuntime): Promise<void> {
    if (this.stopping || runtime.intentionalStop || runtime.socket) return;
    const generation = ++runtime.generation;
    this.runtimeState.state(runtime, 'CONNECTING');
    await this.repository.transition(
      runtime.sessionId,
      { status: 'CONNECTING' },
      'CONNECTION_STARTED',
    );
    try {
      const auth = await this.authStore.open(runtime.sessionId, () => {
        this.enqueueFailure(
          runtime,
          generation,
          'Authentication persistence failed',
        );
      });
      if (!this.current(runtime, generation)) {
        await auth.close();
        return;
      }
      runtime.auth = auth;
      const socket = this.factory.create(
        runtime.sessionId,
        auth.state,
        this.config.whatsapp.pairingTtlMs,
        () => this.current(runtime, generation) && !!runtime.socket?.ws.isOpen,
      );
      runtime.socket = socket;
      const credsUpdated = (update: Partial<AuthenticationCreds>) => {
        if (!this.current(runtime, generation)) return;
        Object.assign(auth.state.creds, update);
        void auth
          .saveCreds()
          .catch(() =>
            this.enqueueFailure(
              runtime,
              generation,
              'Authentication persistence failed',
            ),
          );
      };
      const connectionUpdated = (update: Partial<ConnectionState>) => {
        if (!this.current(runtime, generation)) return;
        void this.command(runtime.sessionId, async () => {
          if (!this.current(runtime, generation)) return;
          try {
            await this.handle(runtime, update);
          } catch {
            await this.failLocked(
              runtime,
              'Connection state or authentication persistence failed',
            );
          }
        }).catch(() =>
          this.logger.error({
            sessionId: runtime.sessionId,
            event: 'connection_event_failed',
          }),
        );
      };
      socket.ev.on('creds.update', credsUpdated);
      socket.ev.on('connection.update', connectionUpdated);
      runtime.dispose = () => {
        this.factory.release(socket);
        socket.ev.off('creds.update', credsUpdated);
        socket.ev.off('connection.update', connectionUpdated);
      };
      this.logger.log({
        sessionId: runtime.sessionId,
        generation,
        event: 'socket_created',
      });
    } catch {
      await this.failLocked(runtime, 'Session initialization failed');
      throw new ServiceUnavailableException('Session initialization failed');
    }
  }

  private enqueueFailure(
    runtime: SessionRuntime,
    generation: number,
    reason: string,
  ): void {
    this.logger.error({
      sessionId: runtime.sessionId,
      event: 'session_failure',
      reason,
    });
    void this.command(runtime.sessionId, async () => {
      if (this.current(runtime, generation))
        await this.failLocked(runtime, reason);
    }).catch(() =>
      this.logger.error({
        sessionId: runtime.sessionId,
        event: 'failure_state_write_failed',
      }),
    );
  }

  private async failLocked(
    runtime: SessionRuntime,
    reason: string,
  ): Promise<void> {
    runtime.reason = CONNECTION_REASONS.INTERNAL_ERROR;
    runtime.intentionalStop = true;
    try {
      await this.lifecycle.teardown(runtime);
    } catch {
      this.logger.error({
        sessionId: runtime.sessionId,
        event: 'cleanup_failed',
      });
    }
    this.runtimeState.state(runtime, 'FAILED');
    await this.repository.transition(
      runtime.sessionId,
      { status: 'FAILED', lastError: reason },
      'ERROR',
      { reason },
    );
  }

  private async handle(
    runtime: SessionRuntime,
    update: Partial<ConnectionState>,
  ): Promise<void> {
    runtime.lastActivityAt = Date.now();
    if (update.qr && !runtime.auth?.state.creds.me?.id) {
      runtime.pairingReady = true;
      runtime.qr = {
        value: update.qr,
        expiresAt: Date.now() + this.config.whatsapp.pairingTtlMs,
      };
      this.runtimeState.state(runtime, 'AWAITING_PAIRING');
      await this.repository.updateCurrent(runtime.sessionId, {
        status: 'AWAITING_PAIRING',
      });
    }
    if (update.isNewLogin === true) {
      runtime.qr = null;
      runtime.code = null;
      this.runtimeState.state(runtime, 'AUTHENTICATING');
      await runtime.auth?.flush();
      await this.repository.transition(
        runtime.sessionId,
        { status: 'AUTHENTICATING' },
        'PAIRING_COMPLETED',
      );
    }
    if (update.connection === 'connecting' && runtime.status === 'CONNECTING')
      runtime.pairingReady = true;
    if (update.connection === 'open') {
      if (!runtime.auth?.state.creds.me?.id)
        throw new Error('Connected socket has no authenticated identity');
      await runtime.auth.saveCreds();
      await runtime.auth.flush();
      const phone = runtime.auth.state.creds.me.id
        .split('@')[0]!
        .split(':')[0]!;
      const row = await this.repository.require(runtime.sessionId);
      if (!/^\d{6,15}$/.test(phone) || (row.phone && row.phone !== phone))
        throw new Error('Paired phone does not match session');
      this.lifecycle.cancelRetry(runtime);
      runtime.qr = null;
      runtime.code = null;
      runtime.connectedAt = Date.now();
      runtime.stable = false;
      this.runtimeState.state(runtime, 'CONNECTED');
      await this.repository.transition(
        runtime.sessionId,
        {
          status: 'CONNECTED',
          phone,
          lastConnectedAt: new Date(),
          lastError: null,
        },
        'CONNECTION_OPENED',
      );
      this.logger.log({ sessionId: runtime.sessionId, event: 'connected' });
    }
    if (update.connection === 'close') {
      const decision = classifyDisconnect(update.lastDisconnect?.error);
      this.runtimeState.recordDisconnect(
        runtime,
        decision.reason,
        decision.code,
      );
      await this.lifecycle.teardown(runtime);
      const status =
        decision.action === DisconnectAction.LOGOUT
          ? 'LOGGED_OUT'
          : decision.action === DisconnectAction.INVALID ||
              decision.action === DisconnectAction.REPLACED
            ? 'FAILED'
            : decision.action === DisconnectAction.EXPIRED
              ? 'EXPIRED'
              : 'DISCONNECTED';
      this.runtimeState.state(runtime, status);
      await this.repository.transition(
        runtime.sessionId,
        {
          status,
          lastDisconnectedAt: new Date(),
          lastDisconnectCode: decision.code,
          lastError: `Connection closed: ${decision.action}`,
        },
        decision.action === DisconnectAction.REPLACED
          ? 'CONNECTION_REPLACED'
          : decision.action === DisconnectAction.EXPIRED
            ? 'PAIRING_EXPIRED'
            : 'CONNECTION_CLOSED',
        {
          reason: decision.action,
          code: decision.code,
        },
      );
      this.logger.warn({
        sessionId: runtime.sessionId,
        event: 'disconnected',
        ...decision,
      });
      if (['LOGGED_OUT', 'FAILED', 'EXPIRED'].includes(status)) {
        runtime.intentionalStop = true;
        return;
      }
      await this.scheduleLocked(
        runtime,
        decision.action === DisconnectAction.RESTART,
      );
    }
  }

  private async scheduleLocked(
    runtime: SessionRuntime,
    restartRequired = false,
  ): Promise<void> {
    if (this.stopping || runtime.intentionalStop || runtime.reconnectTimer)
      return;
    const milliseconds = this.supervisor.next(
      runtime.retryCount,
      restartRequired,
    );
    runtime.retryCount++;
    runtime.nextRetryAt = Date.now() + milliseconds;
    this.runtimeState.state(runtime, 'RECONNECTING');
    await this.repository.transition(
      runtime.sessionId,
      {
        status: 'RECONNECTING',
        retryCount: runtime.retryCount,
      },
      'RECONNECT_SCHEDULED',
      {
        delayMs: milliseconds,
        nextRetryAt: new Date(runtime.nextRetryAt).toISOString(),
      },
    );
    const generation = runtime.generation;
    runtime.reconnectTimer = setTimeout(() => {
      void this.queue
        .run(runtime.sessionId, async () => {
          if (!this.current(runtime, generation)) return;
          this.lifecycle.cancelRetry(runtime);
          await this.startLocked(runtime);
        })
        .catch(() =>
          this.logger.error({
            sessionId: runtime.sessionId,
            event: 'reconnect_failed',
          }),
        );
    }, milliseconds);
    runtime.reconnectTimer.unref();
  }

  async restart(id: string): Promise<void> {
    await this.command(id, async () => {
      if (this.stopping)
        throw new ServiceUnavailableException('Application is shutting down');
      const row = await this.repository.require(id);
      if (row.status === 'LOGGED_OUT')
        throw new ConflictException('Pairing is required after logout');
      const runtime = this.runtime(row);
      await this.repository.updateCurrent(id, {
        isEnabled: true,
        retryCount: 0,
      });
      this.runtimeState.recordDisconnect(
        runtime,
        CONNECTION_REASONS.MANUAL_RESTART,
      );
      try {
        await this.lifecycle.teardown(runtime);
      } catch {
        await this.failLocked(
          runtime,
          'Pending authentication writes failed during restart',
        );
        throw new ServiceUnavailableException(
          'Authentication cleanup failed; restart aborted',
        );
      }
      runtime.intentionalStop = false;
      runtime.retryCount = 0;
      await this.startLocked(runtime);
    });
  }

  async stop(id: string): Promise<void> {
    await this.command(id, async () => {
      const row = await this.repository.require(id);
      const runtime = this.runtime(row);
      const status =
        row.status === 'LOGGED_OUT' ? 'LOGGED_OUT' : 'DISCONNECTED';
      await this.repository.transition(
        id,
        {
          isEnabled: false,
          status,
          lastDisconnectedAt: new Date(),
        },
        'CONNECTION_CLOSED',
        { reason: 'manual_disconnect' },
      );
      runtime.intentionalStop = true;
      this.runtimeState.recordDisconnect(
        runtime,
        status === 'LOGGED_OUT'
          ? CONNECTION_REASONS.LOGGED_OUT
          : CONNECTION_REASONS.MANUAL_DISCONNECT,
      );
      try {
        await this.lifecycle.teardown(runtime);
      } catch {
        await this.failLocked(
          runtime,
          'Pending authentication writes failed during disconnect',
        );
        throw new ServiceUnavailableException(
          'Authentication cleanup failed; session stopped',
        );
      }
      this.runtimeState.state(runtime, status);
    });
  }

  async logout(id: string): Promise<void> {
    await this.command(id, async () => {
      const row = await this.repository.require(id);
      const runtime = this.runtime(row);
      if (
        !runtime.socket ||
        !runtime.auth?.state.creds.me?.id ||
        runtime.status !== 'CONNECTED'
      ) {
        throw new ConflictException(
          'Connect the session before requesting remote logout',
        );
      }
      await this.repository.updateCurrent(id, { isEnabled: false });
      runtime.intentionalStop = true;
      this.lifecycle.cancelRetry(runtime);
      try {
        await runtime.socket.logout();
      } catch {
        await this.failLocked(
          runtime,
          'Remote logout was not confirmed; authentication retained',
        );
        throw new ServiceUnavailableException(
          'Logout was not confirmed; authentication retained',
        );
      }
      await this.lifecycle.teardown(runtime);
      await this.authStore.clear(id);
      this.runtimeState.recordDisconnect(
        runtime,
        CONNECTION_REASONS.LOGGED_OUT,
      );
      this.runtimeState.state(runtime, 'LOGGED_OUT');
      await this.repository.transition(
        id,
        { status: 'LOGGED_OUT', isEnabled: false },
        'CONNECTION_CLOSED',
        { reason: 'intentional_logout' },
      );
    });
  }

  async remove(id: string): Promise<void> {
    // Deletion disables the session while retaining its metadata and authentication.
    await this.stop(id);
  }

  async preparePairing(
    id: string,
    method: PairingMethodEnum,
    phone?: string,
  ): Promise<void> {
    await this.command(id, async () => {
      if (this.stopping)
        throw new ServiceUnavailableException('Application is shutting down');
      const row = await this.repository.require(id);
      const runtime = this.runtime(row);
      if (
        runtime.auth?.state.creds.me?.id ||
        (row.status === 'CONNECTED' && runtime.socket)
      ) {
        throw new ConflictException('Session is already authenticated');
      }
      // An expired/unregistered socket can be renewed on an explicit pairing request.
      if (
        row.status === 'LOGGED_OUT' ||
        (row.status === 'FAILED' &&
          [
            DisconnectReason.badSession,
            DisconnectReason.multideviceMismatch,
            DisconnectReason.forbidden,
          ].some((code) => code === row.lastDisconnectCode))
      ) {
        // Clearing invalid authentication requires this explicit pairing action.
        await this.lifecycle.teardown(runtime);
        await this.authStore.clear(id);
      }
      if (runtime.socket && runtime.status === 'AUTHENTICATING')
        throw new ConflictException('Authentication is in progress');
      if (!runtime.socket && (await this.authStore.hasIdentity(id))) {
        throw new ConflictException(
          'Stored credentials are already paired; use reconnect',
        );
      }
      if (phone && row.phone && row.phone !== phone)
        throw new ConflictException('Session phone cannot be changed');
      await this.repository.updateCurrent(id, {
        pairingMethod: method,
        ...(phone ? { phone } : {}),
        isEnabled: true,
        retryCount: 0,
      });
      runtime.pairingMethod = method;
      runtime.intentionalStop = false;
      runtime.retryCount = 0;
      if (!runtime.socket && !runtime.reconnectTimer)
        await this.startLocked(runtime);
      if (runtime.auth?.state.creds.me?.id)
        throw new ConflictException(
          'Stored credentials are already paired; use reconnect',
        );
    });
  }

  async requestPairingCode(id: string, phone: string): Promise<PairingCode> {
    const runtime = this.runtimes.get(id);
    if (!runtime) throw new ConflictException('Start pairing first');
    const generation = runtime.generation;
    const deadline = Date.now() + 60000;
    // Do not hold the session queue while awaiting events that need that queue.
    while (
      this.current(runtime, generation) &&
      !(runtime.pairingReady && runtime.socket?.ws.isOpen)
    ) {
      if (Date.now() >= deadline)
        throw new ServiceUnavailableException(
          'Pairing connection is not ready',
        );
      await delay(50);
    }
    return this.command(id, async () => {
      if (
        !this.current(runtime, generation) ||
        !runtime.socket ||
        runtime.pairingMethod !== 'CODE'
      )
        throw new ConflictException('Pairing connection changed; retry');
      if (runtime.auth?.state.creds.me?.id)
        throw new ConflictException('Session is already authenticated');
      const now = Date.now();
      if (runtime.code && runtime.code.expiresAt > now)
        return {
          code: runtime.code.value,
          expiresAt: new Date(runtime.code.expiresAt).toISOString(),
        };
      if (
        now - runtime.lastCodeRequestAt <
        this.config.whatsapp.pairingRateLimitMs
      )
        throw new HttpException(
          'Pairing requests are rate limited',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      runtime.lastCodeRequestAt = now;
      let code: string;
      try {
        code = await runtime.socket.requestPairingCode(phone);
      } catch {
        throw new ServiceUnavailableException('Unable to request pairing code');
      }
      await runtime.auth!.saveCreds();
      await this.repository.transition(
        id,
        { status: 'AWAITING_PAIRING' },
        'PAIRING_CODE_REQUESTED',
      );
      runtime.code = {
        value: code,
        expiresAt: Date.now() + this.config.whatsapp.pairingCodeTtlMs,
      };
      this.runtimeState.state(runtime, 'AWAITING_PAIRING');
      return {
        code,
        expiresAt: new Date(runtime.code.expiresAt).toISOString(),
      };
    });
  }

  pairing(id: string): PairingQr {
    return this.runtimeState.pairing(this.runtimes.get(id));
  }

  snapshot(id: string): SessionSnapshot {
    return this.runtimeState.snapshot(this.runtimes.get(id));
  }

  async inspectConnections(): Promise<void> {
    for (const runtime of this.runtimes.values()) {
      await this.command(runtime.sessionId, async () => {
        if (this.stopping || runtime.intentionalStop || runtime.reconnectTimer)
          return;
        const now = Date.now();
        if (runtime.status === 'CONNECTED') {
          if (runtime.socket?.ws.isOpen) {
            // Baileys handles ping/pong keepalive itself. An idle account is healthy.
            if (
              !runtime.stable &&
              runtime.connectedAt &&
              now - runtime.connectedAt >=
                this.config.whatsapp.stableConnectionMs
            ) {
              await this.repository.updateCurrent(runtime.sessionId, {
                retryCount: 0,
                lastHeartbeatAt: new Date(),
              });
              runtime.retryCount = 0;
              runtime.stable = true;
            }
            return;
          }
        } else if (
          !['CONNECTING', 'RECONNECTING', 'AUTHENTICATING'].includes(
            runtime.status,
          ) ||
          now - runtime.stateSince < this.config.whatsapp.connectionStuckMs
        )
          return;
        this.runtimeState.recordDisconnect(
          runtime,
          runtime.status === 'CONNECTED'
            ? CONNECTION_REASONS.SOCKET_CLOSED
            : CONNECTION_REASONS.CONNECTION_STUCK,
        );
        await this.lifecycle.teardown(runtime);
        await this.scheduleLocked(runtime);
      });
    }
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.restored || this.stopping) return;
    this.restored = true;
    const sessions = await this.repository.recoverable(
      this.config.whatsapp.maxSessions,
    );
    let index = 0;
    const worker = async () => {
      while (!this.stopping && index < sessions.length) {
        const session = sessions[index++]!;
        if (index > 1) {
          try {
            await delay(this.config.whatsapp.startupStaggerMs, undefined, {
              signal: this.startupAbort.signal,
            });
          } catch {
            return;
          }
        }
        if (this.stopping) return;
        try {
          await this.start(session.id);
          const deadline = Date.now() + this.config.whatsapp.connectionStuckMs;
          // Keep the startup slot until the initial attempt reaches a result.
          while (
            !this.stopping &&
            Date.now() < deadline &&
            ['CONNECTING', 'AUTHENTICATING'].includes(
              this.snapshot(session.id).status,
            )
          ) {
            try {
              await delay(100, undefined, { signal: this.startupAbort.signal });
            } catch {
              return;
            }
          }
          if (!this.stopping && Date.now() >= deadline)
            await this.inspectConnections();
        } catch {
          this.logger.error({
            sessionId: session.id,
            event: 'startup_restore_failed',
          });
        }
      }
    };
    // Recovery continues in the background so administration/health remain usable.
    this.recovery = Promise.all(
      Array.from({ length: this.config.whatsapp.startupConcurrency }, worker),
    )
      .then(() => undefined)
      .catch(() => this.logger.error({ event: 'startup_recovery_failed' }));
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    this.startupAbort.abort();
    for (const runtime of this.runtimes.values()) {
      runtime.intentionalStop = true;
      this.lifecycle.cancelRetry(runtime);
    }
    await Promise.allSettled(
      [...this.runtimes.values()].map(async (runtime) => {
        await runtime.socket?.end(undefined);
      }),
    );
    await this.recovery;
    await this.phones.drain();
    await this.queue.drain();
    await Promise.all(
      [...this.runtimes.values()].map(async (runtime) => {
        try {
          await this.lifecycle.teardown(runtime);
        } catch {
          this.logger.error({
            sessionId: runtime.sessionId,
            event: 'shutdown_auth_flush_failed',
          });
        }
      }),
    );
    this.runtimes.clear();
    this.sessionPhones.clear();
  }
}
