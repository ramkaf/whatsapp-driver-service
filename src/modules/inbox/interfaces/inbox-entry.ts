import type { Prisma } from '@database/client.js';
import type { MessageEventName } from '../../connection/interfaces/message-event-source.ts';

/** A single normalized item, ready for durable storage. */
export interface InboxEntry {
  event: MessageEventName;
  sessionId: string;
  key: string;
  payload: Prisma.InputJsonValue;
  reformPayload?: Prisma.InputJsonValue;
  haveMedia: boolean;
}
