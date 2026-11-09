import { EventEmitter } from 'node:events';
import type { WAMessage, WASocket } from '@whiskeysockets/baileys';
import { SocketEventRegistrarService } from '../providers/socket/socket-event-registrar.service.ts';
import type { RealtimeService } from '../providers/realtime/realtime.service.ts';

describe('SocketEventRegistrarService', () => {
  it('scopes message events and filters connection secrets before publication', () => {
    const publish = vi.fn();
    const service = new SocketEventRegistrarService({
      publish,
    } as unknown as RealtimeService);
    const ev = new EventEmitter();
    service.register('one', { ev } as unknown as WASocket);
    const messages = { messages: [{ text: 'hello' }] };
    ev.emit('messages.upsert', messages);
    ev.emit('messages.update', []);
    ev.emit('connection.update', {
      connection: 'connecting',
      qr: 'secret',
      lastDisconnect: { error: 'private' },
      receivedPendingNotifications: true,
    });
    ev.emit('creds.update', { privateKey: 'secret' });
    expect(publish.mock.calls).toEqual([
      ['one', 'messages.upsert', messages],
      ['one', 'messages.update', []],
      [
        'one',
        'connection.update',
        { connection: 'connecting', receivedPendingNotifications: true },
      ],
    ]);
  });

  it('exposes only the correct session media capability and preserves socket binding', async () => {
    const service = new SocketEventRegistrarService({
      publish: vi.fn(),
    } as unknown as RealtimeService);
    const sockets = ['one', 'two'].map((id) => ({
      id,
      ev: new EventEmitter(),
      updateMediaMessage: vi.fn(async (message: WAMessage) => message),
      authState: { creds: 'private' },
    }));
    for (const socket of sockets)
      service.register(socket.id, socket as unknown as WASocket);
    const message: WAMessage = { key: { id: 'message' } };
    const context = service.getMediaDownloadContext('two')!;

    expect(Object.keys(context)).toEqual(['updateMediaMessage']);
    await expect(context.updateMediaMessage(message)).resolves.toBe(message);
    expect(sockets[1]!.updateMediaMessage).toHaveBeenCalledExactlyOnceWith(
      message,
    );
    expect(sockets[1]!.updateMediaMessage.mock.contexts[0]).toBe(sockets[1]);
    expect(sockets[0]!.updateMediaMessage).not.toHaveBeenCalled();
    expect(service.getMediaDownloadContext('missing')).toBeUndefined();
  });

  it('rejects captured media capabilities while a socket is closed and restores them on open', async () => {
    const service = new SocketEventRegistrarService({
      publish: vi.fn(),
    } as unknown as RealtimeService);
    const ev = new EventEmitter();
    const updateMediaMessage = vi.fn(async (message: WAMessage) => message);
    service.register('one', { ev, updateMediaMessage } as unknown as WASocket);
    const context = service.getMediaDownloadContext('one')!;
    const message: WAMessage = { key: { id: 'message' } };

    ev.emit('connection.update', { connection: 'close' });
    expect(service.getMediaDownloadContext('one')).toBeUndefined();
    await expect(context.updateMediaMessage(message)).rejects.toThrow(
      'Media socket is no longer available',
    );
    expect(updateMediaMessage).not.toHaveBeenCalled();
    ev.emit('connection.update', { connection: 'open' });
    expect(service.getMediaDownloadContext('one')).toBe(context);
    await expect(context.updateMediaMessage(message)).resolves.toBe(message);
    expect(updateMediaMessage).toHaveBeenCalledOnce();
  });

  it('revokes media access when the generation becomes stale or the registration is disposed', async () => {
    const service = new SocketEventRegistrarService({
      publish: vi.fn(),
    } as unknown as RealtimeService);
    let current = true;
    const updateMediaMessage = vi.fn(async (message: WAMessage) => message);
    const dispose = service.register(
      'one',
      { ev: new EventEmitter(), updateMediaMessage } as unknown as WASocket,
      () => current,
    );
    const context = service.getMediaDownloadContext('one')!;
    const message: WAMessage = { key: { id: 'message' } };

    current = false;
    expect(service.getMediaDownloadContext('one')).toBeUndefined();
    await expect(context.updateMediaMessage(message)).rejects.toThrow(
      'Media socket is no longer available',
    );
    current = true;
    dispose();
    expect(service.getMediaDownloadContext('one')).toBeUndefined();
    await expect(context.updateMediaMessage(message)).rejects.toThrow(
      'Media socket is no longer available',
    );
    expect(updateMediaMessage).not.toHaveBeenCalled();
  });

  it('keeps the replacement media context when the old registration is disposed', async () => {
    const service = new SocketEventRegistrarService({
      publish: vi.fn(),
    } as unknown as RealtimeService);
    const oldUpdate = vi.fn(async (message: WAMessage) => message);
    const currentUpdate = vi.fn(async (message: WAMessage) => message);
    const disposeOld = service.register('one', {
      ev: new EventEmitter(),
      updateMediaMessage: oldUpdate,
    } as unknown as WASocket);
    const oldContext = service.getMediaDownloadContext('one')!;
    const disposeCurrent = service.register('one', {
      ev: new EventEmitter(),
      updateMediaMessage: currentUpdate,
    } as unknown as WASocket);
    const currentContext = service.getMediaDownloadContext('one')!;
    const message: WAMessage = { key: { id: 'message' } };

    await expect(oldContext.updateMediaMessage(message)).rejects.toThrow(
      'Media socket is no longer available',
    );
    disposeOld();
    expect(service.getMediaDownloadContext('one')).toBe(currentContext);
    await expect(currentContext.updateMediaMessage(message)).resolves.toBe(
      message,
    );
    expect(oldUpdate).not.toHaveBeenCalled();
    expect(currentUpdate).toHaveBeenCalledOnce();
    disposeCurrent();
    expect(service.getMediaDownloadContext('one')).toBeUndefined();
  });
});
