import { Logger } from '@nestjs/common';
import type { WaSession } from '@database/client.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionSessionLogService } from '../providers/logging/connection-session-log.service.ts';
import { SessionRuntimeService } from '../providers/session/session-runtime.service.ts';
import type { SessionRuntime } from '../interfaces/session-runtime.ts';
import { CONNECTION_REASONS } from '../interfaces/connection-status.ts';
import { PairingMethodEnum } from '../../sessions/interfaces/session.interface.ts';

const now = Date.parse('2026-11-14T10:00:00.000Z');

function setup() {
  const create = vi.fn(
    async ({ data }: { data: Record<string, unknown> }) => data,
  );
  const logs = new ConnectionSessionLogService({
    waSessionLog: { create },
  } as unknown as ConstructorParameters<typeof ConnectionSessionLogService>[0]);
  const service = new SessionRuntimeService(logs);
  const runtime = service.create({
    id: 'session-fixture',
    retryCount: 2,
    pairingMethod: 'QR',
    isEnabled: true,
  } as WaSession);
  return {
    logs,
    service,
    runtime,
    records: () => create.mock.calls.map(([input]) => input.data),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('session runtime database logging', () => {
  it('records actual state changes once with their previous state and timestamp', async () => {
    const { service, runtime, logs, records } = setup();
    service.state(runtime, 'CONNECTING');
    vi.setSystemTime(now + 1000);
    service.state(runtime, 'CONNECTING');
    await logs.flush();

    expect(records()).toHaveLength(1);
    expect(records()[0]).toMatchObject({
      level: 'INFO',
      event: 'runtime_state_changed',
      sessionId: runtime.sessionId,
      status: 'CONNECTING',
      stateSince: new Date(now),
      retryCount: 2,
      metadata: { previousStatus: 'DISCONNECTED' },
    });
    expect(runtime.lastActivityAt).toBe(now + 1000);
  });

  it('captures a disconnect before teardown removes its live lifecycle values', async () => {
    const { service, runtime, logs, records } = setup();
    runtime.status = 'CONNECTED';
    runtime.socket = {
      ws: { isOpen: false },
    } as unknown as SessionRuntime['socket'];
    runtime.connectedAt = now - 5000;
    runtime.pairingMethod = PairingMethodEnum.CODE;
    runtime.code = { value: 'private-pairing-code', expiresAt: now + 10000 };

    service.recordDisconnect(runtime, CONNECTION_REASONS.SOCKET_CLOSED, 428);
    runtime.socket = null;
    runtime.connectedAt = null;
    runtime.code = null;
    await logs.flush();

    expect(records()[0]).toMatchObject({
      event: 'disconnect_recorded',
      socketConnected: false,
      status: 'CONNECTED',
      connectedAt: new Date(now - 5000),
      lastDisconnectedAt: new Date(now),
      disconnectCode: 428,
      reason: CONNECTION_REASONS.SOCKET_CLOSED,
      codeExpiresAt: new Date(now + 10000),
      expiresAt: new Date(now + 10000),
    });
    expect(JSON.stringify(records())).not.toContain('private-pairing-code');
  });

  it('logs an observed QR expiration once without changing snapshot behavior', async () => {
    const { service, runtime, logs, records } = setup();
    runtime.status = 'AWAITING_PAIRING';
    runtime.qr = { value: 'private-qr-value', expiresAt: now - 3000 };

    expect(service.snapshot(runtime).status).toBe('AWAITING_PAIRING');
    service.snapshot(runtime);
    expect(service.pairing(runtime)).toEqual({ qr: null, expiresAt: null });
    service.snapshot(runtime);
    await logs.flush();

    expect(runtime.qr).toBeNull();
    expect(records()).toHaveLength(1);
    expect(records()[0]).toMatchObject({
      level: 'WARN',
      event: 'pairing_qr_expired',
      qrExpiresAt: new Date(now - 3000),
      metadata: { expiresAt: new Date(now - 3000).toISOString() },
    });
    expect(JSON.stringify(records())).not.toContain('private-qr-value');
  });

  it('logs code expiry once and keeps the existing projected EXPIRED state', async () => {
    const { service, runtime, logs, records } = setup();
    runtime.status = 'AWAITING_PAIRING';
    runtime.pairingMethod = PairingMethodEnum.CODE;
    runtime.code = { value: 'private-code-value', expiresAt: now };

    service.pairing(runtime);
    expect(service.snapshot(runtime)).toMatchObject({
      status: 'EXPIRED',
      reason: CONNECTION_REASONS.PAIRING_CODE_EXPIRED,
    });
    service.snapshot(runtime);
    await logs.flush();

    expect(runtime.status).toBe('AWAITING_PAIRING');
    expect(runtime.code?.value).toBe('private-code-value');
    expect(records()).toHaveLength(1);
    expect(records()[0]).toMatchObject({
      level: 'WARN',
      event: 'pairing_code_expired',
      codeExpiresAt: new Date(now),
      metadata: { expiresAt: new Date(now).toISOString() },
    });
    expect(JSON.stringify(records())).not.toContain('private-code-value');
  });

  it('observes expiry directly without public reads or changes to runtime state', async () => {
    const { service, runtime, logs, records } = setup();
    runtime.status = 'AWAITING_PAIRING';
    runtime.pairingMethod = PairingMethodEnum.CODE;
    runtime.code = { value: 'private-headless-code', expiresAt: now - 1000 };
    const before = { ...runtime };

    service.observePairingExpiry(runtime);
    service.observePairingExpiry(runtime);
    await logs.flush();

    expect(runtime).toEqual(before);
    expect(records()).toHaveLength(1);
    expect(records()[0]).toMatchObject({
      event: 'pairing_code_expired',
      codeExpiresAt: new Date(now - 1000),
      expiresAt: new Date(now - 1000),
    });
    expect(JSON.stringify(records())).not.toContain('private-headless-code');
  });

  it('does not report future artifacts and permits a renewed QR to expire separately', async () => {
    const { service, runtime, logs, records } = setup();
    runtime.status = 'AWAITING_PAIRING';
    runtime.qr = { value: 'first-qr', expiresAt: now + 1000 };
    service.snapshot(runtime);
    await logs.flush();
    expect(records()).toHaveLength(0);

    vi.setSystemTime(now + 1000);
    service.snapshot(runtime);
    runtime.qr = { value: 'renewed-qr', expiresAt: now + 2000 };
    service.snapshot(runtime);
    vi.setSystemTime(now + 2000);
    service.snapshot(runtime);
    service.snapshot(runtime);
    await logs.flush();
    expect(records()).toHaveLength(2);
    expect(records().map((record) => record.qrExpiresAt)).toEqual([
      new Date(now + 1000),
      new Date(now + 2000),
    ]);
  });
});
