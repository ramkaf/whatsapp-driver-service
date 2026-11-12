import type { Prisma } from '@database/client.js';
import { HashUtil } from '@libs/common/helper/hash.util.js';
import { BufferJSON } from '@whiskeysockets/baileys';
import type { WAMessage } from '@whiskeysockets/baileys';
import type {
  ConnectionMessageEvent,
  MessageEventName,
} from '../../../connection/interfaces/message-event-source.ts';
import type { InboxEntry } from '../../../inbox/interfaces/inbox-entry.ts';
import { generateMessageFingerprint } from '../../../inbox/utils/inbox.util.ts';
import { MediaDetectorUtil } from '../../../inbox/utils/media-detactor.utils.ts';

/** Retain bytes, protobuf timestamps and error details in the JSON payload. */
function serializePayload(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (key, item: unknown) => {
      if (typeof item === 'bigint') return item.toString();
      if (item instanceof Error) {
        return {
          ...Object.fromEntries(Object.entries(item)),
          name: item.name,
          message: item.message,
        };
      }
      return BufferJSON.replacer(key, item);
    }),
  ) as Prisma.InputJsonValue;
}

/** Object property order must not affect deduplication. Array order is preserved. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(
        Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
      );
    }
    return item;
  });
}

function messageEntry(
  event: ConnectionMessageEvent<'messages.upsert' | 'messaging-history.set'>,
  message: WAMessage,
): InboxEntry[] {
  const { remoteJid, id, fromMe } = message.key;
  if (!remoteJid || !id || fromMe) return [];
  return [
    {
      event: event.event,
      sessionId: event.sessionId,
      // Intentionally shared across sessions AND live/history sources.
      key: generateMessageFingerprint(remoteJid, id),
      payload: serializePayload(message),
      haveMedia: MediaDetectorUtil.hasMedia(message),
    },
  ];
}

function notificationEntry(
  event: MessageEventName,
  sessionId: string,
  value: unknown,
): InboxEntry {
  const payload = serializePayload(value);
  return {
    event,
    sessionId,
    // Keep source timestamps. Never hash the local receive time or session.
    key: HashUtil.sha256(`${event}:${canonicalJson(payload)}`),
    payload,
    haveMedia: false,
  };
}

/** Split batches before deduplication; delivery batch boundaries are not identity. */
export function toInboxEntries(event: ConnectionMessageEvent): InboxEntry[] {
  if (
    event.event === 'messages.upsert' ||
    event.event === 'messaging-history.set'
  ) {
    return event.data.messages.flatMap((message) =>
      messageEntry(event, message),
    );
  }
  if (event.event === 'messages.delete' && 'keys' in event.data) {
    return event.data.keys.map((key) =>
      notificationEntry(event.event, event.sessionId, { keys: [key] }),
    );
  }
  const items: unknown[] = Array.isArray(event.data)
    ? event.data
    : [event.data];
  return items.map((item) =>
    notificationEntry(event.event, event.sessionId, item),
  );
}
