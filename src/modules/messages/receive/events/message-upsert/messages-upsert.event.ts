import { extractMessageContent } from '@whiskeysockets/baileys';
import type { Prisma } from '@database/client.js';
import { Injectable } from '@nestjs/common';
import { InboxEventHandler } from '../../interfaces/inbox-event-handler.ts';
import type { ReformedMessageUpsertPayload } from './interfaces/message-upsert.interface.ts';
import { deserializeInboxMessage } from '../../../../inbox/utils/inbox.util.ts';
import {
  getMessageChatType,
  getMessageSender,
} from './utils/message-upsert.util.ts';

@Injectable()
export class MessagesUpsertEventHandler extends InboxEventHandler<'messages.upsert'> {
  readonly event = 'messages.upsert' as const;

  protected shouldHandle(payload: Prisma.InputJsonValue): boolean {
    const message = deserializeInboxMessage(payload);

    if (message.key.fromMe) {
      return false;
    }

    const content = extractMessageContent(message.message);

    if (content?.reactionMessage || content?.encReactionMessage) {
      return false;
    }

    return true;
  }
  protected normalizePayload(
    payload: Prisma.InputJsonValue,
  ): ReformedMessageUpsertPayload {
    const message = deserializeInboxMessage(payload);
    const content = extractMessageContent(message.message);
    return {
      conversationId: message.key.remoteJid!,
      messageId: message.key.id!,
      content:
        content?.conversation ??
        content?.extendedTextMessage?.text ??
        content?.imageMessage?.caption ??
        content?.videoMessage?.caption ??
        content?.documentMessage?.caption ??
        null,
      chatType: getMessageChatType(message),
      sender: getMessageSender(message),
    };
  }
}
