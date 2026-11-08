import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

interface RuntimeStatus {
  status: string;
  connected: boolean;
  reason?: string | null;
  requiresPairing?: boolean;
}

interface SessionRow {
  id: string;
  name: string;
  phone: string;
  status: string;
  pairingMethod: 'QR' | 'CODE';
  lastDisconnectCode?: number;
  runtime: RuntimeStatus;
}

class FakeSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => this.disconnect(1000));

  open(id: string) {
    this.onopen?.();
    this.frame(id, 'subscribed');
  }

  frame(id: string, event: string, data?: unknown) {
    this.onmessage?.({ data: JSON.stringify({ sessionId: id, event, data }) });
  }

  disconnect(code: number) {
    this.onclose?.({ code });
  }
}

interface Entry {
  row: SessionRow;
  status: RuntimeStatus;
  transport: string;
  socket: FakeSocket | null;
  count: number;
  lastMessageAt: number;
  preview: string;
  busy: boolean;
  qrImage: string;
  code: string;
  expiresAt: number;
  expired: boolean;
  error: string;
}

interface Monitor {
  entries: Map<string, Entry>;
  active: boolean;
  authBlocked: boolean;
  error: string;
  start(rows: SessionRow[], token: string): void;
  stop(): void;
  sync(rows: SessionRow[]): void;
  refresh(): Promise<void>;
  pair(entry: Entry, mode: string, phone?: string): Promise<void>;
  setStatus(entry: Entry, state: RuntimeStatus): void;
}

interface PairingResponse {
  status: 'AWAITING_PAIRING';
  code: string;
  expiresAt: string;
}

interface MonitorConstructor {
  new (options: {
    request: (path: string, body: unknown, token: string) => Promise<unknown>;
    createSocket: () => FakeSocket;
    onChange: () => void;
  }): Monitor;
  needsPairing(entry: { row: SessionRow; status: RuntimeStatus }): boolean;
}

const html = readFileSync(
  new URL('../public/test-panel.html', import.meta.url),
  'utf8',
);
const core = html.match(
  /<script id="session-monitor-core">([\s\S]*?)<\/script>/,
)?.[1];
if (!core)
  throw new Error('The session monitor script is missing from the panel');
const token = 'test-administration-token-with-at-least-32-characters';
const connected: RuntimeStatus = { status: 'CONNECTED', connected: true };
const disconnected: RuntimeStatus = {
  status: 'DISCONNECTED',
  connected: false,
};
const qrImage = 'data:image/png;base64,dGVzdC1xci1pbWFnZQ==';

function row(id: string, overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id,
    name: 'Account ' + id,
    phone: '989121234567',
    status: 'CONNECTED',
    pairingMethod: 'QR',
    runtime: { ...connected },
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

let MonitorClass: MonitorConstructor;
const monitors: Monitor[] = [];

function harness(rows: SessionRow[]) {
  const sockets: FakeSocket[] = [];
  const request = vi.fn(
    async (
      path: string,
      _body?: unknown,
      _token?: string,
    ): Promise<unknown> => {
      if (path === '/sessions') return rows;
      return { image: null, expiresAt: null };
    },
  );
  const onChange = vi.fn();
  const monitor = new MonitorClass({
    request,
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    onChange,
  });
  monitors.push(monitor);
  monitor.start(rows, token);
  return { monitor, sockets, request, onChange };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-08T08:00:00Z'));
  MonitorClass = runInNewContext(core + '\nWaSessionMonitor;', {
    Date,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  }) as MonitorConstructor;
});

afterEach(() => {
  for (const monitor of monitors.splice(0)) monitor.stop();
  vi.useRealTimers();
});

describe('all-account session monitor', () => {
  it('subscribes every account and observes incoming batches without selecting a session', () => {
    const { monitor, sockets } = harness([row('one'), row('two')]);
    sockets[0].open('one');
    sockets[1].open('two');
    expect(JSON.parse(sockets[0].send.mock.calls[0][0])).toEqual({
      token,
      sessionId: 'one',
    });
    expect(JSON.parse(sockets[1].send.mock.calls[0][0])).toEqual({
      token,
      sessionId: 'two',
    });
    const message = {
      key: {
        id: 'same-id',
        remoteJid: 'contact@s.whatsapp.net',
        fromMe: false,
      },
      message: { conversation: 'incoming' },
    };
    sockets[0].frame('one', 'messages.upsert', {
      messages: [
        message,
        { ...message, key: { ...message.key, id: 'second' } },
        { ...message, key: { ...message.key, id: 'own', fromMe: true } },
      ],
    });
    sockets[0].frame('one', 'messages.upsert', { messages: [message] });
    sockets[1].frame('two', 'messages.upsert', { messages: [message] });
    expect(monitor.entries.get('one')).toMatchObject({
      count: 2,
      preview: 'incoming',
      lastMessageAt: Date.now(),
    });
    expect(monitor.entries.get('two')).toMatchObject({
      count: 1,
      preview: 'incoming',
      lastMessageAt: Date.now(),
    });
    sockets[0].frame('two', 'messages.upsert', { messages: [message] });
    expect(monitor.entries.get('one')?.count).toBe(2);
  });

  it('detects a silent stream and reconnects it while another account keeps receiving', async () => {
    const { monitor, sockets } = harness([row('one'), row('two')]);
    sockets[0].open('one');
    sockets[1].open('two');
    await vi.advanceTimersByTimeAsync(30000);
    sockets[1].frame('two', 'transport.status', { connected: true });
    await vi.advanceTimersByTimeAsync(10000);
    expect(sockets[0].close).toHaveBeenCalledOnce();
    expect(monitor.entries.get('one')?.transport).toBe('disconnected');
    expect(monitor.entries.get('two')?.transport).toBe('connected');
    expect(sockets[1].close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000);
    expect(sockets).toHaveLength(3);
    sockets[2].open('one');
    sockets[2].frame('one', 'whatsapp.status', connected);
    expect(monitor.entries.get('one')?.transport).toBe('connected');
    expect(monitor.entries.get('one')?.status.connected).toBe(true);
  });

  it('reports WhatsApp disconnect separately from its healthy monitor socket and accepts recovery', () => {
    const { monitor, sockets } = harness([row('one'), row('two')]);
    sockets[0].open('one');
    sockets[1].open('two');
    sockets[0].frame('one', 'whatsapp.status', {
      ...disconnected,
      reason: 'TIMEOUT_OR_CONNECTION_LOST',
    });
    expect(monitor.entries.get('one')).toMatchObject({
      transport: 'connected',
      status: { connected: false },
    });
    expect(monitor.entries.get('two')).toMatchObject({
      transport: 'connected',
      status: { connected: true },
    });
    sockets[0].frame('one', 'whatsapp.status', connected);
    expect(monitor.entries.get('one')?.status.connected).toBe(true);
  });

  it('does not repeatedly reconnect a rejected subscription until a deliberate reload', async () => {
    const { monitor, sockets } = harness([row('one')]);
    sockets[0].disconnect(1008);
    await vi.advanceTimersByTimeAsync(10000);
    expect(sockets).toHaveLength(1);
    expect(monitor.entries.get('one')?.transport).toBe('blocked');
    monitor.start([row('one')], token);
    expect(sockets).toHaveLength(2);
  });

  it.each([
    [
      'logged out after restart',
      { status: 'LOGGED_OUT', runtime: disconnected },
      true,
    ],
    [
      'expired pairing after restart',
      { status: 'EXPIRED', runtime: disconnected },
      true,
    ],
    [
      'invalid stored authentication',
      { status: 'FAILED', lastDisconnectCode: 500, runtime: disconnected },
      true,
    ],
    [
      'multidevice mismatch',
      { status: 'FAILED', lastDisconnectCode: 411, runtime: disconnected },
      true,
    ],
    [
      'temporary network outage',
      {
        status: 'RECONNECTING',
        runtime: {
          ...disconnected,
          status: 'RECONNECTING',
          reason: 'TIMEOUT_OR_CONNECTION_LOST',
        },
      },
      false,
    ],
    [
      'manual stop',
      {
        status: 'DISCONNECTED',
        runtime: { ...disconnected, reason: 'MANUAL_DISCONNECT' },
      },
      false,
    ],
    [
      'replacement connection',
      {
        status: 'FAILED',
        runtime: { ...disconnected, reason: 'CONNECTION_REPLACED' },
      },
      false,
    ],
    [
      'live account with stale persisted metadata',
      { status: 'LOGGED_OUT', runtime: connected },
      false,
    ],
    [
      'authentication in progress',
      {
        status: 'LOGGED_OUT',
        runtime: { connected: false, status: 'AUTHENTICATING' },
      },
      false,
    ],
  ] as const)(
    'offers pairing appropriately for %s',
    (_name, overrides, expected) => {
      const metadata = row('one', overrides);
      expect(
        MonitorClass.needsPairing({ row: metadata, status: metadata.runtime }),
      ).toBe(expected);
    },
  );

  it('requests QR and CODE independently, then removes expired pairing secrets', async () => {
    const pendingCode = deferred<PairingResponse>();
    const rows = [
      row('qr', { status: 'LOGGED_OUT', runtime: disconnected }),
      row('code', {
        status: 'LOGGED_OUT',
        pairingMethod: 'CODE',
        runtime: disconnected,
      }),
    ];
    const { monitor, request } = harness(rows);
    const expiry = new Date(Date.now() + 2000).toISOString();
    request.mockImplementation(async (path) => {
      if (path === '/sessions') return rows;
      if (path === '/sessions/code/pairing-code') return pendingCode.promise;
      if (path === '/test-panel/qr/qr-image')
        return { image: qrImage, expiresAt: expiry };
      return {};
    });
    const qr = monitor.entries.get('qr')!;
    const code = monitor.entries.get('code')!;
    const codeWork = monitor.pair(code, 'CODE', '+۹۸۹۱۲۱۲۳۴۵۶۷');
    expect(code.busy).toBe(true);
    await monitor.pair(qr, 'QR');
    expect(qr.qrImage).toBe(qrImage);
    expect(code.busy).toBe(true);
    expect(request).toHaveBeenCalledWith(
      '/sessions/code/pairing-code',
      { phone: '989121234567' },
      token,
    );
    pendingCode.resolve({
      status: 'AWAITING_PAIRING',
      code: 'ABCD1234',
      expiresAt: expiry,
    });
    await codeWork;
    expect(code.code).toBe('ABCD1234');
    expect(qr.code).toBe('');
    await vi.advanceTimersByTimeAsync(2000);
    expect(qr.qrImage).toBe('');
    expect(code.code).toBe('');
    expect(qr.expired).toBe(true);
    expect(code.expired).toBe(true);
  });

  it('does not display an old pairing response after the account connects', async () => {
    const pending = deferred<PairingResponse>();
    const { monitor, request, sockets } = harness([
      row('one', {
        status: 'LOGGED_OUT',
        runtime: disconnected,
        pairingMethod: 'CODE',
      }),
    ]);
    request.mockReturnValueOnce(pending.promise);
    const entry = monitor.entries.get('one')!;
    const work = monitor.pair(entry, 'CODE');
    sockets[0].frame('one', 'whatsapp.status', connected);
    pending.resolve({
      status: 'AWAITING_PAIRING',
      code: 'STALE123',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    });
    await work;
    expect(entry.code).toBe('');
    expect(entry.qrImage).toBe('');
    expect(MonitorClass.needsPairing(entry)).toBe(false);
  });

  it('keeps the returned pairing code when polling observes the intermediate CONNECTING state', async () => {
    const pending = deferred<PairingResponse>();
    const { monitor, request } = harness([
      row('one', {
        status: 'LOGGED_OUT',
        runtime: disconnected,
        pairingMethod: 'CODE',
      }),
    ]);
    request.mockReturnValueOnce(pending.promise);
    const entry = monitor.entries.get('one')!;
    const work = monitor.pair(entry, 'CODE');
    monitor.sync([
      row('one', {
        status: 'CONNECTING',
        pairingMethod: 'CODE',
        runtime: { connected: false, status: 'CONNECTING' },
      }),
    ]);
    expect(MonitorClass.needsPairing(entry)).toBe(false);
    pending.resolve({
      status: 'AWAITING_PAIRING',
      code: 'READY123',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    });
    await work;
    expect(entry.code).toBe('READY123');
    expect(MonitorClass.needsPairing(entry)).toBe(true);
  });

  it('discards a pending pairing code after a deliberate manual disconnect', async () => {
    const pending = deferred<PairingResponse>();
    const { monitor, request, sockets } = harness([
      row('one', {
        status: 'LOGGED_OUT',
        runtime: disconnected,
        pairingMethod: 'CODE',
      }),
    ]);
    request.mockReturnValueOnce(pending.promise);
    const entry = monitor.entries.get('one')!;
    const work = monitor.pair(entry, 'CODE');
    sockets[0].frame('one', 'whatsapp.status', {
      ...disconnected,
      reason: 'MANUAL_DISCONNECT',
    });
    pending.resolve({
      status: 'AWAITING_PAIRING',
      code: 'STALE123',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    });
    await work;
    expect(entry.code).toBe('');
    expect(MonitorClass.needsPairing(entry)).toBe(false);
  });

  it('ignores pending requests after removal or credential changes and closes retired streams', async () => {
    const rows = [
      row('one'),
      row('two', {
        status: 'LOGGED_OUT',
        runtime: disconnected,
        pairingMethod: 'CODE',
      }),
    ];
    const { monitor, sockets, request } = harness(rows);
    const pending = deferred<PairingResponse>();
    request.mockReturnValueOnce(pending.promise);
    const removed = monitor.entries.get('two')!;
    const work = monitor.pair(removed, 'CODE');
    monitor.sync([rows[0]]);
    expect(sockets[1].close).toHaveBeenCalledOnce();
    expect(sockets[1].onmessage).toBeNull();
    pending.resolve({
      status: 'AWAITING_PAIRING',
      code: 'STALE123',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    });
    await work;
    expect(removed.code).toBe('');
    monitor.start(
      [row('new')],
      'replacement-administration-token-at-least-32-characters',
    );
    expect(sockets[0].close).toHaveBeenCalledOnce();
    expect([...monitor.entries.keys()]).toEqual(['new']);
    monitor.stop();
    expect(monitor.entries.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('blocks polling and clears pairing secrets when the administration key is rejected', async () => {
    const { monitor, request, sockets } = harness([
      row('one', {
        status: 'LOGGED_OUT',
        runtime: disconnected,
        pairingMethod: 'QR',
      }),
    ]);
    const entry = monitor.entries.get('one')!;
    entry.code = 'SECRET12';
    request.mockRejectedValueOnce(
      Object.assign(new Error('Unauthorized'), { status: 401 }),
    );
    await monitor.refresh();
    expect(monitor.authBlocked).toBe(true);
    expect(entry.code).toBe('');
    expect(entry.transport).toBe('blocked');
    expect(sockets[0].close).toHaveBeenCalledOnce();
    const calls = request.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000);
    expect(request).toHaveBeenCalledTimes(calls);
  });
});
