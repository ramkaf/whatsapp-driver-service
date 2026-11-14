import { Logger } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import type { WASocket } from '@whiskeysockets/baileys';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionSessionLogService } from '../providers/logging/connection-session-log.service.ts';
import { SocketEventRegistrarService } from '../providers/socket/socket-event-registrar.service.ts';
import type { RealtimeService } from '../providers/realtime/realtime.service.ts';
import type { SessionRuntime } from '../interfaces/session-runtime.ts';
import { PairingMethodEnum } from '../../sessions/interfaces/session.interface.ts';

function setup() {
  const create = vi.fn(
    async ({ data }: { data: Record<string, unknown> }) => data,
  );
  const logs = new ConnectionSessionLogService({
    waSessionLog: { create },
  } as unknown as ConstructorParameters<typeof ConnectionSessionLogService>[0]);
  const publish = vi.fn();
  const registrar = new SocketEventRegistrarService(
    { publish } as unknown as RealtimeService,
    logs,
  );
  const ev = new EventEmitter();
  const ws = { isOpen: true };
  const socket = {
    ev,
    ws,
    updateMediaMessage: vi.fn(),
  } as unknown as WASocket;
  return {
    registrar,
    publish,
    ev,
    ws,
    socket,
    logs,
    records: () => create.mock.calls.map(([input]) => input.data),
  };
}

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('socket event consumer database logging', () => {
  it('retains the caught exception and live socket state while delivering to other consumers', async () => {
    const { registrar, publish, ev, ws, socket, logs, records } = setup();
    const failure = new TypeError('Consumer processing failed');
    registrar.subscribe(() => {
      throw failure;
    });
    const succeedingConsumer = vi.fn();
    registrar.subscribe(succeedingConsumer);
    registrar.register('session-fixture', socket);
    const payload = {
      messages: [{ message: { conversation: 'private-message-body' } }],
    };

    ev.emit('messages.upsert', payload);
    ws.isOpen = false;
    await logs.flush();

    expect(succeedingConsumer).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(
      'session-fixture',
      'messages.upsert',
      payload,
    );
    expect(records()).toHaveLength(1);
    expect(records()[0]).toMatchObject({
      level: 'EXCEPTION',
      context: 'SocketEventRegistrarService',
      sessionId: 'session-fixture',
      event: 'messages.upsert',
      metadata: { reason: 'message_consumer_failed' },
      errorName: 'TypeError',
      errorMessage: failure.message,
      errorStack: failure.stack,
      socketConnected: true,
      status: null,
      connectedAt: null,
    });
    expect(JSON.stringify(records())).not.toContain('private-message-body');
  });

  it('keeps stale, closed and disposed socket events out of consumers and logs', async () => {
    const { registrar, publish, ev, socket, logs, records } = setup();
    let current = true;
    const consumer = vi.fn(() => {
      throw new Error('Should only run for the current open registration');
    });
    registrar.subscribe(consumer);
    const dispose = registrar.register(
      'session-fixture',
      socket,
      () => current,
    );

    current = false;
    ev.emit('messages.upsert', {});
    current = true;
    ev.emit('connection.update', { connection: 'close' });
    ev.emit('messages.upsert', {});
    dispose();
    ev.emit('connection.update', { connection: 'open' });
    ev.emit('messages.upsert', {});
    await logs.flush();

    expect(consumer).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledOnce();
    expect(records()).toHaveLength(0);
    expect(
      registrar.getMediaDownloadContext('session-fixture'),
    ).toBeUndefined();
    expect(ev.listenerCount('messages.upsert')).toBe(0);
  });

  it('captures supplied lifecycle state with the registered socket and excludes pairing and message secrets', async () => {
    const { registrar, publish, ev, ws, socket, logs, records } = setup();
    const now = Date.now();
    const runtime: Partial<SessionRuntime> = {
      sessionId: 'session-fixture',
      socket: null,
      status: 'AWAITING_PAIRING',
      generation: 3,
      retryCount: 2,
      connectedAt: now - 5000,
      stateSince: now - 2000,
      pairingMethod: PairingMethodEnum.CODE,
      code: { value: 'private-pairing-secret', expiresAt: now + 180000 },
    };
    registrar.subscribe(() => {
      throw new Error('Consumer failed using private-pairing-secret');
    });
    const succeedingConsumer = vi.fn();
    registrar.subscribe(succeedingConsumer);
    registrar.register(
      'session-fixture',
      socket,
      () => true,
      () => runtime,
    );
    const payload = {
      messages: [{ message: { conversation: 'private-message-body' } }],
    };

    ev.emit('messages.upsert', payload);
    runtime.status = 'FAILED';
    runtime.generation = 20;
    runtime.retryCount = 10;
    runtime.connectedAt = null;
    runtime.code = null;
    ws.isOpen = false;
    await logs.flush();

    expect(records()).toHaveLength(1);
    expect(records()[0]).toMatchObject({
      sessionId: 'session-fixture',
      status: 'AWAITING_PAIRING',
      socketConnected: true,
      generation: 3,
      retryCount: 2,
      connectedAt: new Date(now - 5000),
      stateSince: new Date(now - 2000),
      expiresAt: new Date(now + 180000),
      codeExpiresAt: new Date(now + 180000),
      errorMessage: 'Consumer failed using [REDACTED]',
    });
    expect(succeedingConsumer).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(
      'session-fixture',
      'messages.upsert',
      payload,
    );
    expect(JSON.stringify(records())).not.toContain('private-pairing-secret');
    expect(JSON.stringify(records())).not.toContain('private-message-body');
  });
});
