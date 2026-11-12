import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { INBOX_REPOSITORY, InboxRepository } from '@libs/prisma';
import type { Prisma, WhatsappMessageInbox } from '@database/client.js';
import {
  WhatsappMessageInboxStatus,
  WhatsappMessageMediaStatus,
} from '@database/enums.js';
import { ConnectionMessageSource } from '../../connection/interfaces/message-event-source.ts';
import { deserializeInboxMessage } from '../../inbox/utils/inbox.util.ts';
import { MediaService } from './media.service.ts';
import type {
  MediaTransferFailure,
  StoredWhatsappMedia,
} from '../interfaces/media.interface.ts';
import {
  createMediaTransferFailure,
  isMediaTransferFailure,
} from '../utils/media-transfer-failure.util.ts';
import {
  MEDIA_MAX_ATTEMPTS,
  MEDIA_LEASE_RENEW_INTERVAL_MS,
  MEDIA_PROCESSING_LEASE_MS,
  MEDIA_RETRY_DELAYS_MS,
} from '../constants/media-retry.constant.ts';

type ProcessingFailure = Omit<MediaTransferFailure, 'stage'> & {
  stage: MediaTransferFailure['stage'] | 'processing';
};

const RETRYABLE_STATUSES = [
  WhatsappMessageMediaStatus.FAILED,
  WhatsappMessageMediaStatus.DOWNLOAD_FAILED,
  WhatsappMessageMediaStatus.UPLOAD_FAILED,
];

@Injectable()
export class MediaProcessorService {
  private readonly logger = new Logger(MediaProcessorService.name);
  private readonly batchSize = 10;

  constructor(
    @Inject(MediaService) private readonly mediaService: MediaService,
    @Inject(ConnectionMessageSource)
    private readonly source: ConnectionMessageSource,
    @Inject(INBOX_REPOSITORY)
    private readonly inboxRepository: InboxRepository,
  ) {}

  /** New media must not wait behind the retry backlog. */
  async processPending(): Promise<void> {
    await this.processBatch({
      ...this.mediaScope(),
      mediaStatus: WhatsappMessageMediaStatus.PENDING,
      mediaAttemptCount: { lt: MEDIA_MAX_ATTEMPTS },
    });
  }

  async processRetries(): Promise<void> {
    await this.recoverExpiredAttempts();
    await this.processBatch(this.dueRetries());
  }

  private async processBatch(
    where: Prisma.WhatsappMessageInboxWhereInput,
  ): Promise<void> {
    const records = await this.inboxRepository.findMany({
      where,
      select: { id: true },
      orderBy: [{ mediaNextAttemptAt: 'asc' }, { createdAt: 'asc' }],
      take: this.batchSize,
    });
    const results = await Promise.allSettled(
      records.map((record) => this.processOne(record.id)),
    );
    for (const [index, result] of results.entries()) {
      if (result.status === 'rejected') {
        const failure = createMediaTransferFailure(
          'upload',
          'inbox_persistence',
          result.reason,
        );
        this.logger.error({
          event: 'media_worker_error',
          message: 'Media worker could not read or update inbox state',
          inboxId: records[index].id,
          service: 'database',
          operation: failure.operation,
          errorCode: failure.errorCode,
          error: failure.error,
        });
      }
    }
  }

  async processOne(id: string): Promise<void> {
    const startedAt = Date.now();
    const token = randomUUID();
    // The claim, attempt counter and lease are persisted atomically.
    const claimed = await this.inboxRepository.updateMany({
      where: {
        id,
        ...this.mediaScope(),
        mediaAttemptCount: { lt: MEDIA_MAX_ATTEMPTS },
        OR: [
          { mediaStatus: WhatsappMessageMediaStatus.PENDING },
          this.dueRetries(),
        ],
      },
      data: {
        mediaStatus: WhatsappMessageMediaStatus.PROCESSING,
        mediaAttemptCount: { increment: 1 },
        mediaNextAttemptAt: null,
        mediaProcessingToken: token,
        mediaLeaseExpiresAt: new Date(startedAt + MEDIA_PROCESSING_LEASE_MS),
      },
    });
    if (claimed.count === 0) return;

    // Persistence errors are handled by the worker, not mislabeled as transfers.
    const record = await this.inboxRepository.findUniqueOrThrow({
      where: { id },
    });
    if (record.mediaProcessingToken !== token) return;

    const stopLeaseRenewal = this.startLeaseRenewal(record, token);
    try {
      this.logger.log({
        event: 'media_attempt_started',
        ...this.logContext(record),
        retry: record.mediaAttemptCount > 1,
      });

      let media: StoredWhatsappMedia | undefined;
      let thumbnail: string | null | undefined;
      let failure: ProcessingFailure | undefined;
      let operation = 'deserialize';
      let stage: ProcessingFailure['stage'] = 'processing';
      try {
        const message = deserializeInboxMessage(record.payload);
        operation = 'socket';
        stage = 'download';
        const context = this.source.getMediaDownloadContext(record.sessionId);
        if (!context) {
          failure = createMediaTransferFailure('download', operation, {
            message: 'WhatsApp media connection is unavailable',
            code: 'WHATSAPP_SOCKET_UNAVAILABLE',
          });
        } else {
          operation = 'save';
          const saved = await this.mediaService.save(context, message);
          if (isMediaTransferFailure(saved)) {
            failure = saved;
          } else if (!saved?.objectKey) {
            failure = {
              ...createMediaTransferFailure('download', 'describe', {
                message: 'Message has no downloadable media',
                code: 'MEDIA_NOT_FOUND',
              }),
              stage: 'processing',
            };
          } else {
            media = saved;
            stage = 'upload';
            operation = 'thumbnail';
            const savedThumbnail =
              await this.mediaService.saveThumbnail(message);
            if (isMediaTransferFailure(savedThumbnail)) {
              failure = savedThumbnail;
            } else {
              thumbnail = savedThumbnail;
            }
          }
        }
      } catch (error) {
        // Also guard unexpected implementation errors and legacy throwing callers.
        failure = {
          ...createMediaTransferFailure(
            stage === 'processing' ? 'download' : stage,
            operation,
            error,
          ),
          stage,
        };
      }

      if (failure) {
        await this.recordFailure(record, token, failure, startedAt);
        return;
      }
      if (!media) return;

      const completed = await this.inboxRepository.updateMany({
        where: this.ownedAttempt(record.id, token),
        data: {
          mediaStatus: WhatsappMessageMediaStatus.UPLOADED,
          media: {
            path: media.objectKey,
            thumbnail: thumbnail ?? null,
            mimeType: media.mimeType,
            size: media.size,
            type: media.type,
          },
          mediaUploadedAt: new Date(),
          status: WhatsappMessageInboxStatus.READY,
          mediaNextAttemptAt: null,
          mediaLastError: null,
          mediaLastErrorCode: null,
          mediaLastErrorStage: null,
          mediaProcessingToken: null,
          mediaLeaseExpiresAt: null,
        },
      });
      if (completed.count > 0) {
        this.logger.log({
          event:
            record.mediaAttemptCount > 1
              ? 'media_retry_succeeded'
              : 'media_uploaded',
          message: 'WhatsApp download and MinIO upload completed',
          ...this.logContext(record),
          durationMs: Date.now() - startedAt,
        });
      }
    } finally {
      stopLeaseRenewal();
    }
  }

  /** Waiting on a shared asset queue is live work, not an abandoned attempt. */
  private startLeaseRenewal(record: WhatsappMessageInbox, token: string) {
    let renewing = false;
    const renew = async () => {
      if (renewing) return;
      renewing = true;
      try {
        const result = await this.inboxRepository.updateMany({
          where: this.ownedAttempt(record.id, token),
          data: {
            mediaLeaseExpiresAt: new Date(
              Date.now() + MEDIA_PROCESSING_LEASE_MS,
            ),
          },
        });
        if (result.count === 0) clearInterval(timer);
      } catch (error) {
        const failure = createMediaTransferFailure(
          'upload',
          'lease_renewal',
          error,
        );
        this.logger.error({
          event: 'media_worker_error',
          message: 'Unable to renew the active media processing lease',
          ...this.logContext(record),
          service: 'database',
          operation: failure.operation,
          error: failure.error,
          errorCode: failure.errorCode,
        });
      } finally {
        renewing = false;
      }
    };
    const timer = setInterval(() => {
      void renew();
    }, MEDIA_LEASE_RENEW_INTERVAL_MS);
    timer.unref();
    return () => clearInterval(timer);
  }

  /** Restart recovery uses the same failure budget, never an unlimited reset. */
  private async recoverExpiredAttempts(): Promise<void> {
    const now = new Date();
    const records = await this.inboxRepository.findMany({
      where: {
        ...this.mediaScope(),
        mediaStatus: WhatsappMessageMediaStatus.PROCESSING,
        mediaLeaseExpiresAt: { lte: now },
      },
      orderBy: { mediaLeaseExpiresAt: 'asc' },
      take: this.batchSize,
    });
    for (const record of records) {
      await this.recordFailure(
        record,
        record.mediaProcessingToken,
        {
          status: 'failed',
          stage: 'processing',
          operation: 'lease_recovery',
          error: 'Media processing lease expired; worker may have stopped',
          errorCode: 'MEDIA_LEASE_EXPIRED',
        },
        now.getTime(),
        // Do not release a claim if it was renewed or replaced after the read.
        { mediaLeaseExpiresAt: { lte: now } },
      );
    }
  }

  private async recordFailure(
    record: WhatsappMessageInbox,
    token: string | null,
    failure: ProcessingFailure,
    startedAt: number,
    guard: Prisma.WhatsappMessageInboxWhereInput = {},
  ): Promise<void> {
    const exhausted = record.mediaAttemptCount >= MEDIA_MAX_ATTEMPTS;
    const delayMs = exhausted
      ? null
      : MEDIA_RETRY_DELAYS_MS[Math.max(0, record.mediaAttemptCount - 1)];
    const nextAttemptAt =
      delayMs === null ? null : new Date(Date.now() + delayMs);
    const failedStatus =
      failure.stage === 'download'
        ? WhatsappMessageMediaStatus.DOWNLOAD_FAILED
        : failure.stage === 'upload'
          ? WhatsappMessageMediaStatus.UPLOAD_FAILED
          : WhatsappMessageMediaStatus.FAILED;
    const updated = await this.inboxRepository.updateMany({
      where: { ...this.ownedAttempt(record.id, token), ...guard },
      data: {
        mediaStatus: exhausted
          ? WhatsappMessageMediaStatus.EXHAUSTED
          : failedStatus,
        mediaNextAttemptAt: nextAttemptAt,
        mediaLastError: failure.error,
        mediaLastErrorCode: failure.errorCode,
        mediaLastErrorStage: failure.stage,
        mediaProcessingToken: null,
        mediaLeaseExpiresAt: null,
        ...(exhausted ? { status: WhatsappMessageInboxStatus.FAILED } : {}),
      },
    });
    if (updated.count === 0) return;

    const entry = {
      event: exhausted ? 'media_retry_exhausted' : 'media_retry_scheduled',
      message: exhausted
        ? 'Media transfer stopped after the final retry'
        : 'Media transfer failed; retry scheduled',
      ...this.logContext(record),
      service:
        failure.stage === 'download'
          ? 'whatsapp'
          : failure.stage === 'upload'
            ? 'minio'
            : 'worker',
      stage: failure.stage,
      operation: failure.operation,
      errorCode: failure.errorCode,
      error: failure.error,
      durationMs: Date.now() - startedAt,
      retryInMs: delayMs,
      nextAttemptAt: nextAttemptAt?.toISOString() ?? null,
    };
    if (exhausted) this.logger.error(entry);
    else this.logger.warn(entry);
  }

  private logContext(record: WhatsappMessageInbox) {
    return {
      inboxId: record.id,
      sessionId: record.sessionId,
      attempt: record.mediaAttemptCount,
      maxAttempts: MEDIA_MAX_ATTEMPTS,
    };
  }

  private ownedAttempt(id: string, token: string | null) {
    return {
      id,
      mediaStatus: WhatsappMessageMediaStatus.PROCESSING,
      mediaProcessingToken: token,
    } satisfies Prisma.WhatsappMessageInboxWhereInput;
  }

  private mediaScope(): Prisma.WhatsappMessageInboxWhereInput {
    return {
      haveMedia: true,
      event: {
        in: ['messages.upsert', 'messaging-history.set', 'legacy.message'],
      },
    };
  }

  private dueRetries(): Prisma.WhatsappMessageInboxWhereInput {
    return {
      ...this.mediaScope(),
      mediaStatus: { in: RETRYABLE_STATUSES },
      mediaAttemptCount: { lt: MEDIA_MAX_ATTEMPTS },
      mediaNextAttemptAt: { lte: new Date() },
    };
  }
}
