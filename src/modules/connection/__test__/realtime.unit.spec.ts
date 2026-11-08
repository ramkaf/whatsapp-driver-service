import type { Mock } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Server } from 'node:http';
import { NotFoundException } from '@nestjs/common';
import { WebSocketServer } from 'ws';
import type { IAppConfig } from '@libs/common';
import { RealtimeService } from '../providers/realtime/realtime.service.ts';
import type { ConnectionStatusSource } from '../interfaces/session-results.ts';

vi.mock('ws', () => ({
  WebSocket: { OPEN: 1 },
  WebSocketServer: vi.fn(
    class {
      clients = new Set<unknown>();
      handleUpgrade = vi.fn(
        (
          _request: unknown,
          socket: { client: unknown },
          _head: unknown,
          done: (client: unknown) => void,
        ) => {
          this.clients.add(socket.client);
          done(socket.client);
        },
      );
      close = vi.fn();
    },
  ),
}));

class Client extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  send = vi.fn<(payload: string) => void>();
  ping = vi.fn();
  close = vi.fn((_code?: number, _reason?: string) => {
    this.readyState = 3;
    this.emit('close');
  });
  terminate = vi.fn(() => {
    this.readyState = 3;
    this.emit('close');
  });
}

describe('RealtimeService without network transport', () => {
  const token = 'test-admin-key-with-at-least-32-characters';
  let service: RealtimeService;
  let http: EventEmitter;
  let source: {
    exists: Mock<ConnectionStatusSource['exists']>;
    snapshot: Mock<ConnectionStatusSource['snapshot']>;
  };
  let server: {
    clients: Set<Client>;
    handleUpgrade: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  const settle = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };
  const events = (client: Client) =>
    client.send.mock.calls.map(([payload]) => JSON.parse(payload));
  const auth = (client: Client, sessionId = 'one') =>
    client.emit('message', Buffer.from(JSON.stringify({ token, sessionId })));
  function connect(
    options: { url?: string; origin?: string; host?: string } = {},
  ) {
    const client = new Client();
    const socket = { client, destroy: vi.fn() };
    client.once('close', () => server.clients.delete(client));
    http.emit(
      'upgrade',
      {
        url: options.url ?? '/api/connections/events',
        headers: { origin: options.origin, host: options.host ?? 'localhost' },
      },
      socket,
      Buffer.alloc(0),
    );
    return { client, socket };
  }
  async function subscribe(id = 'one') {
    const { client } = connect();
    auth(client, id);
    await settle();
    return client;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    http = new EventEmitter();
    source = {
      exists: vi.fn().mockResolvedValue(undefined),
      snapshot: vi.fn<ConnectionStatusSource['snapshot']>(() => ({
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
      })),
    };
    service = new RealtimeService({
      apiPrefix: 'api',
      corsOrigins: ['https://allowed.example'],
      whatsapp: { adminApiKey: token },
    } as IAppConfig);
    service.attach(http as Server, source);
    server = vi.mocked(WebSocketServer).mock.results[0]!.value as typeof server;
  });
  afterEach(() => {
    service.onModuleDestroy();
    vi.useRealTimers();
  });

  it.each(['/api/connections/events', '/api/test-panel/events'])(
    'accepts the current and legacy route: %s',
    (url) => {
      const { socket } = connect({ url });
      expect(socket.destroy).not.toHaveBeenCalled();
      expect(server.handleUpgrade).toHaveBeenCalledOnce();
    },
  );
  it.each(['/wrong', '/'])('rejects unknown routes: %s', (url) => {
    expect(connect({ url }).socket.destroy).toHaveBeenCalledOnce();
    expect(server.handleUpgrade).not.toHaveBeenCalled();
  });
  it.each(['https://localhost', 'https://allowed.example'])(
    'accepts an allowed origin: %s',
    (origin) => {
      expect(connect({ origin }).socket.destroy).not.toHaveBeenCalled();
    },
  );
  it.each(['https://untrusted.example', 'invalid-url'])(
    'rejects an invalid origin: %s',
    (origin) => {
      expect(connect({ origin }).socket.destroy).toHaveBeenCalledOnce();
      expect(server.handleUpgrade).not.toHaveBeenCalled();
    },
  );
  it('requires authentication within five seconds', async () => {
    const { client } = connect();
    await vi.advanceTimersByTimeAsync(4999);
    expect(client.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(client.close).toHaveBeenCalledWith(1008, 'Authentication required');
  });
  it.each([
    { token: 12, sessionId: 'one' },
    { token, sessionId: 12 },
    { token, sessionId: '' },
    { token: 'wrong', sessionId: 'one' },
  ])('rejects invalid subscription fields: %j', async (input) => {
    const { client } = connect();
    client.emit('message', Buffer.from(JSON.stringify(input)));
    await settle();
    expect(client.close).toHaveBeenCalledWith(1008, 'Invalid credentials');
    expect(source.exists).not.toHaveBeenCalled();
  });
  it.each(['{bad-json', 'null'])(
    'rejects malformed subscription JSON: %s',
    async (input) => {
      const { client } = connect();
      client.emit('message', Buffer.from(input));
      await settle();
      expect(client.close).toHaveBeenCalledWith(1008, 'Invalid subscription');
    },
  );
  it.each(['buffer', 'array', 'arraybuffer'])(
    'decodes %s subscription frames',
    async (format) => {
      const { client } = connect();
      const bytes = Buffer.from(JSON.stringify({ token, sessionId: 'one' }));
      client.emit(
        'message',
        format === 'buffer'
          ? bytes
          : format === 'array'
            ? [bytes.subarray(0, 10), bytes.subarray(10)]
            : Uint8Array.from(bytes).buffer,
      );
      await settle();
      expect(events(client).map((event) => event.event)).toEqual([
        'subscribed',
        'transport.status',
        'whatsapp.status',
      ]);
    },
  );
  it.each([
    [new NotFoundException(), 1008, 'Session not found'],
    [new Error('database'), 1013, 'Session validation unavailable'],
  ] as const)(
    'handles session lookup failure %#',
    async (error, code, reason) => {
      vi.mocked(source.exists).mockRejectedValueOnce(error);
      const { client } = connect();
      auth(client);
      await settle();
      expect(client.close).toHaveBeenCalledWith(code, reason);
      expect(client.send).not.toHaveBeenCalled();
    },
  );
  it('does not subscribe a client closed while its session lookup was pending', async () => {
    let resolve!: () => void;
    vi.mocked(source.exists).mockReturnValueOnce(
      new Promise<void>((done) => {
        resolve = done;
      }),
    );
    const { client } = connect();
    auth(client);
    client.close();
    resolve();
    await settle();
    expect(client.send).not.toHaveBeenCalled();
  });
  it('cancels authentication deadlines and avoids duplicate status broadcasts', async () => {
    const client = await subscribe();
    client.send.mockClear();
    await vi.advanceTimersByTimeAsync(5000);
    expect(client.close).not.toHaveBeenCalled();
    expect(client.send).not.toHaveBeenCalled();
    vi.mocked(source.snapshot).mockReturnValue({
      ...source.snapshot('one'),
      retryCount: 1,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(events(client)).toEqual([
      expect.objectContaining({
        event: 'whatsapp.status',
        data: expect.objectContaining({ retryCount: 1 }),
      }),
    ]);
  });
  it('pings live clients and terminates those that do not return pong', async () => {
    const client = await subscribe();
    client.send.mockClear();
    await vi.advanceTimersByTimeAsync(15000);
    expect(client.ping).toHaveBeenCalledOnce();
    expect(events(client)).toContainEqual(
      expect.objectContaining({ event: 'transport.status' }),
    );
    client.emit('pong');
    await vi.advanceTimersByTimeAsync(15000);
    expect(client.ping).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(15000);
    expect(client.terminate).toHaveBeenCalledOnce();
  });
  it('removes subscriptions on close and terminates errored clients', async () => {
    const client = await subscribe();
    client.emit('error', new Error('transport'));
    expect(client.terminate).toHaveBeenCalledOnce();
    client.send.mockClear();
    service.publish('one', 'message', {});
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.send).not.toHaveBeenCalled();
  });
  it('isolates sessions, serializes bigint and skips closed clients', async () => {
    const one = await subscribe();
    const two = await subscribe('two');
    one.send.mockClear();
    two.send.mockClear();
    service.publish('one', 'message', { timestamp: 12n });
    expect(events(one)).toEqual([
      expect.objectContaining({ sessionId: 'one', data: { timestamp: '12' } }),
    ]);
    expect(two.send).not.toHaveBeenCalled();
    one.readyState = 3;
    one.send.mockClear();
    service.publish('one', 'message', {});
    await vi.advanceTimersByTimeAsync(1000);
    expect(one.send).not.toHaveBeenCalled();
  });
  it('ignores payloads that cannot be serialized', async () => {
    const client = await subscribe();
    client.send.mockClear();
    const circular: { self?: unknown } = {};
    circular.self = circular;
    service.publish('one', 'message', circular);
    expect(client.send).not.toHaveBeenCalled();
  });
  it.each(['publish', 'status'])(
    'terminates slow clients while sending %s',
    async (action) => {
      const client = await subscribe();
      client.bufferedAmount = 1024 * 1024 + 1;
      if (action === 'publish') service.publish('one', 'message', {});
      else {
        vi.mocked(source.snapshot).mockReturnValue({
          ...source.snapshot('one'),
          retryCount: 1,
        });
        await vi.advanceTimersByTimeAsync(1000);
      }
      expect(client.terminate).toHaveBeenCalledOnce();
    },
  );
  it('closes clients when status retrieval fails', async () => {
    const client = await subscribe();
    vi.mocked(source.snapshot).mockImplementation(() => {
      throw new Error('status');
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.close).toHaveBeenCalledWith(1011, 'Status unavailable');
  });
  it('clears timers and terminates all clients on shutdown', async () => {
    const client = await subscribe();
    service.onModuleDestroy();
    expect(client.terminate).toHaveBeenCalledOnce();
    expect(server.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('can be destroyed without being attached', () => {
    expect(() =>
      new RealtimeService({} as IAppConfig).onModuleDestroy(),
    ).not.toThrow();
  });
  it('rejects upgrade requests without a URL', () => {
    const socket = { destroy: vi.fn() };
    http.emit('upgrade', { headers: {} }, socket, Buffer.alloc(0));
    expect(socket.destroy).toHaveBeenCalledOnce();
  });
  it('pings clients awaiting session validation without sending subscribed status', async () => {
    let resolve!: () => void;
    source.exists.mockReturnValueOnce(
      new Promise<void>((done) => {
        resolve = done;
      }),
    );
    const { client } = connect();
    client.close.mockImplementation(() => {});
    auth(client);
    await vi.advanceTimersByTimeAsync(15000);
    expect(client.ping).toHaveBeenCalledOnce();
    expect(client.send).not.toHaveBeenCalled();
    resolve();
    await settle();
  });
  it('accepts status changes to phone, disconnect reason and retry metadata', async () => {
    const client = await subscribe();
    client.send.mockClear();
    source.snapshot.mockReturnValue({
      ...source.snapshot('one'),
      connected: true,
      status: 'CONNECTED',
      accountPhone: '989121234567',
      generation: 2,
      retryCount: 1,
      nextRetryAt: '2026-11-07T12:00:00Z',
      lastDisconnectCode: 408,
      lastDisconnectedAt: '2026-11-07T11:59:00Z',
      requiresPairing: false,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(events(client)).toEqual([
      expect.objectContaining({
        event: 'whatsapp.status',
        data: expect.objectContaining({
          connected: true,
          accountPhone: '989121234567',
          generation: 2,
          lastDisconnectCode: 408,
        }),
      }),
    ]);
  });
});
