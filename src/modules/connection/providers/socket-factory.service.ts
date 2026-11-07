import { Injectable } from '@nestjs/common';
import makeWASocket, { Browsers } from '@whiskeysockets/baileys';
import type {
  AuthenticationState,
  CacheStore,
  WASocket,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { RealtimeService } from './realtime.service.ts';

class RetryCache implements CacheStore {
  private readonly values = new Map<
    string,
    { value: unknown; expires: number }
  >();
  get<T>(key: string): T | undefined {
    const entry = this.values.get(key);
    if (!entry) return undefined;
    if (entry.expires <= Date.now()) {
      this.values.delete(key);
      return undefined;
    }
    return entry.value as T;
  }
  set<T>(key: string, value: T): void {
    this.values.delete(key);
    if (this.values.size >= 1000)
      this.values.delete(this.values.keys().next().value!);
    this.values.set(key, { value, expires: Date.now() + 300000 });
  }
  del(key: string): void {
    this.values.delete(key);
  }
  flushAll(): void {
    this.values.clear();
  }
}

// سوکت Baileys هر سشن را می‌سازد و رویدادهای پیام و اتصال آن را برای انتشار زنده منتقل می‌کند.
@Injectable()
export class SocketFactoryService {
  constructor(private readonly realtime: RealtimeService) {}
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
    return socket;
  }
}
