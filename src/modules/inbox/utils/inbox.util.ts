import { HashUtil } from '@libs/common/helper/hash.util.js';
import type { Prisma } from '@database/client.js';
import { BufferJSON, proto } from '@whiskeysockets/baileys';
import type { WAMessage } from '@whiskeysockets/baileys';

export function generateMessageFingerprint(
  remoteJid: string,
  messageId: string,
): string {
  return HashUtil.sha256(`${remoteJid}:${messageId}`);
}

/** Restores protobuf bytes and timestamps after a message has passed through JSON. */
export function deserializeInboxMessage(payload: Prisma.JsonValue): WAMessage {
  const message = JSON.parse(JSON.stringify(payload), (key, value: unknown) => {
    // Older inbox records may contain Node's default Buffer JSON format.
    if (
      value !== null &&
      typeof value === 'object' &&
      'type' in value &&
      value.type === 'Buffer' &&
      'data' in value &&
      Array.isArray(value.data)
    ) {
      return Buffer.from(value.data);
    }
    return BufferJSON.reviver(key, value);
  });

  const restored = proto.WebMessageInfo.fromObject(message);
  if (!restored.key?.id || !restored.key.remoteJid) {
    throw new Error('Inbox payload is missing the WhatsApp message key');
  }

  return Object.assign(restored, { key: restored.key });
}
