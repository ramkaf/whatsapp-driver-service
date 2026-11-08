import { Injectable } from '@nestjs/common';
import type { WASocket } from '@whiskeysockets/baileys';
import { RealtimeService } from '../realtime/realtime.service.ts';

// Forwards public socket events while excluding pairing and authentication secrets.
@Injectable()
export class SocketEventRegistrarService {
  constructor(private readonly realtime: RealtimeService) {}

  register(sessionId: string, socket: WASocket): void {
    socket.ev.on('messages.upsert', (data) =>
      this.realtime.publish(sessionId, 'messages.upsert', data),
    );
    socket.ev.on('messages.update', (data) =>
      this.realtime.publish(sessionId, 'messages.update', data),
    );
    socket.ev.on('connection.update', (data) =>
      this.realtime.publish(sessionId, 'connection.update', {
        connection: data.connection,
        receivedPendingNotifications: data.receivedPendingNotifications,
      }),
    );
  }
}
