import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { PairingMethodEnum } from '../../sessions/interfaces/session.interface.ts';

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
  pairingMethod: PairingMethodEnum;
  isEnabled?: boolean;
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
  deleting: boolean;
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
  remove(entry: Entry): Promise<void>;
  reconnect(entry: Entry): Promise<void>;
  pair(
    entry: Entry,
    mode: string,
    phone?: string,
    initialRequest?: boolean,
  ): Promise<void>;
  setStatus(entry: Entry, state: RuntimeStatus): void;
}

interface PairingResponse {
  status: 'AWAITING_PAIRING';
  code: string;
  expiresAt: string;
}

interface StreamFrame {
  sessionId: string;
  event: string;
  data?: unknown;
}

interface MonitorConstructor {
  new (options: {
    request: (
      path: string,
      body: unknown,
      token: string,
      method?: string,
    ) => Promise<unknown>;
    createSocket: () => FakeSocket;
    onChange: () => void;
    onFrame?: (frame: StreamFrame) => void;
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
    pairingMethod: PairingMethodEnum.QR,
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
      _method?: string,
    ): Promise<unknown> => {
      if (path === '/sessions') return rows;
      return { image: null, expiresAt: null };
    },
  );
  const onChange = vi.fn();
  const onFrame = vi.fn<(frame: StreamFrame) => void>();
  const monitor = new MonitorClass({
    request,
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    onChange,
    onFrame,
  });
  monitors.push(monitor);
  monitor.start(rows, token);
  return { monitor, sockets, request, onChange, onFrame };
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
  it('sends DELETE and accepts an empty 204 API response', async () => {
    const source = html.match(
      /async function api\([\s\S]*?(?=\n      const numberFormat)/,
    )?.[0];
    expect(source).toBeTruthy();
    const response = {
      status: 204,
      ok: true,
      json: vi.fn(() => {
        throw new Error('A 204 response has no JSON body');
      }),
    };
    const fetch = vi.fn().mockResolvedValue(response);
    const api = runInNewContext(source + '\napi;', {
      $: () => ({ value: token }),
      base: '/api',
      AbortController,
      setTimeout,
      clearTimeout,
      fetch,
    }) as (
      path: string,
      body: unknown,
      token: string,
      method?: string,
    ) => Promise<unknown>;

    await expect(
      api('/sessions/one', undefined, token, 'DELETE'),
    ).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(
      '/api/sessions/one',
      expect.objectContaining({ method: 'DELETE', body: undefined }),
    );
    expect(response.json).not.toHaveBeenCalled();
  });

  it('soft-deletes an account using DELETE and stops its stream without removing the card', async () => {
    const rows = [row('one'), row('two')];
    const { monitor, sockets, request } = harness(rows);
    const entry = monitor.entries.get('one')!;
    entry.code = 'SECRET12';
    entry.qrImage = qrImage;
    request.mockResolvedValueOnce(undefined);

    await monitor.remove(entry);

    expect(request).toHaveBeenCalledExactlyOnceWith(
      '/sessions/one',
      undefined,
      token,
      'DELETE',
    );
    expect(monitor.entries.get('one')).toBe(entry);
    expect(entry).toMatchObject({
      row: { isEnabled: false, status: 'DISCONNECTED' },
      status: { connected: false, reason: 'MANUAL_DISCONNECT' },
      transport: 'disabled',
      code: '',
      qrImage: '',
      deleting: false,
    });
    expect(sockets[0].close).toHaveBeenCalledOnce();
    expect(sockets[0].onmessage).toBeNull();
    expect(sockets[1].close).not.toHaveBeenCalled();
    await monitor.remove(entry);
    expect(request).toHaveBeenCalledTimes(1);
    monitor.sync([
      {
        ...rows[0],
        isEnabled: false,
        status: 'DISCONNECTED',
        runtime: disconnected,
      },
      rows[1],
    ]);
    await vi.advanceTimersByTimeAsync(4000);
    expect(sockets).toHaveLength(2);
  });

  it('does not restore an enabled row from a list request that began before deletion', async () => {
    const rows = [row('one')];
    const { monitor, sockets, request } = harness(rows);
    const pendingList = deferred<SessionRow[]>();
    request.mockImplementation(async (path) => {
      if (path === '/sessions') return pendingList.promise;
      return undefined;
    });
    const refresh = monitor.refresh();
    const entry = monitor.entries.get('one')!;

    await monitor.remove(entry);
    pendingList.resolve(rows);
    await refresh;

    expect(entry.row.isEnabled).toBe(false);
    expect(entry.transport).toBe('disabled');
    expect(sockets).toHaveLength(1);
  });

  it('ignores a reconnect response that arrives after deletion succeeds', async () => {
    const { monitor, sockets, request } = harness([row('one')]);
    const pendingReconnect = deferred<SessionRow>();
    request.mockImplementation(async (path) =>
      path.endsWith('/reconnect') ? pendingReconnect.promise : undefined,
    );
    const entry = monitor.entries.get('one')!;
    const reconnect = monitor.reconnect(entry);
    await monitor.remove(entry);
    pendingReconnect.resolve(row('one', { isEnabled: true }));
    await reconnect;

    expect(entry.row.isEnabled).toBe(false);
    expect(entry.status.connected).toBe(false);
    expect(entry.transport).toBe('disabled');
    expect(sockets).toHaveLength(1);
    expect(entry.error).toBe('');
  });

  it('discards a pairing response that arrives after deletion succeeds', async () => {
    const { monitor, request } = harness([
      row('one', {
        status: 'EXPIRED',
        runtime: disconnected,
        pairingMethod: PairingMethodEnum.CODE,
      }),
    ]);
    const pendingCode = deferred<PairingResponse>();
    request.mockImplementation(async (path) =>
      path.endsWith('/pairing-code') ? pendingCode.promise : undefined,
    );
    const entry = monitor.entries.get('one')!;
    const pair = monitor.pair(entry, 'CODE');
    await monitor.remove(entry);
    pendingCode.resolve({
      status: 'AWAITING_PAIRING',
      code: 'STALE123',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    });
    await pair;

    expect(entry.row.isEnabled).toBe(false);
    expect(entry.code).toBe('');
    expect(entry.transport).toBe('disabled');
  });

  it('retains the active stream and reports a failed deletion', async () => {
    const { monitor, sockets, request } = harness([row('one')]);
    request.mockRejectedValueOnce(new Error('Server unavailable'));
    const entry = monitor.entries.get('one')!;

    await monitor.remove(entry);

    expect(entry.error).toBe('Server unavailable');
    expect(entry.deleting).toBe(false);
    expect(entry.row.isEnabled).not.toBe(false);
    expect(sockets[0].close).not.toHaveBeenCalled();
  });

  it('keeps disabled accounts quiet and starts their stream after explicit reconnect', async () => {
    const disabled = row('one', {
      isEnabled: false,
      status: 'DISCONNECTED',
      runtime: disconnected,
    });
    const { monitor, sockets, request } = harness([disabled]);
    const entry = monitor.entries.get('one')!;
    await vi.advanceTimersByTimeAsync(4000);
    expect(sockets).toHaveLength(0);
    expect(request).not.toHaveBeenCalled();
    expect(entry.transport).toBe('disabled');
    request.mockResolvedValueOnce(row('one', { isEnabled: true }));

    await monitor.reconnect(entry);

    expect(request).toHaveBeenCalledWith('/sessions/one/reconnect', {}, token);
    expect(entry.row.isEnabled).toBe(true);
    expect(sockets).toHaveLength(1);
  });

  it('allows explicit pairing for disabled logged-out accounts without automatic QR polling', async () => {
    const { monitor, sockets, request } = harness([
      row('one', {
        isEnabled: false,
        status: 'LOGGED_OUT',
        runtime: {
          ...disconnected,
          status: 'LOGGED_OUT',
          requiresPairing: true,
        },
      }),
    ]);
    const entry = monitor.entries.get('one')!;
    await vi.advanceTimersByTimeAsync(4000);
    expect(sockets).toHaveLength(0);
    expect(request).not.toHaveBeenCalled();
    request.mockImplementation(async (path) =>
      path.endsWith('/qr-image')
        ? {
            image: qrImage,
            expiresAt: new Date(Date.now() + 60000).toISOString(),
          }
        : {},
    );

    await monitor.pair(entry, 'QR');

    expect(request).toHaveBeenCalledWith('/sessions/one/qr', {}, token);
    expect(entry.row.isEnabled).toBe(true);
    expect(entry.qrImage).toBe(qrImage);
    expect(sockets).toHaveLength(1);
  });

  it('shares each valid frame after updating its account without opening another stream', () => {
    const { monitor, sockets, onFrame } = harness([row('one'), row('two')]);
    sockets[0].open('one');
    sockets[1].open('two');
    onFrame.mockClear();
    onFrame.mockImplementation((frame) => {
      if (frame.event === 'whatsapp.status')
        expect(monitor.entries.get(frame.sessionId)?.status).toEqual(
          frame.data,
        );
      if (frame.event === 'messages.upsert')
        expect(monitor.entries.get(frame.sessionId)?.count).toBe(1);
    });
    const messages = {
      messages: [
        {
          key: { id: 'incoming', fromMe: false },
          message: { conversation: 'shared event' },
        },
      ],
    };

    sockets[0].frame('one', 'whatsapp.status', disconnected);
    sockets[1].frame('two', 'messages.upsert', messages);
    sockets[1].frame('two', 'transport.status', { connected: true });
    sockets[0].frame('two', 'messages.upsert', messages);
    sockets[0].onmessage?.({ data: '{' });
    sockets[0].onmessage?.({ data: 'null' });
    sockets[0].onmessage?.({ data: '42' });

    expect(onFrame.mock.calls.map(([frame]) => frame)).toEqual([
      { sessionId: 'one', event: 'whatsapp.status', data: disconnected },
      { sessionId: 'two', event: 'messages.upsert', data: messages },
      {
        sessionId: 'two',
        event: 'transport.status',
        data: { connected: true },
      },
    ]);
    expect(sockets).toHaveLength(2);
  });

  it('ignores retired stream callbacks after recovery while sharing the current stream', async () => {
    const { monitor, sockets, onFrame } = harness([row('one')]);
    sockets[0].open('one');
    const retiredMessage = sockets[0].onmessage!;
    const retiredError = sockets[0].onerror!;
    const retiredClose = sockets[0].onclose!;

    sockets[0].disconnect(1006);
    await vi.advanceTimersByTimeAsync(3000);
    sockets[1].open('one');
    onFrame.mockClear();
    retiredMessage({
      data: JSON.stringify({
        sessionId: 'one',
        event: 'whatsapp.status',
        data: disconnected,
      }),
    });
    retiredError();
    retiredClose({ code: 1008 });

    expect(onFrame).not.toHaveBeenCalled();
    expect(monitor.entries.get('one')).toMatchObject({
      transport: 'connected',
      status: connected,
    });
    expect(sockets[1].close).not.toHaveBeenCalled();
    sockets[1].frame('one', 'whatsapp.status', disconnected);
    expect(onFrame).toHaveBeenCalledExactlyOnceWith({
      sessionId: 'one',
      event: 'whatsapp.status',
      data: disconnected,
    });
  });

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

  it('requests the initial CODE while a newly created session waits for socket readiness', async () => {
    const { monitor, request } = harness([
      row('new', {
        status: 'CONNECTING',
        pairingMethod: PairingMethodEnum.CODE,
        runtime: { status: 'CONNECTING', connected: false },
      }),
    ]);
    const entry = monitor.entries.get('new')!;
    const pending = deferred<PairingResponse>();
    request.mockImplementation(async () => pending.promise);
    await monitor.pair(entry, 'CODE');
    expect(request).not.toHaveBeenCalled();
    const work = monitor.pair(entry, 'CODE', entry.row.phone, true);
    expect(entry.busy).toBe(true);
    expect(request).toHaveBeenCalledWith(
      '/sessions/new/pairing-code',
      { phone: entry.row.phone },
      token,
    );
    pending.resolve({
      status: 'AWAITING_PAIRING',
      code: 'ABCD1234',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    });
    await work;
    expect(entry.code).toBe('ABCD1234');
    expect(entry.status.status).toBe('AWAITING_PAIRING');
    expect(entry.busy).toBe(false);
  });

  it('requests QR and CODE independently, then removes expired pairing secrets', async () => {
    const pendingCode = deferred<PairingResponse>();
    const rows = [
      row('qr', { status: 'LOGGED_OUT', runtime: disconnected }),
      row('code', {
        status: 'LOGGED_OUT',
        pairingMethod: PairingMethodEnum.CODE,
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
        pairingMethod: PairingMethodEnum.CODE,
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
        pairingMethod: PairingMethodEnum.CODE,
      }),
    ]);
    request.mockReturnValueOnce(pending.promise);
    const entry = monitor.entries.get('one')!;
    const work = monitor.pair(entry, 'CODE');
    monitor.sync([
      row('one', {
        status: 'CONNECTING',
        pairingMethod: PairingMethodEnum.CODE,
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
        pairingMethod: PairingMethodEnum.CODE,
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
        pairingMethod: PairingMethodEnum.CODE,
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
        pairingMethod: PairingMethodEnum.QR,
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
