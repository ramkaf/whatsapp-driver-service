import { createDecipheriv, hkdfSync } from 'node:crypto';
import {
  isJidGroup,
  jidNormalizedUser,
  normalizeMessageContent,
  proto,
  toNumber,
} from 'baileys';
import type { WASocket, WAMessage, WAMessageUpdate } from 'baileys';

export function isEncryptedEdit(message: WAMessage): boolean {
  return (
    normalizeMessageContent(message.message)?.secretEncryptedMessage
      ?.secretEncType ===
    proto.Message.SecretEncryptedMessage.SecretEncType.MESSAGE_EDIT
  );
}

// Compatibility for Baileys rc14, which only handles protocolMessage edits.
export async function decryptEncryptedEdit(
  socket: WASocket,
  message: WAMessage,
  original: proto.IMessage | undefined,
): Promise<WAMessageUpdate> {
  const envelope = normalizeMessageContent(
    message.message,
  )?.secretEncryptedMessage;
  const target = envelope?.targetMessageKey;
  const secret = original?.messageContextInfo?.messageSecret;
  if (
    !isEncryptedEdit(message) ||
    !target?.id ||
    !target.fromMe ||
    !envelope?.encPayload ||
    envelope.encPayload.length <= 16 ||
    envelope.encIv?.length !== 12 ||
    secret?.length !== 32 ||
    (target.remoteJid &&
      jidNormalizedUser(target.remoteJid) !==
        jidNormalizedUser(message.key.remoteJid ?? ''))
  ) {
    throw new Error(
      'Invalid encrypted edit or missing original message secret',
    );
  }

  const group = isJidGroup(message.key.remoteJid ?? '');
  const authorJids = message.key.fromMe
    ? [socket.user?.id, socket.user?.lid]
    : group
      ? [message.key.participant, message.key.participantAlt]
      : [message.key.remoteJid, message.key.remoteJidAlt];
  const candidates = new Set(
    authorJids
      .filter((jid): jid is string => Boolean(jid))
      .map(jidNormalizedUser),
  );
  for (const jid of candidates) {
    const mapping = socket.signalRepository.lidMapping;
    try {
      const alternate = jid.endsWith('@lid')
        ? await mapping.getPNForLID(jid)
        : await mapping.getLIDForPN(jid);
      if (alternate) candidates.add(jidNormalizedUser(alternate));
    } catch {
      // Received identities may already be sufficient if alias lookup fails.
    }
  }

  // Edits bind both the original author and editor into HKDF info.
  let decoded: proto.Message | undefined;
  for (const sender of candidates) {
    for (const editor of candidates) {
      const info = Buffer.concat([
        Buffer.from(target.id),
        Buffer.from(sender),
        Buffer.from(editor),
        Buffer.from('Message Edit'),
      ]);
      const key = hkdfSync('sha256', secret, Buffer.alloc(32), info, 32);
      try {
        const payload = Buffer.from(envelope.encPayload);
        const decipher = createDecipheriv(
          'aes-256-gcm',
          Buffer.from(key),
          envelope.encIv,
        );
        decipher.setAuthTag(payload.subarray(-16));
        decoded = proto.Message.decode(
          Buffer.concat([
            decipher.update(payload.subarray(0, -16)),
            decipher.final(),
          ]),
        );
        break;
      } catch {
        // A PN/LID alternate may be required for the authenticated key.
      }
    }
    if (decoded) break;
  }
  const protocol = decoded?.protocolMessage;
  if (
    protocol?.type !== proto.Message.ProtocolMessage.Type.MESSAGE_EDIT ||
    !protocol.editedMessage ||
    (protocol.key?.id && protocol.key.id !== target.id)
  ) {
    throw new Error('Cannot authenticate or decode encrypted message edit');
  }
  return {
    key: { ...message.key, id: target.id },
    update: {
      message: { editedMessage: { message: protocol.editedMessage } },
      messageTimestamp: protocol.timestampMs
        ? Math.floor(toNumber(protocol.timestampMs) / 1000)
        : message.messageTimestamp,
    },
  };
}
