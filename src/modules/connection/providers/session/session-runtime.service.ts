import { Injectable } from '@nestjs/common';
import type { WaSession } from '@database/client.js';
import type { SessionRuntime } from '../../interfaces/session-runtime.ts';
import type {
  PairingQr,
  SessionSnapshot,
} from '../../interfaces/session-results.ts';
import { CONNECTION_REASONS } from '../../interfaces/connection-status.ts';
import { PairingMethodEnum } from '../../../sessions/interfaces/session.interface.ts';
import { ConnectionSessionLogService } from '../logging/connection-session-log.service.ts';

// Creates runtime state and projects public session and pairing information.
@Injectable()
export class SessionRuntimeService {
  private readonly loggedExpirations = new WeakMap<
    SessionRuntime,
    Partial<Record<PairingMethodEnum, number>>
  >();

  constructor(private readonly logs: ConnectionSessionLogService) {}

  create(row: WaSession): SessionRuntime {
    return {
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
      pairingMethod: row.pairingMethod as PairingMethodEnum,
      lastActivityAt: Date.now(),
      connectedAt: null,
      stateSince: Date.now(),
      stable: false,
      intentionalStop: !row.isEnabled,
      pairingReady: false,
      qr: null,
      code: null,
      lastCodeRequestAt: 0,
      dispose: null,
    };
  }

  state(runtime: SessionRuntime, status: SessionRuntime['status']): void {
    const previousStatus = runtime.status;
    if (runtime.status !== status) runtime.stateSince = Date.now();
    runtime.status = status;
    if (['CONNECTED', 'AWAITING_PAIRING', 'AUTHENTICATING'].includes(status))
      runtime.reason = null;
    runtime.lastActivityAt = Date.now();
    if (previousStatus !== status) {
      void this.logs.write(
        SessionRuntimeService.name,
        'INFO',
        {
          sessionId: runtime.sessionId,
          event: 'runtime_state_changed',
          message: `Session state changed from ${previousStatus} to ${status}`,
          previousStatus,
        },
        runtime,
      );
    }
  }

  recordDisconnect(
    runtime: SessionRuntime,
    reason: CONNECTION_REASONS,
    code: number | null = null,
  ): void {
    runtime.reason = reason;
    runtime.lastDisconnectCode = code;
    runtime.lastDisconnectedAt = Date.now();
    void this.logs.write(
      SessionRuntimeService.name,
      'WARN',
      {
        sessionId: runtime.sessionId,
        event: 'disconnect_recorded',
        message: 'Session disconnect observed',
        reason,
        code,
      },
      runtime,
    );
  }

  observePairingExpiry(runtime: SessionRuntime): void {
    const method = runtime.pairingMethod;
    if (
      method === PairingMethodEnum.CODE &&
      (runtime.status !== 'AWAITING_PAIRING' ||
        runtime.auth?.state.creds.me?.id)
    )
      return;
    const secret = method === PairingMethodEnum.QR ? runtime.qr : runtime.code;
    if (!secret) return;
    const expiresAt = Number(secret.expiresAt);
    if (
      !Number.isFinite(expiresAt) ||
      expiresAt > Date.now() ||
      !Number.isFinite(new Date(expiresAt).getTime())
    )
      return;
    const logged = this.loggedExpirations.get(runtime) ?? {};
    if (logged[method] === expiresAt) return;
    logged[method] = expiresAt;
    this.loggedExpirations.set(runtime, logged);
    void this.logs.write(
      SessionRuntimeService.name,
      'WARN',
      {
        sessionId: runtime.sessionId,
        event:
          method === PairingMethodEnum.QR
            ? 'pairing_qr_expired'
            : 'pairing_code_expired',
        message:
          method === PairingMethodEnum.QR
            ? 'Pairing QR expired'
            : 'Pairing code expired',
        expiresAt: new Date(expiresAt).toISOString(),
      },
      runtime,
    );
  }

  pairing(runtime?: SessionRuntime): PairingQr {
    if (!runtime) {
      return { qr: null, expiresAt: null };
    }

    this.observePairingExpiry(runtime);

    const qr = runtime.qr;

    if (!qr || runtime.pairingMethod !== 'QR') {
      return { qr: null, expiresAt: null };
    }

    const expiresAt = Number(qr.expiresAt);

    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      runtime.qr = null;
      return { qr: null, expiresAt: null };
    }

    return {
      qr: qr.value ?? null,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }
  snapshot(runtime?: SessionRuntime): SessionSnapshot {
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
    this.observePairingExpiry(runtime);
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
}
