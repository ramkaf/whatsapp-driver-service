import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@libs/common/prisma/index.js';
import type { Prisma } from '@libs/common/prisma/src/index.js';
import { ConnectionMessageSource } from '../../connection/interfaces/message-event-source.ts';
import { MediaService } from './media.service.ts';
import {
  WhatsappMessageInboxStatus,
  WhatsappMessageMediaStatus,
} from '@libs/common/prisma/src/generated/enums.js';
import { deserializeInboxMessage } from '../../inbox/utils/inbox.util.ts';

@Injectable()
export class MediaProcessorService {
  private readonly logger = new Logger(MediaProcessorService.name);

  private readonly batchSize = 10;
  private readonly retryDelayMs = 30_000;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MediaService) private readonly mediaService: MediaService,
    @Inject(ConnectionMessageSource)
    private readonly source: ConnectionMessageSource,
  ) {}

  /** Processes a bounded batch, allowing other records to finish if one fails. */
  async processPending(): Promise<void> {
    const records = await this.prisma.whatsappMessageInbox.findMany({
      where: this.eligibleMedia(),
      select: { id: true },
      orderBy: {
        createdAt: 'asc',
      },
      take: this.batchSize,
    });

    if (!records.length) return;

    const results = await Promise.allSettled(
      records.map((record) => this.processOne(record.id)),
    );

    for (const [index, result] of results.entries()) {
      if (result.status === 'rejected') {
        this.logger.error(
          `Failed to process inbox media: ${records[index].id}`,
          result.reason instanceof Error
            ? result.reason.stack
            : String(result.reason),
        );
      }
    }
  }

  async processOne(id: string): Promise<void> {
    // Only the worker that changes this row may start the download.
    const claimed = await this.prisma.whatsappMessageInbox.updateMany({
      where: {
        id,
        ...this.eligibleMedia(),
      },
      data: {
        mediaStatus: WhatsappMessageMediaStatus.PROCESSING,
      },
    });

    if (claimed.count === 0) return;

    try {
      const record = await this.prisma.whatsappMessageInbox.findUniqueOrThrow({
        where: { id },
      });
      const message = deserializeInboxMessage(record.payload);
      const context = this.source.getMediaDownloadContext(record.sessionId);
      if (!context) {
        throw new Error(
          `Media socket is not available for session: ${record.sessionId}`,
        );
      }

      const media = await this.mediaService.save(context, message);
      if (!media?.objectKey) {
        throw new Error('Media upload did not return an object key');
      }

      const completed = await this.prisma.whatsappMessageInbox.updateMany({
        where: {
          id,
          mediaStatus: WhatsappMessageMediaStatus.PROCESSING,
        },
        data: {
          mediaStatus: WhatsappMessageMediaStatus.UPLOADED,
          mediaObjectKey: media.objectKey,
          mediaMimeType: media.mimeType ?? null,
          mediaUploadedAt: new Date(),
          status: WhatsappMessageInboxStatus.READY,
        },
      });

      if (completed.count > 0) {
        this.logger.log(`Media uploaded successfully: ${id}`);
      }
    } catch (error) {
      await this.handleFailure(id, error);
    }
  }

  private async handleFailure(id: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);

    this.logger.error(
      `Media processing failed: ${id} - ${message}`,
      error instanceof Error ? error.stack : undefined,
    );

    await this.prisma.whatsappMessageInbox.updateMany({
      where: {
        id,
        mediaStatus: WhatsappMessageMediaStatus.PROCESSING,
      },
      data: {
        mediaStatus: WhatsappMessageMediaStatus.FAILED,
      },
    });
  }

  private eligibleMedia(): Prisma.WhatsappMessageInboxWhereInput {
    return {
      haveMedia: true,
      OR: [
        { mediaStatus: WhatsappMessageMediaStatus.PENDING },
        {
          mediaStatus: WhatsappMessageMediaStatus.FAILED,
          updatedAt: { lte: new Date(Date.now() - this.retryDelayMs) },
        },
      ],
    };
  }
}
