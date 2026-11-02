import { EventEmitter } from 'node:events';
import type { WASocket } from 'baileys';
import type { WhatsappSocketFactory } from './wa-socket.factory.ts';
import type { WhatsappEventListener } from '../../messages/core/providers/whatsapp-event-listener.service.ts';
import { WhatsappConnectService } from './wa-connect.service.ts';
import { WhatsappSessionState } from './wa-session.state.ts';
import { WhatsappConnectionHandler } from './wa-connection.handler.ts';
import { SessionStatus } from '../enum/session-status.enum.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup() {
  const sockets: { ev: EventEmitter; end: ReturnType<typeof vi.fn> }[] = [];
  const saves: ReturnType<typeof vi.fn>[] = [];
  const factory = {
    create: vi.fn(async () => {
      const socket = {
        ev: new EventEmitter(),
        end: vi.fn().mockResolvedValue(undefined),
      };
      const saveCreds = vi.fn().mockResolvedValue(undefined);
      sockets.push(socket);
      saves.push(saveCreds);
      return {
        socket: socket as unknown as WASocket,
        saveCreds,
        hasSavedSession: sockets.length === 1,
      };
    }),
    archiveSession: vi.fn().mockResolvedValue(undefined),
  };
  const state = new WhatsappSessionState();
  const service = new WhatsappConnectService(
    factory as unknown as WhatsappSocketFactory,
    state,
    new WhatsappConnectionHandler(state),
    { register: vi.fn() } as unknown as WhatsappEventListener,
  );
  return { service, state, factory, sockets, saves };
}

describe('session reset', () => {
  afterEach(() => vi.useRealTimers());

  it('replaces a logged-out session and accepts a fresh QR, ignoring stale socket events', async () => {
    const { service, factory, sockets } = setup();
    await service.connect();
    sockets[0].ev.emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: 401 } } },
    });
    expect(service.getStatus().status).toBe(SessionStatus.LOGGED_OUT);
    await service.resetSession();
    expect(factory.archiveSession).toHaveBeenCalledTimes(1);
    expect(service.getStatus()).toMatchObject({
      status: 'connecting',
      hasSavedSession: false,
      lastDisconnectCode: null,
      qrEndpoint: '/api/v1/whatsapp/connection/qr',
    });
    sockets[0].ev.emit('connection.update', { qr: 'stale-qr' });
    expect(service.getStatus().qrAvailable).toBe(false);
    sockets[1].ev.emit('connection.update', { qr: 'new-qr' });
    expect(service.getStatus().status).toBe(SessionStatus.AWAITING_QR);
    expect((await service.getQr()).qr).toBe('new-qr');
    await service.onModuleDestroy();
  });

  it('drains credential writes before archiving and shares concurrent reset/connect requests', async () => {
    const { service, factory, sockets, saves } = setup();
    await service.connect();
    const pendingSave = deferred();
    saves[0].mockReturnValueOnce(pendingSave.promise);
    sockets[0].ev.emit('creds.update', {});
    await Promise.resolve();
    const reset = service.resetSession();
    const secondReset = service.resetSession();
    const connect = service.connect();
    await vi.waitFor(() => expect(sockets[0].end).toHaveBeenCalled());
    expect(factory.archiveSession).not.toHaveBeenCalled();
    pendingSave.resolve();
    await Promise.all([reset, secondReset, connect]);
    expect(factory.archiveSession).toHaveBeenCalledTimes(1);
    expect(factory.create).toHaveBeenCalledTimes(2);
    await service.onModuleDestroy();
  });

  it('does not let a delayed old disconnect restart the new session', async () => {
    vi.useFakeTimers();
    const { service, factory, sockets } = setup();
    await service.connect();
    const close = deferred();
    sockets[0].end.mockReturnValueOnce(close.promise);
    sockets[0].ev.emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: 428 } } },
    });
    await service.resetSession();
    close.resolve();
    await vi.advanceTimersByTimeAsync(60000);
    expect(factory.create).toHaveBeenCalledTimes(2);
    await service.onModuleDestroy();
  });

  it('leaves the service in error when archiving fails and allows a retry', async () => {
    const { service, factory } = setup();
    await service.connect();
    factory.archiveSession.mockRejectedValueOnce(new Error('archive denied'));
    await expect(service.resetSession()).rejects.toThrow(
      'Could not reset WhatsApp session',
    );
    expect(service.getStatus().status).toBe(SessionStatus.ERROR);
    expect(factory.create).toHaveBeenCalledTimes(1);
    await service.resetSession();
    expect(factory.create).toHaveBeenCalledTimes(2);
    await service.onModuleDestroy();
  });

  it('does not reopen a socket if shutdown starts during reset', async () => {
    const { service, factory } = setup();
    await service.connect();
    const archive = deferred();
    factory.archiveSession.mockReturnValueOnce(archive.promise);
    const reset = service.resetSession();
    await vi.waitFor(() => expect(factory.archiveSession).toHaveBeenCalled());
    const shutdown = service.onModuleDestroy();
    archive.resolve();
    await Promise.all([reset, shutdown]);
    expect(factory.create).toHaveBeenCalledTimes(1);
    await expect(service.resetSession()).rejects.toThrow('shutting down');
  });
});
