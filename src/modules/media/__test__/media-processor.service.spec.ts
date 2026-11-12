import { Logger } from '@nestjs/common';
import type { MockInstance } from 'vitest';
import type { Prisma, WhatsappMessageInbox } from '@database/client.js';
import type { WAMessageContent } from '@whiskeysockets/baileys';
import type { InboxRepository } from '@libs/prisma';
import type { ConnectionMessageSource } from '../../connection/interfaces/message-event-source.ts';
import type { MediaType } from '../interfaces/media.interface.ts';
import type { MediaService } from '../providers/media.service.ts';
import { MediaProcessorService } from '../providers/media-processor.service.ts';
import { MEDIA_PROCESSING_LEASE_MS } from '../constants/media-retry.constant.ts';
import { createMediaTransferFailure } from '../utils/media-transfer-failure.util.ts';

let log: MockInstance;
let warn: MockInstance;
let error: MockInstance;

const initialTime = new Date('2026-11-12T08:00:00.000Z');

function record(
  content: WAMessageContent = { imageMessage: {} },
  overrides: Partial<WhatsappMessageInbox> = {},
): WhatsappMessageInbox {
  return {
    id: 'inbox-one',
    key: 'fingerprint-one',
    event: 'messages.upsert',
    sessionId: 'account-one',
    payload: JSON.parse(
      JSON.stringify({
        key: { id: 'message-one', remoteJid: 'chat@s.whatsapp.net' },
        message: content,
      }),
    ),
    reformPayload: { content: null },
    media: null,
    haveMedia: true,
    mediaStatus: 'PENDING',
    mediaUploadedAt: null,
    mediaAttemptCount: 0,
    mediaNextAttemptAt: null,
    mediaLastError: null,
    mediaLastErrorCode: null,
    mediaLastErrorStage: null,
    mediaProcessingToken: null,
    mediaLeaseExpiresAt: null,
    status: 'RECEIVED',
    createdAt: initialTime,
    updatedAt: initialTime,
    ...overrides,
  };
}

/** Small database double: exercise the query predicates, not only query shapes. */
function matches(row: WhatsappMessageInbox, where: unknown): boolean {
  if (!where || typeof where !== 'object') return true;
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR')
      return (value as unknown[]).some((branch) => matches(row, branch));
    if (key === 'AND')
      return (value as unknown[]).every((branch) => matches(row, branch));
    const current = row[key as keyof WhatsappMessageInbox];
    if (
      value !== null &&
      typeof value === 'object' &&
      !(value instanceof Date)
    ) {
      const filter = value as { in?: unknown[]; lte?: Date; lt?: number };
      if (filter.in) return filter.in.includes(current);
      if (filter.lte)
        return (
          current !== null && current instanceof Date && current <= filter.lte
        );
      if (filter.lt !== undefined)
        return typeof current === 'number' && current < filter.lt;
    }
    return current === value;
  });
}

function fixture(
  content: WAMessageContent = { imageMessage: {} },
  type: MediaType = 'image',
  mimeType = 'image/jpeg',
) {
  const row = record(content);
  const rows = [row];
  const repository = {
    updateMany: vi.fn(
      async (args: Prisma.WhatsappMessageInboxUpdateManyArgs) => {
        let count = 0;
        for (const item of rows.filter((candidate) =>
          matches(candidate, args.where),
        )) {
          const changes = { ...args.data };
          if (typeof changes.mediaAttemptCount === 'object') {
            changes.mediaAttemptCount =
              item.mediaAttemptCount +
              (changes.mediaAttemptCount.increment ?? 0);
          }
          Object.assign(item, changes);
          count++;
        }
        return { count };
      },
    ),
    findUniqueOrThrow: vi.fn(
      async ({ where }: Prisma.WhatsappMessageInboxFindUniqueOrThrowArgs) => {
        const found = rows.find((candidate) => candidate.id === where.id);
        if (!found) throw new Error('inbox record missing');
        return structuredClone(found);
      },
    ),
    findMany: vi.fn(async (args: Prisma.WhatsappMessageInboxFindManyArgs) =>
      rows
        .filter((candidate) => matches(candidate, args.where))
        .slice(0, args.take ?? rows.length)
        .map((item) => structuredClone(item)),
    ),
  };
  const context = { updateMediaMessage: vi.fn() };
  const source = { getMediaDownloadContext: vi.fn().mockReturnValue(context) };
  const saved = {
    objectKey: 'media/sha256/content-hash',
    type,
    mimeType,
    size: 1024,
  };
  const mediaService = {
    saveThumbnail: vi
      .fn<MediaService['saveThumbnail']>()
      .mockResolvedValue(null),
    save: vi
      .fn<MediaService['save']>()
      .mockResolvedValue(saved as Awaited<ReturnType<MediaService['save']>>),
  };
  return {
    record: row,
    rows,
    repository,
    source,
    saved,
    mediaService,
    processor: new MediaProcessorService(
      mediaService as unknown as MediaService,
      source as unknown as ConnectionMessageSource,
      repository as unknown as InboxRepository,
    ),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(initialTime);
  log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('MediaProcessorService', () => {
  it.each([
    [
      { documentMessage: { mimetype: 'application/pdf' } },
      'document',
      'application/pdf',
    ],
    [
      { audioMessage: { ptt: true, mimetype: 'audio/ogg' } },
      'voice',
      'audio/ogg',
    ],
    [{ audioMessage: { mimetype: 'audio/mpeg' } }, 'audio', 'audio/mpeg'],
    [{ videoMessage: { mimetype: 'video/mp4' } }, 'video', 'video/mp4'],
    [{ imageMessage: { mimetype: 'image/jpeg' } }, 'image', 'image/jpeg'],
    [
      { documentMessage: { mimetype: 'application/octet-stream' } },
      'document',
      'application/octet-stream',
    ],
    [{ stickerMessage: { mimetype: 'image/webp' } }, 'sticker', 'image/webp'],
  ] satisfies [WAMessageContent, MediaType, string][])(
    'stores %j as %s with size and MIME type, preserving the reform payload',
    async (content, type, mimeType) => {
      const f = fixture(content, type, mimeType);
      const reformPayload = structuredClone(f.record.reformPayload);
      await f.processor.processOne(f.record.id);
      expect(f.record).toMatchObject({
        mediaStatus: 'UPLOADED',
        status: 'READY',
        mediaAttemptCount: 1,
        media: {
          path: f.saved.objectKey,
          thumbnail: null,
          mimeType,
          type,
          size: 1024,
        },
        mediaUploadedAt: initialTime,
        mediaProcessingToken: null,
        mediaLeaseExpiresAt: null,
      });
      expect(f.record.reformPayload).toEqual(reformPayload);
      expect(f.record).not.toHaveProperty('mediaMimeType');
    },
  );

  it.each([
    'imageMessage',
    'videoMessage',
    'ptvMessage',
    'documentMessage',
  ] as const)('stores the durable thumbnail key from %s', async (field) => {
    const jpegThumbnail = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const f = fixture({ [field]: { jpegThumbnail } });
    f.mediaService.saveThumbnail.mockResolvedValueOnce(
      'media/sha256/thumbnail',
    );
    await f.processor.processOne(f.record.id);
    expect(f.record.media).toMatchObject({
      thumbnail: 'media/sha256/thumbnail',
    });
    expect(
      Buffer.from(
        f.mediaService.saveThumbnail.mock.calls[0][0].message![field]!
          .jpegThumbnail!,
      ),
    ).toEqual(jpegThumbnail);
  });

  it.each([
    ['download', 'download', 'DOWNLOAD_FAILED', 'whatsapp'],
    ['upload', 'lookup', 'UPLOAD_FAILED', 'minio'],
    ['upload', 'upload', 'UPLOAD_FAILED', 'minio'],
  ] as const)(
    'persists a %s/%s failure and schedules its retry',
    async (stage, operation, status, service) => {
      const f = fixture();
      f.mediaService.save.mockResolvedValueOnce(
        createMediaTransferFailure(stage, operation, {
          message: 'connection unavailable',
          code: 'ECONNREFUSED',
        }),
      );
      await expect(
        f.processor.processOne(f.record.id),
      ).resolves.toBeUndefined();
      expect(f.record).toMatchObject({
        mediaStatus: status,
        status: 'RECEIVED',
        media: null,
        mediaAttemptCount: 1,
        mediaNextAttemptAt: new Date(initialTime.getTime() + 5000),
        mediaLastError: 'connection unavailable',
        mediaLastErrorCode: 'ECONNREFUSED',
        mediaLastErrorStage: stage,
        mediaProcessingToken: null,
        mediaLeaseExpiresAt: null,
      });
      expect(f.mediaService.saveThumbnail).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'media_retry_scheduled',
          inboxId: f.record.id,
          sessionId: f.record.sessionId,
          service,
          stage,
          operation,
          errorCode: 'ECONNREFUSED',
          attempt: 1,
          maxAttempts: 7,
          retryInMs: 5000,
          nextAttemptAt: new Date(initialTime.getTime() + 5000).toISOString(),
        }),
      );
    },
  );

  it('retries thumbnail upload failures without publishing a partial media result', async () => {
    const f = fixture();
    f.mediaService.saveThumbnail.mockResolvedValueOnce(
      createMediaTransferFailure(
        'upload',
        'thumbnail_upload',
        new Error('thumbnail unavailable'),
      ),
    );
    await f.processor.processOne(f.record.id);
    expect(f.record).toMatchObject({
      mediaStatus: 'UPLOAD_FAILED',
      media: null,
      status: 'RECEIVED',
    });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'minio',
        operation: 'thumbnail_upload',
      }),
    );
  });

  it('classifies an unavailable socket as a WhatsApp download failure', async () => {
    const f = fixture();
    f.source.getMediaDownloadContext.mockReturnValueOnce(undefined);
    await f.processor.processOne(f.record.id);
    expect(f.record).toMatchObject({
      mediaStatus: 'DOWNLOAD_FAILED',
      mediaLastErrorCode: 'WHATSAPP_SOCKET_UNAVAILABLE',
    });
    expect(f.mediaService.save).not.toHaveBeenCalled();
  });

  it('uses all six requested delays and never attempts an exhausted record again', async () => {
    const f = fixture();
    f.mediaService.save.mockResolvedValue(
      createMediaTransferFailure(
        'upload',
        'upload',
        new Error('MinIO offline'),
      ),
    );
    const delays = [5000, 15000, 120000, 1800000, 10800000, 86400000];
    await f.processor.processOne(f.record.id);
    for (const [index, delay] of delays.entries()) {
      const failureTime = Date.now();
      expect(f.record.mediaAttemptCount).toBe(index + 1);
      expect(f.record.mediaNextAttemptAt).toEqual(
        new Date(failureTime + delay),
      );
      vi.setSystemTime(failureTime + delay - 1);
      await f.processor.processRetries();
      expect(f.mediaService.save).toHaveBeenCalledTimes(index + 1);
      vi.setSystemTime(failureTime + delay);
      await f.processor.processRetries();
      expect(f.mediaService.save).toHaveBeenCalledTimes(index + 2);
    }
    expect(f.record).toMatchObject({
      mediaStatus: 'EXHAUSTED',
      status: 'FAILED',
      mediaAttemptCount: 7,
      mediaNextAttemptAt: null,
    });
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'media_retry_exhausted',
        service: 'minio',
        attempt: 7,
        maxAttempts: 7,
        nextAttemptAt: null,
        retryInMs: null,
      }),
    );
    vi.setSystemTime(Date.now() + 7 * 86400000);
    await f.processor.processPending();
    await f.processor.processRetries();
    await f.processor.processOne(f.record.id);
    expect(f.mediaService.save).toHaveBeenCalledTimes(7);
  });

  it('measures each delay from the latest failure, including transfer duration', async () => {
    const f = fixture();
    f.mediaService.save.mockImplementationOnce(async () => {
      vi.setSystemTime(initialTime.getTime() + 3000);
      return createMediaTransferFailure(
        'download',
        'download',
        new Error('timeout'),
      );
    });
    await f.processor.processOne(f.record.id);
    expect(f.record.mediaNextAttemptAt).toEqual(
      new Date(initialTime.getTime() + 8000),
    );
  });

  it('clears errors on retry success and logs the recovered connection', async () => {
    const f = fixture();
    f.mediaService.save.mockResolvedValueOnce(
      createMediaTransferFailure('upload', 'upload', new Error('offline')),
    );
    await f.processor.processOne(f.record.id);
    vi.setSystemTime(initialTime.getTime() + 5000);
    await f.processor.processRetries();
    expect(f.record).toMatchObject({
      mediaStatus: 'UPLOADED',
      status: 'READY',
      mediaAttemptCount: 2,
      mediaLastError: null,
      mediaLastErrorCode: null,
      mediaLastErrorStage: null,
      mediaNextAttemptAt: null,
      mediaProcessingToken: null,
      mediaLeaseExpiresAt: null,
    });
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'media_retry_succeeded',
        attempt: 2,
        sessionId: 'account-one',
      }),
    );
  });

  it('does not retry future, successful, exhausted or unrelated notification records', async () => {
    const f = fixture();
    f.record.mediaStatus = 'UPLOAD_FAILED';
    f.record.mediaNextAttemptAt = new Date(Date.now() + 1);
    f.rows.push(
      record(
        {},
        {
          id: 'done',
          mediaStatus: 'UPLOADED',
          mediaNextAttemptAt: initialTime,
        },
      ),
      record(
        {},
        {
          id: 'terminal',
          mediaStatus: 'EXHAUSTED',
          mediaAttemptCount: 7,
          mediaNextAttemptAt: initialTime,
        },
      ),
      record(
        {},
        {
          id: 'notification',
          event: 'contacts.upsert',
          mediaStatus: 'UPLOAD_FAILED',
          mediaNextAttemptAt: initialTime,
        },
      ),
      record(
        {},
        {
          id: 'no-media',
          haveMedia: false,
          mediaStatus: 'UPLOAD_FAILED',
          mediaNextAttemptAt: initialTime,
        },
      ),
    );
    await f.processor.processRetries();
    expect(f.mediaService.save).not.toHaveBeenCalled();
    expect(f.repository.updateMany).not.toHaveBeenCalled();
  });

  it('keeps initial processing separate from retry processing', async () => {
    const f = fixture();
    f.rows.push(
      record(
        {},
        {
          id: 'retry',
          mediaStatus: 'DOWNLOAD_FAILED',
          mediaAttemptCount: 1,
          mediaNextAttemptAt: initialTime,
        },
      ),
    );
    await f.processor.processPending();
    expect(f.mediaService.save).toHaveBeenCalledOnce();
    expect(f.rows[1].mediaStatus).toBe('DOWNLOAD_FAILED');
    await f.processor.processRetries();
    expect(f.mediaService.save).toHaveBeenCalledTimes(2);
    expect(f.rows[1].mediaStatus).toBe('UPLOADED');
  });

  it('atomically claims and increments only once under concurrent worker delivery', async () => {
    const f = fixture();
    await Promise.all([
      f.processor.processOne(f.record.id),
      f.processor.processOne(f.record.id),
    ]);
    expect(f.mediaService.save).toHaveBeenCalledOnce();
    expect(f.record.mediaAttemptCount).toBe(1);
    expect(f.repository.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          mediaAttemptCount: { increment: 1 },
          mediaProcessingToken: expect.any(String),
          mediaLeaseExpiresAt: new Date(
            initialTime.getTime() + MEDIA_PROCESSING_LEASE_MS,
          ),
        }),
      }),
    );
  });

  it('does not download when another worker already owns the record', async () => {
    const f = fixture();
    f.record.mediaStatus = 'PROCESSING';
    f.record.mediaProcessingToken = 'another-worker';
    await f.processor.processOne(f.record.id);
    expect(f.mediaService.save).not.toHaveBeenCalled();
    expect(f.repository.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it.each(['success', 'failure'] as const)(
    'does not overwrite a replaced claim on late %s',
    async (outcome) => {
      const f = fixture();
      f.mediaService.save.mockImplementationOnce(async () => {
        f.record.mediaProcessingToken = 'replacement-worker';
        return outcome === 'success'
          ? (f.saved as Awaited<ReturnType<MediaService['save']>>)
          : createMediaTransferFailure(
              'download',
              'download',
              new Error('late failure'),
            );
      });
      await f.processor.processOne(f.record.id);
      expect(f.record).toMatchObject({
        mediaStatus: 'PROCESSING',
        mediaProcessingToken: 'replacement-worker',
        media: null,
        mediaNextAttemptAt: null,
      });
      expect(warn).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalledWith(
        expect.objectContaining({ event: 'media_uploaded' }),
      );
    },
  );

  it('recovers an expired lease using its existing budget and the exact claim token', async () => {
    const f = fixture();
    Object.assign(f.record, {
      mediaStatus: 'PROCESSING',
      mediaAttemptCount: 2,
      mediaProcessingToken: 'dead-worker',
      mediaLeaseExpiresAt: initialTime,
    });
    await f.processor.processRetries();
    expect(f.record).toMatchObject({
      mediaStatus: 'FAILED',
      mediaAttemptCount: 2,
      mediaNextAttemptAt: new Date(initialTime.getTime() + 15000),
      mediaLastErrorCode: 'MEDIA_LEASE_EXPIRED',
    });
    expect(f.repository.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          mediaProcessingToken: 'dead-worker',
          mediaLeaseExpiresAt: { lte: initialTime },
        }),
      }),
    );
    expect(f.mediaService.save).not.toHaveBeenCalled();
  });

  it('exhausts an interrupted final attempt instead of resetting the retry budget', async () => {
    const f = fixture();
    Object.assign(f.record, {
      mediaStatus: 'PROCESSING',
      mediaAttemptCount: 7,
      mediaProcessingToken: 'dead-worker',
      mediaLeaseExpiresAt: initialTime,
    });
    await f.processor.processRetries();
    expect(f.record).toMatchObject({
      mediaStatus: 'EXHAUSTED',
      mediaAttemptCount: 7,
      mediaNextAttemptAt: null,
      status: 'FAILED',
    });
    expect(f.mediaService.save).not.toHaveBeenCalled();
  });

  it('does not recover a processing row with a live lease', async () => {
    const f = fixture();
    Object.assign(f.record, {
      mediaStatus: 'PROCESSING',
      mediaAttemptCount: 1,
      mediaProcessingToken: 'live-worker',
      mediaLeaseExpiresAt: new Date(Date.now() + 1),
    });
    await f.processor.processRetries();
    expect(f.repository.updateMany).not.toHaveBeenCalled();
  });

  it('continues the batch after an individual persistence error and logs the database cause', async () => {
    const f = fixture();
    f.rows.push(record({}, { id: 'inbox-two' }));
    f.repository.updateMany.mockRejectedValueOnce(
      Object.assign(new Error('database offline'), { code: 'ECONNREFUSED' }),
    );
    await expect(f.processor.processPending()).resolves.toBeUndefined();
    expect(f.rows[1].mediaStatus).toBe('UPLOADED');
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'media_worker_error',
        inboxId: 'inbox-one',
        service: 'database',
        errorCode: 'ECONNREFUSED',
        error: 'database offline',
      }),
    );
  });

  it('does not label a final persistence error as an upload failure or release its claim', async () => {
    const f = fixture();
    const originalUpdate = f.repository.updateMany.getMockImplementation()!;
    f.repository.updateMany.mockImplementation(async (args) => {
      if (args.data.mediaStatus === 'UPLOADED')
        throw new Error('database commit unavailable');
      return originalUpdate(args);
    });
    await f.processor.processPending();
    expect(f.record.mediaStatus).toBe('PROCESSING');
    expect(f.record.mediaLastError).toBeNull();
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'media_worker_error',
        service: 'database',
      }),
    );
    expect(warn).not.toHaveBeenCalled();
  });
});
