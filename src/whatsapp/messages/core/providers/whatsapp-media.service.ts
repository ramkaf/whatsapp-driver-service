import { Injectable, Logger } from '@nestjs/common';
import { downloadMediaMessage, normalizeMessageContent } from 'baileys';
import type { WASocket, WAMessage, WAMessageContent } from 'baileys';
import pino from 'pino';
import { MinioStorageService } from '../../../../storage/minio/providers/minio-storage.service.ts';
import { EXTENSIONS } from '../../constants/media.constant.ts';
import type {
  MediaDescriptor,
  MediaType,
  StoredWhatsappMedia,
} from '../../interfaces/media.interface.ts';
import { safeId } from '../../utils/message.util.ts';

@Injectable()
export class WhatsappMediaService {
  private readonly logger = new Logger(WhatsappMediaService.name);
  private readonly baileysLogger = pino({ level: 'silent' });

  // Injects the storage service used to upload media streams.
  constructor(private readonly storage: MinioStorageService) {}

  // Downloads supported message media and stores it with its metadata.
  async save(
    socket: WASocket,
    message: WAMessage,
    options: { skipIfStored?: boolean } = {},
  ): Promise<StoredWhatsappMedia | null> {
    const startedAt = Date.now();
    let operation = 'prepare';

    const prepared = this.prepareMedia(message);

    if (!prepared) {
      return null;
    }

    const { objectKey, media, context } = prepared;

    try {
      if (options.skipIfStored) {
        operation = 'check-exists';

        if (await this.storage.objectExists(objectKey)) {
          this.logger.debug({
            message: 'Media already stored',
            ...context,
          });
          return null;
        }
      }

      operation = 'download';
      const stream = await this.downloadMedia(socket, message);

      operation = 'upload';
      const uploaded = await this.storage.uploadStream(
        objectKey,
        stream,
        media.mimeType,
      );

      const result: StoredWhatsappMedia = {
        ...uploaded,
        chatId: context.chatId,
        messageId: context.messageId,
        senderId: context.senderId,
        type: media.type,
        mimeType: media.mimeType,
        originalFileName: media.originalFileName,
      };

      this.logger.log({
        message: 'Media saved',
        ...context,
        objectKey,
        durationMs: Date.now() - startedAt,
      });

      return result;
    } catch (error) {
      this.logger.error({
        message: 'Media processing failed',
        ...context,
        operation,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      });

      throw error;
    }
  }
  private prepareMedia(message: WAMessage) {
    const chatId = message.key.remoteJid;
    const messageId = message.key.id;

    if (!chatId || !messageId || !message.message) {
      return null;
    }

    const content = normalizeMessageContent(message.message);

    if (!content) {
      return null;
    }

    const media = this.getMediaDescriptor(content);

    if (!media) {
      return null;
    }

    const senderId = this.getSenderId(message);

    const objectKey = this.createObjectKey(
      'conversations',
      chatId,
      senderId,
      messageId,
      media,
    );

    return {
      media,
      objectKey,
      context: {
        chatId,
        messageId,
        senderId,
        type: media.type,
      },
    };
  }
  private getSenderId(message: WAMessage): string {
    const chatId = message.key.remoteJid!;

    if (message.key.fromMe) {
      return 'self';
    }

    if (chatId.endsWith('@g.us')) {
      return message.key.participant ?? 'unknown';
    }

    return chatId;
  }
  private downloadMedia(socket: WASocket, message: WAMessage) {
    return downloadMediaMessage(
      message,
      'stream',
      {},
      {
        logger: this.baileysLogger,
        reuploadRequest: socket.updateMediaMessage,
      },
    );
  }
  // Extracts media metadata from normalized message content.
  private getMediaDescriptor(
    content: WAMessageContent,
  ): MediaDescriptor | null {
    if (content.imageMessage) {
      return this.createMediaDescriptor(
        'image',
        content.imageMessage.mimetype || 'image/jpeg',
      );
    }

    if (content.videoMessage) {
      return this.createMediaDescriptor(
        'video',
        content.videoMessage.mimetype || 'video/mp4',
      );
    }

    if (content.audioMessage) {
      return this.createMediaDescriptor(
        content.audioMessage.ptt ? 'voice' : 'audio',
        content.audioMessage.mimetype || 'audio/ogg',
      );
    }

    if (content.documentMessage) {
      return this.createMediaDescriptor(
        'document',
        content.documentMessage.mimetype || 'application/octet-stream',
        content.documentMessage.fileName || null,
      );
    }

    if (content.stickerMessage) {
      return this.createMediaDescriptor(
        'sticker',
        content.stickerMessage.mimetype || 'image/webp',
      );
    }

    return null;
  }

  // // Normalizes the MIME type and resolves the media file extension.
  private createMediaDescriptor(
    type: MediaType,
    mimeType: string,
    originalFileName: string | null = null,
  ): MediaDescriptor {
    const normalizedMime = mimeType.split(';')[0].trim().toLowerCase();
    const originalExtension = originalFileName
      ?.match(/\.([a-zA-Z0-9]{1,10})$/)?.[0]
      ?.toLowerCase();

    return {
      type,
      mimeType: normalizedMime,
      extension: originalExtension || EXTENSIONS[normalizedMime] || '.bin',
      originalFileName,
    };
  }

  // // Builds the storage path from chat, sender, message, and media details.
  private createObjectKey(
    category: string,
    chatId: string,
    senderId: string,
    messageId: string,
    media: MediaDescriptor,
  ): string {
    return [
      category,
      safeId(chatId),
      safeId(senderId),
      safeId(messageId),
      `${media.type}${media.extension}`,
    ].join('/');
  }
}
