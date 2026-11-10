import { Inject, Injectable } from '@nestjs/common';
import makeWASocket, { Browsers } from '@whiskeysockets/baileys';
import type { AuthenticationState, WASocket } from '@whiskeysockets/baileys';
import pino from 'pino';

import { RetryCache } from './retry-cache.ts';
import { SocketEventRegistrarService } from './socket-event-registrar.service.ts';

// Builds configured Baileys sockets with isolated retry caches.
@Injectable()
export class SocketFactoryService {
  private readonly disposers = new WeakMap<WASocket, () => void>();
  constructor(
    @Inject(SocketEventRegistrarService)
    private readonly events: SocketEventRegistrarService,
  ) {}
  create(
    sessionId: string,
    auth: AuthenticationState,
    qrTimeout: number,
    isCurrent = () => true,
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
    this.disposers.set(
      socket,
      this.events.register(sessionId, socket, isCurrent),
    );
    return socket;
  }

  release(socket: WASocket): void {
    this.disposers.get(socket)?.();
    this.disposers.delete(socket);
  }
}
