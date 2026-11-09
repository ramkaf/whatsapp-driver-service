import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import type { ReadStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  extractMessageContent,
  downloadMediaMessage,
} from '@whiskeysockets/baileys';
import type { WAMessage, WAMessageContent } from '@whiskeysockets/baileys';
import type {
  MediaDescriptor,
  MediaType,
  StoredWhatsappMedia,
  WhatsappMediaSocket,
} from '../interfaces/media.interface.ts';
import { MinioStorageService } from './minio-storage.service.ts';
import { EXTENSIONS } from '../constants/media.constant.ts';
import { safeId } from '../../../utils/message.utils.ts';
import { pino } from 'pino';
import { SessionQueue } from '../../connection/session-queue.ts';

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private readonly baileysLogger = pino({ level: 'silent' });
  private readonly saves = new SessionQueue();

  constructor(
    private readonly storageService: MinioStorageService
  ) {}

  hasMedia(message: WAMessage): boolean {
    return this.getMessageMediaDescriptor(message) !== null;
  }

  async save(
    socket: WhatsappMediaSocket,
    message: WAMessage,
  ): Promise<StoredWhatsappMedia | null> {
    const startedAt = Date.now();
    let operation = 'prepare';

    const prepared = this.prepareMedia(message);

    if (!prepared) {
      return null;
    }

    const { objectKey, media, context } = prepared;

    return this.saves.run(
      JSON.stringify([context.chatId, context.messageId]),
      async () => {
        let directory: string | undefined;
        let download: Readable | undefined;
        let upload: ReadStream | undefined;
        try {
          operation = 'prepare-download';
          directory = await mkdtemp(join(tmpdir(), 'whatsapp-media-'));
          const filePath = join(directory, 'attachment');
          operation = 'download';
          download = await this.downloadMedia(socket, message);
          await pipeline(download, createWriteStream(filePath));
          const { size } = await stat(filePath);

          operation = 'check-existing';
          const existing = await this.storageService.exists(
            context.chatId,
            context.messageId,
            size,
          );
          let stored = existing;
          if (!stored) {
            operation = 'upload';
            upload = createReadStream(filePath);
            stored = await this.storageService.uploadStream(
              objectKey,
              upload,
              media.mimeType,
            );
          }

          const result: StoredWhatsappMedia = {
            ...stored,
            chatId: context.chatId,
            messageId: context.messageId,
            senderId: context.senderId,
            type: media.type,
            mimeType: media.mimeType,
            originalFileName: media.originalFileName,
          };

          this.logger.log({
            message: existing ? 'Media already stored' : 'Media saved',
            ...context,
            objectKey: result.objectKey,
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
        } finally {
          download?.destroy();
          upload?.destroy();
          if (directory) {
            try {
              await rm(directory, { recursive: true, force: true });
            } catch {
              this.logger.warn({
                ...context,
                message: 'Temporary media cleanup failed',
              });
            }
          }
        }
      },
    );
  }

  private prepareMedia(message: WAMessage) {
    const media = this.getMessageMediaDescriptor(message);
    if (!media) return null;
    const chatId = message.key.remoteJid!;
    const messageId = message.key.id!;
    const senderId = this.getSenderId(message);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `${timestamp}_${randomUUID()}_${safeId(messageId)}${media.extension}`;
    const objectKey = ['conversations', safeId(chatId), fileName].join('/');

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

  private getMessageMediaDescriptor(
    message: WAMessage,
  ): MediaDescriptor | null {
    if (!message.key.remoteJid || !message.key.id || !message.message)
      return null;
    const content = extractMessageContent(message.message);
    return content ? this.getMediaDescriptor(content) : null;
  }

  private getSenderId(message: WAMessage): string {
    const chatId = message.key.remoteJid!;
    if (chatId.endsWith('@g.us')) {
      return message.key.participant ?? 'unknown';
    }
    return chatId;
  }

  private downloadMedia(socket: WhatsappMediaSocket, message: WAMessage) {
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

    const video = content.videoMessage || content.ptvMessage;
    if (video) {
      return this.createMediaDescriptor('video', video.mimetype || 'video/mp4');
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
  // Normalizes the MIME type and resolves the media file extension.
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
}
