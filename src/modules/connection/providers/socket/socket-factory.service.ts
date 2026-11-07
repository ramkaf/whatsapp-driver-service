import { Injectable } from '@nestjs/common';
import makeWASocket, { Browsers } from '@whiskeysockets/baileys';
import type { AuthenticationState, WASocket } from '@whiskeysockets/baileys';
import pino from 'pino';

import { RetryCache } from './retry-cache.ts';
import { SocketEventRegistrarService } from './socket-event-registrar.service.ts';

// Builds configured Baileys sockets with isolated retry caches.
@Injectable()
export class SocketFactoryService {
  constructor(private readonly events: SocketEventRegistrarService) {}
  create(
    sessionId: string,
    auth: AuthenticationState,
    qrTimeout: number,
  ): WASocket {
    const socket = makeWASocket({
      auth,
      browser: Browsers.ubuntu('Chrome'),
      syncFullHistory: false,
      markOnlineOnConnect: false,
      keepAliveIntervalMs: 25000,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      qrTimeout,
      // Baileys logs can contain authentication material. Application lifecycle
      // logs are emitted separately with sessionId and safe metadata only.
      logger: pino({ level: 'silent' }).child({ sessionId }),
      msgRetryCounterCache: new RetryCache(),
      // Preserve default initial sync and LID mapping handling.
    });
    this.events.register(sessionId, socket);
    return socket;
  }
}
