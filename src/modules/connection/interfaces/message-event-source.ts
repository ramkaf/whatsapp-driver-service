import type { BaileysEventMap, WASocket } from '@whiskeysockets/baileys';

// Application events cross this boundary; sockets and authentication stay in ConnectionModule.
export const MESSAGE_EVENTS = [
  'messages.upsert',
  'messages.update',
  'messages.delete',
  'messages.reaction',
  'messages.media-update',
  'message-receipt.update',
  'messaging-history.set',
  'messaging-history.status',
  'chats.upsert',
  'chats.update',
  'chats.delete',
  'contacts.upsert',
  'contacts.update',
  'lid-mapping.update',
  'groups.upsert',
  'groups.update',
  'group-participants.update',
  'group.join-request',
  'group.member-tag.update',
  'presence.update',
  'call',
  'blocklist.set',
  'blocklist.update',
] as const satisfies readonly (keyof BaileysEventMap)[];

export type MessageEventName = (typeof MESSAGE_EVENTS)[number];
export type ConnectionMessageEvent<
  K extends MessageEventName = MessageEventName,
> = {
  [E in K]: {
    sessionId: string;
    event: E;
    at: string;
    data: BaileysEventMap[E];
  };
}[K];

export type MessageEventListener = (event: ConnectionMessageEvent) => void;

// Media consumers can request re-upload without accessing socket authentication.
export type MediaDownloadContext = Pick<WASocket, 'updateMediaMessage'>;

/** A server-side event source that works without a browser or WebSocket subscriber. */
export abstract class ConnectionMessageSource {
  abstract subscribe(listener: MessageEventListener): () => void;
  abstract getMediaDownloadContext(
    sessionId: string,
  ): MediaDownloadContext | undefined;
}
