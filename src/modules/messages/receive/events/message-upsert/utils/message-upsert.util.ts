import {
  jidDecode,
  jidNormalizedUser,
  type WAMessage,
} from '@whiskeysockets/baileys';
import { ReformedMessageUpsertPayload } from '../interfaces/message-upsert.interface.ts';

export enum MessageChatType {
  CHANNEL = 'Channel',
  GROUP = 'Group',
  PRIVATE = 'Private',
  UNKNOWN = 'Unknown',
}

export function getMessageChatType(message: WAMessage): MessageChatType {
  const remoteJid = message.key.remoteJid;

  if (!remoteJid) {
    return MessageChatType.UNKNOWN;
  }

  if (remoteJid.endsWith('@newsletter')) {
    return MessageChatType.CHANNEL;
  }

  if (remoteJid.endsWith('@g.us')) {
    return MessageChatType.GROUP;
  }

  if (remoteJid.endsWith('@s.whatsapp.net') || remoteJid.endsWith('@lid')) {
    return MessageChatType.PRIVATE;
  }

  return MessageChatType.UNKNOWN;
}

export function extractPhoneNumber(
  ids: (string | null | undefined)[],
): string | null {
  for (const id of ids) {
    const decoded = jidDecode(id || undefined);
    if (
      decoded &&
      ['s.whatsapp.net', 'c.us', 'hosted'].includes(decoded.server) &&
      /^\d+$/.test(decoded.user)
    ) {
      return `+${decoded.user}`;
    }
  }
  return null;
}

export function getMessageSender(
  message: WAMessage,
): ReformedMessageUpsertPayload['sender'] {
  const { key } = message;

  const server = jidDecode(key.remoteJid || undefined)?.server;

  const direct = Boolean(
    server &&
    ['s.whatsapp.net', 'c.us', 'lid', 'hosted', 'hosted.lid'].includes(server),
  );

  const ids = direct
    ? [key.remoteJid, key.remoteJidAlt]
    : [key.participant, key.participantAlt, message.participant];

  const senderId = ids.find((id) => Boolean(id));

  return {
    whatsappId: senderId ? jidNormalizedUser(senderId) : null,
    username:
      (direct ? key.remoteJidUsername : key.participantUsername) || null,
    phoneNumber: extractPhoneNumber(ids),
    displayName: message.pushName || null,
  };
}
