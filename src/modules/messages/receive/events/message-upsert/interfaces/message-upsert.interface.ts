import type { Prisma } from '@database/client.js';
import { MessageChatType } from '../utils/message-upsert.util.ts';

export interface ReformedMessageSender extends Prisma.InputJsonObject {
  whatsappId: string | null;
  username: string | null;
  phoneNumber: string | null;
  displayName: string | null;
}

export interface ReformedMessageUpsertPayload extends Prisma.InputJsonObject {
  conversationId: string;
  chatType: MessageChatType;
  sender: ReformedMessageSender;
  messageId: string;
  content: string | null;
}
