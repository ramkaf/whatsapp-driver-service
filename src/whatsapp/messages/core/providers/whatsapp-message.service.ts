import { Injectable, Logger } from '@nestjs/common';
import type { WASocket, WAMessage, BaileysEventMap } from 'baileys';
import { WhatsappMediaService } from './whatsapp-media.service.ts';
import {
  appendJsonl,
  extractRepliedMessage,
} from '../../utils/message.util.ts';
import { JsonlService } from './jsonl.service.ts';

@Injectable()
export class WhatsappMessageService {
  constructor(
    private readonly whatsappMediaService: WhatsappMediaService,
    private readonly jsonlService: JsonlService,
  ) {}
  private readonly logger = new Logger(WhatsappMessageService.name);

  async handleUpsert(socket: WASocket, messages: WAMessage[]): Promise<void> {
    for (const message of messages) {
      const chatId = message.key.remoteJid;
      if (!chatId || !message.message || message.key.fromMe) {
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
    console.log(`Received message updates: ${JSON.stringify(updates)}`);
  }

  async handleDelete(
    socket: WASocket,
    data: BaileysEventMap['messages.delete'],
  ): Promise<void> {
    console.log(`Received message deletions: ${JSON.stringify(data)}`);
  }
}
