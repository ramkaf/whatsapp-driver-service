import { EventEmitter } from 'node:events';
import type { WASocket } from '@whiskeysockets/baileys';
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
});
