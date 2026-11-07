import { CONNECTION_REASONS } from '../interfaces/connection-status.ts';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import type { RawData } from 'ws';
import type { Mock } from 'vitest';
import type { IAppConfig } from '@libs/common';
import { RealtimeService } from '../providers/realtime.service.ts';
import type { ConnectionStatusSource } from '../providers/realtime.service.ts';
import { NotFoundException } from '@nestjs/common';

describe('test panel WebSocket', () => {
  let http: Server;
  let service: RealtimeService;
  let url: string;
  let source: ConnectionStatusSource;
  let snapshot: Mock<ConnectionStatusSource['snapshot']>;
  const token = 'test-admin-key-with-at-least-32-characters';

  beforeEach(async () => {
    http = createServer();
    service = new RealtimeService({
      apiPrefix: 'api',
      whatsapp: { adminApiKey: token },
    } as IAppConfig);
    snapshot = vi.fn(() => ({
      connected: false,
      status: 'DISCONNECTED',
      accountPhone: null,
      generation: 0,
      retryCount: 0,
      nextRetryAt: null,
      reason: null,
      lastDisconnectCode: null,
      lastDisconnectedAt: null,
      requiresPairing: false,
    }));
    source = {
      exists: vi.fn(async (id) => {
        if (!['phone-a', 'phone-b'].includes(id)) throw new NotFoundException();
      }),
      snapshot,
    };
    service.attach(http, source);
    http.listen(0, '127.0.0.1');
    await once(http, 'listening');
    url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}/api/connections/events`;
  });

  afterEach(async () => {
    service.onModuleDestroy();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });

  function decode(raw: RawData): string {
    const buffer = Buffer.isBuffer(raw)
      ? raw
      : Array.isArray(raw)
        ? Buffer.concat(raw)
        : Buffer.from(raw);
    return buffer.toString('utf8');
  }

  async function subscribe(sessionId: string) {
    const client = new WebSocket(url);
    await once(client, 'open');
    const events: { event: string; sessionId: string; data?: unknown }[] = [];
    const ready = new Promise<void>((resolve) => {
      const receive = (raw: RawData) => {
        const event = JSON.parse(decode(raw));
        events.push(event);
        if (event.event === 'whatsapp.status') {
          client.off('message', receive);
          resolve();
        }
      };
      client.on('message', receive);
    });
    client.send(JSON.stringify({ token, sessionId }));
    await ready;
    expect(events.map((event) => event.event)).toEqual([
      'subscribed',
      'transport.status',
      'whatsapp.status',
    ]);
    expect(events[1]).toMatchObject({ sessionId, data: { connected: true } });
    expect(events[2]).toMatchObject({
      sessionId,
      data: { connected: false, status: 'DISCONNECTED' },
    });
    return client;
  }

  it('authenticates and isolates message objects between phone sessions', async () => {
    const a = await subscribe('phone-a');
    const b = await subscribe('phone-b');
    const bEvents: unknown[] = [];
    b.on('message', (raw) => bEvents.push(JSON.parse(decode(raw))));
    const messageA = once(a, 'message');
    const messageB = once(b, 'message');
    service.publish('phone-a', 'messages.upsert', {
      text: 'private-a',
      timestamp: 12n,
    });
    service.publish('phone-b', 'messages.upsert', { text: 'private-b' });
    expect(JSON.parse((await messageA)[0].toString())).toMatchObject({
      sessionId: 'phone-a',
      event: 'messages.upsert',
      data: { text: 'private-a', timestamp: '12' },
    });
    await messageB;
    expect(bEvents).toHaveLength(1);
    expect(bEvents[0]).toMatchObject({
      sessionId: 'phone-b',
      data: { text: 'private-b' },
    });
  });

  it('rejects invalid credentials without subscribing', async () => {
    const client = new WebSocket(url);
    await once(client, 'open');
    const closed = once(client, 'close');
    client.send(JSON.stringify({ token: 'wrong', sessionId: 'phone-a' }));
    expect((await closed)[0]).toBe(1008);
  });

  it('rejects a nonexistent session', async () => {
    const client = new WebSocket(url);
    await once(client, 'open');
    const closed = once(client, 'close');
    client.send(JSON.stringify({ token, sessionId: 'missing' }));
    expect((await closed)[0]).toBe(1008);
    expect(snapshot).not.toHaveBeenCalled();
  });

  it('pushes a changed disconnect reason even when the main status is unchanged', async () => {
    const client = await subscribe('phone-a');
    const update = once(client, 'message');
    snapshot.mockReturnValue({
      ...source.snapshot('phone-a'),
      reason: CONNECTION_REASONS.MANUAL_DISCONNECT,
      lastDisconnectedAt: '2026-11-07T07:00:00.000Z',
    });
    expect(JSON.parse((await update)[0].toString())).toMatchObject({
      event: 'whatsapp.status',
      sessionId: 'phone-a',
      data: {
        connected: false,
        status: 'DISCONNECTED',
        reason: CONNECTION_REASONS.MANUAL_DISCONNECT,
      },
    });
  });

  it('pushes changed runtime status and socket phone without an HTTP request', async () => {
    const client = await subscribe('phone-a');
    const update = once(client, 'message');
    snapshot.mockReturnValue({
      connected: true,
      status: 'CONNECTED',
      accountPhone: '989121234567',
      generation: 1,
      retryCount: 0,
      nextRetryAt: null,
      reason: null,
      lastDisconnectCode: null,
      lastDisconnectedAt: null,
      requiresPairing: false,
    });
    expect(JSON.parse((await update)[0].toString())).toMatchObject({
      event: 'whatsapp.status',
      sessionId: 'phone-a',
      data: { connected: true, accountPhone: '989121234567' },
    });
  });
});
