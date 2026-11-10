import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  WASocket,
  BaileysEventMap,
  ConnectionState,
} from '@whiskeysockets/baileys';
import { RealtimeService } from '../realtime/realtime.service.ts';
import {
  ConnectionMessageSource,
  MESSAGE_EVENTS,
} from '../../interfaces/message-event-source.ts';
import type {
  ConnectionMessageEvent,
  MessageEventListener,
  MessageEventName,
  MediaDownloadContext,
} from '../../interfaces/message-event-source.ts';

/** Bridges each current socket to server-side consumers and the existing browser stream. */
@Injectable()
export class SocketEventRegistrarService extends ConnectionMessageSource {
  private readonly logger = new Logger(SocketEventRegistrarService.name);
  private readonly listeners = new Set<MessageEventListener>();
  private readonly mediaContexts = new Map<
    string,
    { context: MediaDownloadContext; isCurrent: () => boolean }
  >();

  constructor(
    @Inject(RealtimeService) private readonly realtime: RealtimeService,
  ) {
    super();
  }

  subscribe(listener: MessageEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getMediaDownloadContext(sessionId: string): MediaDownloadContext | undefined {
    const registration = this.mediaContexts.get(sessionId);
    return registration?.isCurrent() ? registration.context : undefined;
  }

  register(
    sessionId: string,
    socket: WASocket,
    isCurrent = () => true,
  ): () => void {
    let disposed = false;
    let closed = false;
    const usable = () =>
      !disposed &&
      !closed &&
      isCurrent() &&
      this.mediaContexts.get(sessionId)?.context === context;
    const context: MediaDownloadContext = {
      updateMediaMessage: async (message) => {
        if (!usable())
          throw new ServiceUnavailableException(
            'Media socket is no longer available',
          );
        return socket.updateMediaMessage(message);
      },
    };
    this.mediaContexts.set(sessionId, { context, isCurrent: usable });
    const cleanup: (() => void)[] = [];
    const bindMessage = <K extends MessageEventName>(event: K) => {
      const listener = (data: BaileysEventMap[K]) => {
        if (disposed || closed || !isCurrent()) return;
        const frame = {
          sessionId,
          event,
          at: new Date().toISOString(),
          data,
        } as ConnectionMessageEvent;
        for (const consumer of this.listeners) {
          try {
            consumer(frame);
          } catch {
            this.logger.error({
              sessionId,
              event,
              reason: 'message_consumer_failed',
            });
          }
        }
        this.realtime.publish(sessionId, event, data);
      };
      socket.ev.on(event, listener);
      cleanup.push(() => socket.ev.off(event, listener));
    };
    for (const event of MESSAGE_EVENTS) bindMessage(event);
    const connection = (data: Partial<ConnectionState>) => {
      if (disposed || !isCurrent()) return;
      if (data.connection === 'close') closed = true;
      if (data.connection === 'open') closed = false;
      this.realtime.publish(sessionId, 'connection.update', {
        connection: data.connection,
        receivedPendingNotifications: data.receivedPendingNotifications,
      });
    };
    socket.ev.on('connection.update', connection);
    cleanup.push(() => socket.ev.off('connection.update', connection));
    return () => {
      disposed = true;
      if (this.mediaContexts.get(sessionId)?.context === context)
        this.mediaContexts.delete(sessionId);
      for (const dispose of cleanup) dispose();
    };
  }
}
