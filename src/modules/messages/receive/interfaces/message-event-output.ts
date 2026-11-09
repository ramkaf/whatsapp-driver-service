import type { MessageEventName } from '../../../connection/interfaces/message-event-source.ts';
import type { StoredWhatsappMedia } from '../../../media/interfaces/media.interface.ts';

export interface ReceivedMessageEvent {
  sessionId: string;
  event: MessageEventName;
  at: string;
  data: unknown;
  media?: StoredWhatsappMedia;
  mediaError?: 'MEDIA_STORAGE_FAILED';
}

/** Replace this output to store or forward messages without changing event handlers. */
export abstract class MessageEventOutput {
  abstract write(event: ReceivedMessageEvent): void | Promise<void>;
}
