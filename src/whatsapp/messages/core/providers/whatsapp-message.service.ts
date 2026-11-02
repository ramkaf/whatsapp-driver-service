import { Injectable, Logger } from '@nestjs/common';
import { normalizeMessageContent, WAMessageStubType } from 'baileys';
import type {
  WASocket,
  WAMessage,
  BaileysEventMap,
  proto,
  WAMessageKey,
} from 'baileys';
import { WhatsappMediaService } from './whatsapp-media.service.ts';
import { extractRepliedMessage } from '../../utils/message.util.ts';
import { JsonlService } from './jsonl.service.ts';
import {
  decryptEncryptedEdit,
  isEncryptedEdit,
} from '../../utils/encrypted-edit.util.ts';

@Injectable()
export class WhatsappMessageService {
  constructor(
    private readonly whatsappMediaService: WhatsappMediaService,
    private readonly jsonlService: JsonlService,
  ) {}
  private readonly logger = new Logger(WhatsappMessageService.name);

  async handleUpsert(socket: WASocket, messages: WAMessage[]): Promise<void> {
    // Populate before the first await so rapid edits can find their originals.
    for (const message of messages) {
      if (!isEncryptedEdit(message)) this.jsonlService.remember(message);
    }
    for (const message of messages) {
      const chatId = message.key.remoteJid;
      if (!chatId || !message.message) {
        continue;
      }
      if (isEncryptedEdit(message)) {
        try {
          const target = normalizeMessageContent(message.message)
            ?.secretEncryptedMessage?.targetMessageKey;
          const original = await this.jsonlService.getMessage({
            ...message.key,
            id: target?.id,
          });
          const update = await decryptEncryptedEdit(socket, message, original);
          socket.ev.emit('messages.update', [update]);
        } catch (error) {
          this.logger.warn(
            `Failed to decrypt message edit ${message.key.id}: ${error instanceof Error ? error.message : 'unknown error'}`,
          );
        }
        continue;
      }
      if (message.key.fromMe) {
        await this.jsonlService.saveToFile({
          event: 'message.sent',
          receivedAt: new Date().toISOString(),
          chatId,
          message,
        });
        continue;
      }

      const repliedMessage = extractRepliedMessage(message);
      const obj = {
        event: 'message.received',
        receivedAt: new Date().toISOString(),
        chatId,
        message,
        ...(repliedMessage ? { repliedMessage } : {}),
      };
      try {
        // Archive incoming message
        await this.jsonlService.saveToFile(obj);
      } catch (error) {
        this.logger.error(
          `Failed to archive message: ${message.key.id}`,
          error instanceof Error ? error.stack : String(error),
        );
        continue;
      }

      // Store incoming and quoted media independently so either can succeed.
      const mediaMessages = repliedMessage
        ? [message, repliedMessage]
        : [message];
      for (const mediaMessage of mediaMessages) {
        const replyMetadata =
          mediaMessage === repliedMessage ? { repliedMessage } : {};

        try {
          const media = await this.whatsappMediaService.save(
            socket,
            mediaMessage,
            { skipIfStored: mediaMessage === repliedMessage },
          );
          if (!media) continue;
          const obj = {
            event: 'media.stored',
            receivedAt: new Date().toISOString(),
            chatId,
            messageId: message.key.id,
            ...replyMetadata,
            media,
          };
          await this.jsonlService.saveToFile(obj);
        } catch (error) {
          this.logger.error(
            `Failed to store media: ${mediaMessage.key.id} | replyTo=${message.key.id}`,
            error instanceof Error ? error.stack : String(error),
          );
          this.logger.error('Failed to archive media failure', error);
        }
      }
    }
  }
  async handleUpdate(
    socket: WASocket,
    updates: BaileysEventMap['messages.update'],
  ): Promise<void> {
    this.logger.log(`Received message updates: ${JSON.stringify(updates)}`);
    for (const { key, update } of updates) {
      const edited = update.message?.editedMessage;
      const revoked = update.messageStubType === WAMessageStubType.REVOKE;
      if (!edited && !revoked) continue;
      const event = revoked ? 'message.deleted' : 'message.edited';
      this.logger.log(`${event}: ${key.id}`);
      if (key.remoteJid) {
        await this.jsonlService.saveToFile({
          event,
          receivedAt: new Date().toISOString(),
          chatId: key.remoteJid,
          messageId: key.id,
          key,
          update,
        });
      }
    }
  }
  async handleReaction(
    _socket: WASocket,
    reactions: BaileysEventMap['messages.reaction'],
  ): Promise<void> {
    this.jsonlService.append('a.jsonl', {
      event: 'message.reaction',
      receivedAt: new Date().toISOString(),
      reactions,
    });
    for (const { key, reaction } of reactions) {
      if (!key.remoteJid || !key.id) continue;

      await this.jsonlService.saveToFile({
        event: reaction.text
          ? 'message.reaction.updated'
          : 'message.reaction.removed',
        receivedAt: new Date().toISOString(),
        chatId: key.remoteJid,
        messageId: key.id,
        key,
        reaction,
        sourceEvent: 'messages.reaction',
      });
    }
  }

  async handleDelete(
    _socket: WASocket,
    data: BaileysEventMap['messages.delete'],
  ): Promise<void> {
    const receivedAt = new Date().toISOString();

    // Entire chat messages cleared
    if ('all' in data) {
      await this.jsonlService.saveToFile({
        event: 'chat.messages.cleared',
        receivedAt,
        chatId: data.jid,
        all: true,
      });

      return;
    }

    // Individual messages deleted
    for (const key of data.keys) {
      console.log(JSON.stringify(data, null, 4));

      if (!key.remoteJid || !key.id) continue;

      await this.jsonlService.saveToFile({
        event: 'message.removed',
        receivedAt,
        chatId: key.remoteJid,
        messageId: key.id,
        key,
        sourceEvent: 'messages.delete',
      });
    }
  }
}
// function saveToFile(arg0: { event: string; receivedAt: string; reactions: { key: WAMessageKey; reaction: proto.IReaction; }[]; }) {
//   throw new Error('Function not implemented.');
// }
