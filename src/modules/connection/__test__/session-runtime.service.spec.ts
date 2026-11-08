import { PairingMethodEnum } from '../../sessions/interfaces/session.interface.ts';
import type { WaSession } from '@libs/prisma';
import type { WASocket } from '@whiskeysockets/baileys';
import { SessionRuntimeService } from '../providers/session/session-runtime.service.ts';
import { CONNECTION_REASONS } from '../interfaces/connection-status.ts';

describe('SessionRuntimeService', () => {
  const service = new SessionRuntimeService();
  const create = () =>
    service.create({
      id: 'one',
      retryCount: 2,
      enabled: true,
      pairingMethod: PairingMethodEnum.QR,
    } as WaSession);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-07T10:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('creates isolated runtime state without claiming a persisted connection is live', () => {
    const runtime = create();
    expect(runtime).toMatchObject({
      status: 'DISCONNECTED',
      socket: null,
      retryCount: 2,
      intentionalStop: false,
    });
    runtime.qr = { value: 'private', expiresAt: Date.now() + 100 };
    expect(create().qr).toBeNull();
    expect(service.snapshot()).toMatchObject({
      connected: false,
      generation: 0,
      uptimeMs: 0,
    });
  });

  it('updates activity without resetting the state deadline on repeated state updates', () => {
    const runtime = create();
    service.recordDisconnect(runtime, CONNECTION_REASONS.SOCKET_CLOSED, 428);
    service.state(runtime, 'CONNECTING');
    const since = runtime.stateSince;
    vi.advanceTimersByTime(500);
    service.state(runtime, 'CONNECTING');
    expect(runtime.stateSince).toBe(since);
    expect(runtime.lastActivityAt).toBe(since + 500);
    expect(runtime.reason).toBe(CONNECTION_REASONS.SOCKET_CLOSED);
    service.state(runtime, 'CONNECTED');
    expect(runtime.reason).toBeNull();
    expect(runtime.lastDisconnectCode).toBe(428);
  });

  it('expires QR secrets and hides them for code pairing', () => {
    const runtime = create();
    runtime.qr = { value: 'qr', expiresAt: Date.now() + 100 };
    expect(service.pairing(runtime).qr).toBe('qr');
    runtime.pairingMethod = PairingMethodEnum.CODE;
    expect(service.pairing(runtime).qr).toBeNull();
    vi.advanceTimersByTime(100);
    expect(service.pairing(runtime)).toEqual({ qr: null, expiresAt: null });
    expect(runtime.qr).toBeNull();
  });

  it('projects live phone identity and recognizes a socket lost before its close event', () => {
    const runtime = create();
    runtime.status = 'CONNECTED';
    runtime.connectedAt = Date.now();
    runtime.socket = {
      ws: { isOpen: true },
      user: { id: '989121234567:1@s.whatsapp.net' },
    } as unknown as WASocket;
    vi.advanceTimersByTime(500);
    expect(service.snapshot(runtime)).toMatchObject({
      connected: true,
      accountPhone: '989121234567',
      uptimeMs: 500,
    });
    runtime.socket = null;
    expect(service.snapshot(runtime)).toMatchObject({
      connected: false,
      status: 'DISCONNECTED',
      reason: 'SOCKET_CLOSED',
      accountPhone: null,
    });
  });

  it('projects code expiry without claiming account logout or mutating lifecycle state', () => {
    const runtime = create();
    runtime.status = 'AWAITING_PAIRING';
    runtime.pairingMethod = PairingMethodEnum.CODE;
    runtime.code = { value: 'secret', expiresAt: Date.now() };
    expect(service.snapshot(runtime)).toMatchObject({
      status: 'EXPIRED',
      reason: 'PAIRING_CODE_EXPIRED',
      requiresPairing: true,
    });
    expect(runtime.status).toBe('AWAITING_PAIRING');
  });
});
