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
} from '@whiskeysockets/baileys';
import { configuer } from '@libs/common';
import type { IAppConfig } from '@libs/common';
import type { WaSession } from '@libs/prisma';
import { AuthStateService } from '../../auth-state/providers/auth-state.service.ts';
import { SessionRepository } from '../../sessions/session.repository.ts';
import { SocketFactoryService } from './socket-factory.service.ts';
import { ConnectionHandlerService } from './connection-handler.service.ts';
import { ConnectionSupervisorService } from './connection-supervisor.service.ts';
import { SessionQueue } from '../session-queue.ts';
import type { SessionRuntime } from '../interfaces/session-runtime.ts';
import { CONNECTION_REASONS } from '../interfaces/connection-status.ts';

// چرخهٔ عمر سشن‌ها، جفت‌سازی، سوکت‌ها، بازیابی اتصال و وضعیت جاری هر حساب را مدیریت می‌کند.
@Injectable()
export class SessionManagerService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(SessionManagerService.name);
  private readonly runtimes = new Map<string, SessionRuntime>();
  private readonly queue = new SessionQueue();
  private stopping = false;
  private restored = false;
  private recovery: Promise<void> | null = null;
  private readonly startupAbort = new AbortController();

  constructor(
    private readonly repository: SessionRepository,
    private readonly authStore: AuthStateService,
    private readonly factory: SocketFactoryService,
    private readonly handler: ConnectionHandlerService,
    private readonly supervisor: ConnectionSupervisorService,
    @Inject(configuer.KEY) private readonly config: IAppConfig,
  ) {}

  private runtime(row: WaSession): SessionRuntime {
    let runtime = this.runtimes.get(row.id);
    if (!runtime) {
      if (this.runtimes.size >= this.config.whatsapp.maxSessions)
        throw new ConflictException('Session limit reached');
      runtime = {
        sessionId: row.id,
        socket: null,
        auth: null,
        retryCount: row.retryCount,
        reconnectTimer: null,
        nextRetryAt: null,
        generation: 0,
        status: 'DISCONNECTED',
        reason: null,
        lastDisconnectCode: null,
        lastDisconnectedAt: null,
        pairingMethod: row.pairingMethod,
        lastActivityAt: Date.now(),
        connectedAt: null,
        stateSince: Date.now(),
        stable: false,
        intentionalStop: !row.enabled,
        pairingReady: false,
        qr: null,
        code: null,
        lastCodeRequestAt: 0,
        dispose: null,
      };
      this.runtimes.set(row.id, runtime);
    }
    return runtime;
  }

  private current(runtime: SessionRuntime, generation: number): boolean {
    return (
      !this.stopping &&
      !runtime.intentionalStop &&
      runtime.generation === generation
    );
  }

  private state(
    runtime: SessionRuntime,
    status: SessionRuntime['status'],
  ): void {
    if (runtime.status !== status) runtime.stateSince = Date.now();
    runtime.status = status;
    if (['CONNECTED', 'AWAITING_PAIRING', 'AUTHENTICATING'].includes(status))
      runtime.reason = null;
    runtime.lastActivityAt = Date.now();
  }

  private recordDisconnect(
    runtime: SessionRuntime,
    reason: CONNECTION_REASONS,
    code: number | null = null,
  ): void {
    runtime.reason = reason;
    runtime.lastDisconnectCode = code;
    runtime.lastDisconnectedAt = Date.now();
  }

  private cancelRetry(runtime: SessionRuntime): void {
    if (runtime.reconnectTimer) clearTimeout(runtime.reconnectTimer);
    runtime.reconnectTimer = null;
    runtime.nextRetryAt = null;
  }

  private async teardown(runtime: SessionRuntime): Promise<void> {
    this.cancelRetry(runtime);
    runtime.generation++;
    runtime.dispose?.();
    runtime.dispose = null;
    const socket = runtime.socket;
    const auth = runtime.auth;
    runtime.socket = null;
    runtime.auth = null;
    runtime.qr = null;
    runtime.code = null;
    runtime.pairingReady = false;
    runtime.connectedAt = null;
    const errors: unknown[] = [];
    try {
      await socket?.end(undefined);
    } catch (error) {
      errors.push(error);
    }
    try {
      await auth?.close();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length)
      throw new AggregateError(
        errors,
        'Socket or authentication cleanup failed',
      );
  }

  async start(id: string, manual = false): Promise<void> {
    return this.queue.run(id, async () => {
      if (this.stopping)
        throw new ServiceUnavailableException('Application is shutting down');
      const row = await this.repository.require(id);
      if (row.status === 'LOGGED_OUT')
        throw new ConflictException('Pairing is required after logout');
      const runtime = this.runtime(row);
      if (manual) {
        await this.repository.update(id, { enabled: true, retryCount: 0 });
        runtime.retryCount = 0;
        runtime.intentionalStop = false;
      }
      if ((!row.enabled && !manual) || runtime.socket || runtime.reconnectTimer)
        return;
      await this.startLocked(runtime);
    });
  }

  private async startLocked(runtime: SessionRuntime): Promise<void> {
    if (this.stopping || runtime.intentionalStop || runtime.socket) return;
    const generation = ++runtime.generation;
    this.state(runtime, 'CONNECTING');
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
        void this.queue
          .run(runtime.sessionId, async () => {
            if (!this.current(runtime, generation)) return;
            try {
              await this.handle(runtime, update);
            } catch {
              await this.failLocked(
                runtime,
                'Connection state or authentication persistence failed',
              );
            }
          })
          .catch(() =>
            this.logger.error({
              sessionId: runtime.sessionId,
              event: 'connection_event_failed',
            }),
          );
      };
      socket.ev.on('creds.update', credsUpdated);
      socket.ev.on('connection.update', connectionUpdated);
      runtime.dispose = () => {
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
    void this.queue
      .run(runtime.sessionId, async () => {
        if (this.current(runtime, generation))
          await this.failLocked(runtime, reason);
      })
      .catch(() =>
        this.logger.error({
          sessionId: runtime.sessionId,
          event: 'failure_state_write_failed',
        }),
      );
  }

  private async failLocked(
    runtime: SessionRuntime,
    reason: string,
    reasonCode: CONNECTION_REASONS = CONNECTION_REASONS.INTERNAL_ERROR,
  ): Promise<void> {
    runtime.reason = reasonCode;
    runtime.intentionalStop = true;
    try {
      await this.teardown(runtime);
    } catch {
      this.logger.error({
        sessionId: runtime.sessionId,
        event: 'cleanup_failed',
      });
    }
    this.state(runtime, 'FAILED');
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
    const event = this.handler.process(update);
    runtime.lastActivityAt = Date.now();
    if (event.qr && !runtime.auth?.state.creds.me?.id) {
      runtime.pairingReady = true;
      runtime.qr = {
        value: event.qr,
        expiresAt: Date.now() + this.config.whatsapp.pairingTtlMs,
      };
      this.state(runtime, 'AWAITING_PAIRING');
      await this.repository.update(runtime.sessionId, {
        status: 'AWAITING_PAIRING',
      });
    }
    if (event.authenticating) {
      runtime.qr = null;
      runtime.code = null;
      this.state(runtime, 'AUTHENTICATING');
      await runtime.auth?.flush();
      await this.repository.transition(
        runtime.sessionId,
        { status: 'AUTHENTICATING' },
        'PAIRING_COMPLETED',
      );
    }
    if (event.connection === 'connecting' && runtime.status === 'CONNECTING')
      runtime.pairingReady = true;
    if (event.connection === 'open') {
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
      this.cancelRetry(runtime);
      runtime.qr = null;
      runtime.code = null;
      runtime.connectedAt = Date.now();
      runtime.stable = false;
      this.state(runtime, 'CONNECTED');
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
    if (event.connection === 'close') {
      const decision = event.disconnect!;
      this.recordDisconnect(runtime, decision.reason, decision.code);
      await this.teardown(runtime);
      const status =
        decision.action === 'logout'
          ? 'LOGGED_OUT'
          : decision.action === 'invalid' || decision.action === 'replaced'
            ? 'FAILED'
            : decision.action === 'expired'
              ? 'EXPIRED'
              : 'DISCONNECTED';
      this.state(runtime, status);
      await this.repository.transition(
        runtime.sessionId,
        {
          status,
          lastDisconnectedAt: new Date(),
          lastDisconnectCode: decision.code,
          lastError: `Connection closed: ${decision.action}`,
        },
        decision.action === 'replaced'
          ? 'CONNECTION_REPLACED'
          : decision.action === 'expired'
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
      await this.scheduleLocked(runtime, decision.action === 'restart');
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
    if (milliseconds === null) {
      await this.failLocked(
        runtime,
        'Reconnect threshold reached',
        CONNECTION_REASONS.RETRY_LIMIT_REACHED,
      );
      return;
    }
    runtime.retryCount++;
    runtime.nextRetryAt = Date.now() + milliseconds;
    this.state(runtime, 'RECONNECTING');
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
          this.cancelRetry(runtime);
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
    await this.queue.run(id, async () => {
      if (this.stopping)
        throw new ServiceUnavailableException('Application is shutting down');
      const row = await this.repository.require(id);
      if (row.status === 'LOGGED_OUT')
        throw new ConflictException('Pairing is required after logout');
      const runtime = this.runtime(row);
      await this.repository.update(id, { enabled: true, retryCount: 0 });
      this.recordDisconnect(runtime, CONNECTION_REASONS.MANUAL_RESTART);
      try {
        await this.teardown(runtime);
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
    await this.queue.run(id, async () => {
      const row = await this.repository.require(id);
      const runtime = this.runtime(row);
      const status =
        row.status === 'LOGGED_OUT' ? 'LOGGED_OUT' : 'DISCONNECTED';
      await this.repository.transition(
        id,
        {
          enabled: false,
          status,
          lastDisconnectedAt: new Date(),
        },
        'CONNECTION_CLOSED',
        { reason: 'manual_disconnect' },
      );
      runtime.intentionalStop = true;
      this.recordDisconnect(
        runtime,
        status === 'LOGGED_OUT'
          ? CONNECTION_REASONS.LOGGED_OUT
          : CONNECTION_REASONS.MANUAL_DISCONNECT,
      );
      try {
        await this.teardown(runtime);
      } catch {
        await this.failLocked(
          runtime,
          'Pending authentication writes failed during disconnect',
        );
        throw new ServiceUnavailableException(
          'Authentication cleanup failed; session stopped',
        );
      }
      this.state(runtime, status);
    });
  }

  async logout(id: string): Promise<void> {
    await this.queue.run(id, async () => {
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
      await this.repository.update(id, { enabled: false });
      runtime.intentionalStop = true;
      this.cancelRetry(runtime);
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
      await this.teardown(runtime);
      await this.authStore.clear(id);
      this.recordDisconnect(runtime, CONNECTION_REASONS.LOGGED_OUT);
      this.state(runtime, 'LOGGED_OUT');
      await this.repository.transition(
        id,
        { status: 'LOGGED_OUT', enabled: false },
        'CONNECTION_CLOSED',
        { reason: 'intentional_logout' },
      );
    });
  }

  async remove(id: string): Promise<void> {
    await this.queue.run(id, async () => {
      const runtime = this.runtime(await this.repository.require(id));
      await this.repository.update(id, { enabled: false });
      runtime.intentionalStop = true;
      await this.teardown(runtime);
      // Local deletion only. WhatsApp unlinking is a separate explicit action.
      await this.repository.remove(id);
      this.runtimes.delete(id);
    });
  }

  async preparePairing(
    id: string,
    method: 'CODE' | 'QR',
    phone?: string,
  ): Promise<void> {
    await this.queue.run(id, async () => {
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
        await this.teardown(runtime);
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
      await this.repository.update(id, {
        pairingMethod: method,
        ...(phone ? { phone } : {}),
        enabled: true,
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

  async requestPairingCode(
    id: string,
    phone: string,
  ): Promise<{ code: string; expiresAt: string }> {
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
    return this.queue.run(id, async () => {
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
      this.state(runtime, 'AWAITING_PAIRING');
      return {
        code,
        expiresAt: new Date(runtime.code.expiresAt).toISOString(),
      };
    });
  }

  pairing(id: string) {
    const runtime = this.runtimes.get(id);
    if (!runtime) return { qr: null, expiresAt: null };
    if (runtime.qr && runtime.qr.expiresAt <= Date.now()) runtime.qr = null;
    return {
      qr: runtime.pairingMethod === 'QR' ? (runtime.qr?.value ?? null) : null,
      expiresAt:
        runtime.pairingMethod === 'QR' && runtime.qr
          ? new Date(runtime.qr.expiresAt).toISOString()
          : null,
    };
  }

  snapshot(id: string) {
    const runtime = this.runtimes.get(id);
    if (!runtime)
      return {
        status: 'DISCONNECTED',
        connected: false,
        accountPhone: null,
        reason: null,
        lastDisconnectCode: null,
        lastDisconnectedAt: null,
        requiresPairing: false,
        retryCount: 0,
        nextRetryAt: null,
        generation: 0,
        lastActivityAt: null,
        connectedAt: null,
        uptimeMs: 0,
      };
    const connected =
      runtime.status === 'CONNECTED' && !!runtime.socket?.ws.isOpen;
    // A missing live socket must not be reported as CONNECTED while its close
    // event is queued or the watchdog has not run yet.
    const lostSocket = runtime.status === 'CONNECTED' && !connected;
    const codeExpired =
      runtime.status === 'AWAITING_PAIRING' &&
      runtime.pairingMethod === 'CODE' &&
      !!runtime.code &&
      runtime.code.expiresAt <= Date.now() &&
      !runtime.auth?.state.creds.me?.id;
    const status = lostSocket
      ? 'DISCONNECTED'
      : codeExpired
        ? 'EXPIRED'
        : runtime.status;
    const reason = lostSocket
      ? CONNECTION_REASONS.SOCKET_CLOSED
      : codeExpired
        ? CONNECTION_REASONS.PAIRING_CODE_EXPIRED
        : runtime.reason;
    // Read the live socket identity only. A LID is not a phone number.
    const socketId = connected ? runtime.socket?.user?.id : undefined;
    const accountPhone =
      socketId?.match(/^(\d{6,15})(?::\d+)?@s\.whatsapp\.net$/)?.[1] ?? null;
    return {
      status,
      connected,
      accountPhone,
      reason,
      lastDisconnectCode: runtime.lastDisconnectCode,
      lastDisconnectedAt: runtime.lastDisconnectedAt
        ? new Date(runtime.lastDisconnectedAt).toISOString()
        : null,
      requiresPairing:
        ['AWAITING_PAIRING', 'LOGGED_OUT', 'EXPIRED'].includes(status) ||
        reason === CONNECTION_REASONS.INVALID_SESSION ||
        reason === CONNECTION_REASONS.MULTIDEVICE_MISMATCH,
      retryCount: runtime.retryCount,
      nextRetryAt: runtime.nextRetryAt
        ? new Date(runtime.nextRetryAt).toISOString()
        : null,
      generation: runtime.generation,
      lastActivityAt: new Date(runtime.lastActivityAt).toISOString(),
      connectedAt:
        connected && runtime.connectedAt
          ? new Date(runtime.connectedAt).toISOString()
          : null,
      uptimeMs:
        connected && runtime.connectedAt ? Date.now() - runtime.connectedAt : 0,
    };
  }

  async inspectConnections(): Promise<void> {
    for (const runtime of this.runtimes.values()) {
      await this.queue.run(runtime.sessionId, async () => {
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
              await this.repository.update(runtime.sessionId, {
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
        this.recordDisconnect(
          runtime,
          runtime.status === 'CONNECTED'
            ? CONNECTION_REASONS.SOCKET_CLOSED
            : CONNECTION_REASONS.CONNECTION_STUCK,
        );
        await this.teardown(runtime);
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
      this.cancelRetry(runtime);
    }
    await Promise.allSettled(
      [...this.runtimes.values()].map(async (runtime) => {
        await runtime.socket?.end(undefined);
      }),
    );
    await this.recovery;
    await this.queue.drain();
    await Promise.all(
      [...this.runtimes.values()].map(async (runtime) => {
        try {
          await this.teardown(runtime);
        } catch {
          this.logger.error({
            sessionId: runtime.sessionId,
            event: 'shutdown_auth_flush_failed',
          });
        }
      }),
    );
    this.runtimes.clear();
  }
}
