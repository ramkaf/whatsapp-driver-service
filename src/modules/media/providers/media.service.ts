import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import type { WAMessage } from '@whiskeysockets/baileys';
import { pino } from 'pino';
import type {
  PreparedMedia,
  StoredWhatsappMedia,
  TemporaryMediaFile,
  WhatsappMediaSocket,
} from '../interfaces/media.interface.ts';

import { MinioStorageService } from './minio-storage.service.ts';
import { getMessageMediaDescriptor } from '../utils/media-descriptor.util.ts';
import { buildMediaObjectKey } from '../utils/media-object-key.util.ts';
import { SessionQueue } from '../../connection/session-queue.ts';

const MAX_MEDIA_SIZE = 25 * 1024 * 1024;

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private readonly baileysLogger = pino({
    level: 'silent',
  });
  private readonly messageSaves = new SessionQueue();
  private readonly assetSaves = new SessionQueue();

  constructor(private readonly storageService: MinioStorageService) {}

  hasMedia(message: WAMessage): boolean {
    return getMessageMediaDescriptor(message) !== null;
  }

  async save(
    socket: WhatsappMediaSocket,
    message: WAMessage,
  ): Promise<StoredWhatsappMedia | null> {
    const prepared = this.prepareMedia(message);

    if (!prepared) {
      return null;
    }

    const startedAt = Date.now();

    return this.messageSaves.run(
      JSON.stringify([prepared.chatId, prepared.messageId]),
      () => this.processMedia(socket, message, prepared, startedAt),
    );
  }
  /**
   * Main media processing flow.
   */
  private async processMedia(
    socket: WhatsappMediaSocket,
    message: WAMessage,
    prepared: PreparedMedia,
    startedAt: number,
  ): Promise<StoredWhatsappMedia> {
    const { media, chatId, messageId } = prepared;
    let temporary: TemporaryMediaFile | undefined;
    let operation = 'download';

    try {
      temporary = await this.downloadToTemporaryFile(socket, message);

      this.validateMediaSize(temporary.size);

      const objectKey = buildMediaObjectKey(temporary.sha256);

      const asset = await this.assetSaves.run(temporary.sha256, async () => {
        operation = 'lookup';
        const existing = await this.storageService.getExistingObject(
          objectKey,
          temporary!.size,
          temporary!.sha256,
        );
        if (existing) return { stored: existing };

        operation = 'upload';
        const stored = await this.uploadTemporaryFile(
          temporary!.filePath,
          objectKey,
          temporary!.size,
          media.mimeType,
          temporary!.sha256,
        );

        return { stored };
      });

      const result: StoredWhatsappMedia = {
        ...asset.stored,
        chatId,
        messageId,
        type: media.type,
        mimeType: media.mimeType,
        originalFileName: media.originalFileName,
        sha256: temporary.sha256,
      };

      return result;
    } catch (error) {
      this.logger.error({
        message: 'Media processing failed',
        chatId,
        messageId,
        operation,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      });
      throw error;
    } finally {
      if (temporary) {
        await this.cleanupTemporaryDirectory(
          temporary.directory,
          chatId,
          messageId,
        );
      }
    }
  }
  /**
   * Downloads media and calculates SHA-256 simultaneously.
   */
  private async downloadToTemporaryFile(
    socket: WhatsappMediaSocket,
    message: WAMessage,
  ): Promise<TemporaryMediaFile> {
    const directory = await mkdtemp(join(tmpdir(), 'whatsapp-media-'));
    const filePath = join(directory, 'attachment');

    try {
      const hash = createHash('sha256');

      let size = 0;

      const hashTransform = new Transform({
        transform(chunk, _encoding, callback) {
          size += chunk.length;

          if (size > MAX_MEDIA_SIZE) {
            callback(new Error('Media exceeds maximum allowed size'));
            return;
          }

          hash.update(chunk);
          callback(null, chunk);
        },
      });

      const download = await this.downloadMedia(socket, message);

      await pipeline(
        download,
        hashTransform,
        createWriteStream(filePath, {
          flags: 'wx',
        }),
      );

      return {
        directory,
        filePath,
        size,
        sha256: hash.digest('hex'),
      };
    } catch (error) {
      await rm(directory, {
        recursive: true,
        force: true,
      });

      throw error;
    }
  }
  /**
   * Uploads the temporary file to MinIO.
   */
  private async uploadTemporaryFile(
    filePath: string,
    objectKey: string,
    size: number,
    mimeType: string,
    sha256: string,
  ) {
    const stream = createReadStream(filePath);

    try {
      return await this.storageService.uploadStream(
        objectKey,
        stream,
        size,
        mimeType,
        sha256,
      );
    } finally {
      stream.destroy();
    }
  }
  /**
   * Validates downloaded media size.
   */
  private validateMediaSize(size: number): void {
    if (size <= 0) {
      throw new Error('Downloaded media is empty');
    }

    if (size > MAX_MEDIA_SIZE) {
      throw new Error(`Media exceeds maximum size of ${MAX_MEDIA_SIZE} bytes`);
    }
  }
  /**
   * Removes temporary files.
   */
  private async cleanupTemporaryDirectory(
    directory: string,
    chatId: string,
    messageId: string,
  ): Promise<void> {
    try {
      await rm(directory, {
        recursive: true,
        force: true,
      });
    } catch (error) {
      this.logger.warn({
        chatId,
        messageId,
        message: 'Temporary media cleanup failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  /**
   * Prepares media metadata and message context.
   */
  private prepareMedia(message: WAMessage): PreparedMedia | null {
    const media = getMessageMediaDescriptor(message);
    const chatId = message.key.remoteJid;
    const messageId = message.key.id;

    if (!media || !chatId || !messageId) {
      return null;
    }

    return {
      media,
      chatId,
      messageId,
    };
  }

  private downloadMedia(
    socket: WhatsappMediaSocket,
    message: WAMessage,
  ): Promise<Readable> {
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
}
