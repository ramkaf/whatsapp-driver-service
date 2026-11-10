import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { Logger } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import type { PrismaService } from '@libs/common/prisma/index.js';
import type { Prisma } from '@libs/common/prisma/src/index.js';
import type { WhatsappMessageInbox } from '@libs/common/prisma/src/generated/client.js';
import { proto } from '@whiskeysockets/baileys';
import type { WAMessage } from '@whiskeysockets/baileys';
import type { ConnectionMessageSource } from '../../connection/interfaces/message-event-source.ts';
import { MediaProcessorService } from '../../media/providers/media-processor.service.ts';
import { MediaService } from '../../media/providers/media.service.ts';
import type { MinioStorageService } from '../../media/providers/minio-storage.service.ts';
import { MessagesUpsertEventHandler } from '../../messages/receive/events/messages-upsert.event.ts';
import { MessagingHistorySetEventHandler } from '../../messages/receive/events/messaging-history-set.event.ts';
import { JsonlUtil } from '../../../utils/jsonl.util.ts';
import { InboxMediaWorker } from '../providers/inbox-media.worker.ts';
import { InboxService } from '../providers/inbox.service.ts';

const { downloadMediaMessage } = vi.hoisted(() => ({
  downloadMediaMessage: vi.fn(),
}));

vi.mock('@whiskeysockets/baileys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@whiskeysockets/baileys')>()),
  downloadMediaMessage,
}));

const bytes = Buffer.from('downloaded attachment');
const mediaKey = Buffer.alloc(32, 7);

function attachment(id = 'message-one'): WAMessage {
  return {
    key: { remoteJid: 'chat@s.whatsapp.net', id, fromMe: false },
    message: {
      ephemeralMessage: {
        message: {
          documentMessage: {
            url: 'https://media.invalid/document',
            mimetype: 'application/pdf',
            fileName: 'report.pdf',
            mediaKey,
          },
        },
      },
    },
  };
}

// The fake database applies predicates before mutations, including competing claims.
function matches(
  row: WhatsappMessageInbox,
  where: Prisma.WhatsappMessageInboxWhereInput = {},
): boolean {
  if (typeof where.id === 'string' && row.id !== where.id) return false;
  if (typeof where.haveMedia === 'boolean' && row.haveMedia !== where.haveMedia)
    return false;
  if (
    typeof where.mediaStatus === 'string' &&
    row.mediaStatus !== where.mediaStatus
  )
    return false;
  if (where.OR && !where.OR.some((condition) => matches(row, condition)))
    return false;
  if (
    where.updatedAt &&
    typeof where.updatedAt === 'object' &&
    'lte' in where.updatedAt &&
    (typeof where.updatedAt.lte === 'string' ||
      where.updatedAt.lte instanceof Date) &&
    row.updatedAt > new Date(where.updatedAt.lte)
  )
    return false;
  return true;
}

function fixture() {
  const rows = new Map<string, WhatsappMessageInbox>();
  const table = {
    upsert: vi.fn(async ({ create }: Prisma.WhatsappMessageInboxUpsertArgs) => {
      const key = create.key;
      if (rows.has(key)) return rows.get(key)!;
      const row: WhatsappMessageInbox = {
        id: key,
        key,
        payload: create.payload as Prisma.JsonValue,
        haveMedia: Boolean(create.haveMedia),
        mediaStatus: create.mediaStatus ?? 'NOT_REQUIRED',
        mediaObjectKey: null,
        mediaMimeType: null,
        mediaUploadedAt: null,
        status: create.status ?? 'RECEIVED',
        sessionId: create.sessionId!,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      rows.set(row.id, row);
      return row;
    }),
    findMany: vi.fn(async (query: Prisma.WhatsappMessageInboxFindManyArgs) =>
      [...rows.values()]
        .filter((row) => matches(row, query.where))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .slice(0, query.take ?? rows.size)
        .map(({ id }) => ({ id })),
    ),
    findUniqueOrThrow: vi.fn(
      async ({ where }: Prisma.WhatsappMessageInboxFindUniqueOrThrowArgs) => {
        const row = rows.get(where.id!);
        if (!row) throw new Error('Inbox record not found');
        return structuredClone(row);
      },
    ),
    updateMany: vi.fn(
      async ({ where, data }: Prisma.WhatsappMessageInboxUpdateManyArgs) => {
        const selected = [...rows.values()].filter((row) =>
          matches(row, where),
        );
        for (const row of selected) {
          Object.assign(row, data, { updatedAt: new Date() });
        }
        return { count: selected.length };
      },
    ),
  };
  const prisma = { whatsappMessageInbox: table } as unknown as PrismaService;
  const stored = (objectKey: string) => ({
    bucket: 'test-media',
    objectKey,
    etag: 'etag',
    url: 'https://storage.test/media',
    urlExpiresAt: '2026-11-17T00:00:00.000Z',
  });
  const uploads: Buffer[] = [];
  const storage = {
    getExistingObject: vi
      .fn<MinioStorageService['getExistingObject']>()
      .mockResolvedValue(null),
    uploadStream: vi.fn<MinioStorageService['uploadStream']>(
      async (objectKey, stream) => {
        for await (const chunk of stream) uploads.push(Buffer.from(chunk));
        return stored(objectKey);
      },
    ),
  };
  const media = new MediaService(storage as unknown as MinioStorageService);
  const context = { updateMediaMessage: vi.fn() };
  const source = {
    getMediaDownloadContext: vi
      .fn<ConnectionMessageSource['getMediaDownloadContext']>()
      .mockReturnValue(context),
  };
  const processor = new MediaProcessorService(
    prisma,
    media,
    source as unknown as ConnectionMessageSource,
  );
  const inbox = new InboxService(prisma);
  const worker = new InboxMediaWorker(processor);
  return {
    rows,
    table,
    prisma,
    storage,
    stored,
    uploads,
    media,
    context,
    source,
    processor,
    inbox,
    worker,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-10T12:00:00.000Z'));
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  vi.spyOn(JsonlUtil, 'append').mockResolvedValue(undefined);
  downloadMediaMessage
    .mockReset()
    .mockImplementation(async () => Readable.from([bytes]));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Inbox media pipeline', () => {
  it.each(['upsert', 'history'] as const)(
    'queues %s attachments without downloading in the event handler',
    async (event) => {
      const f = fixture();
      const common = { sessionId: 'account-one', at: new Date().toISOString() };
      if (event === 'upsert') {
        await new MessagesUpsertEventHandler(f.inbox).handle({
          ...common,
          event: 'messages.upsert',
          data: { type: 'notify', messages: [attachment()] },
        });
      } else {
        await new MessagingHistorySetEventHandler(f.inbox).handle({
          ...common,
          event: 'messaging-history.set',
          data: {
            messages: [attachment()],
            contacts: [],
            chats: [],
            syncType: 0,
          },
        });
      }
      expect(downloadMediaMessage).not.toHaveBeenCalled();
      expect([...f.rows.values()]).toEqual([
        expect.objectContaining({
          haveMedia: true,
          mediaStatus: 'PENDING',
          sessionId: 'account-one',
        }),
      ]);

      await f.worker.poll();
      const row = [...f.rows.values()][0];
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      expect(row).toMatchObject({
        mediaStatus: 'UPLOADED',
        mediaObjectKey: `media/sha256/${sha256.slice(0, 2)}/${sha256}`,
        mediaMimeType: 'application/pdf',
        mediaUploadedAt: new Date(),
        status: 'READY',
      });
      expect(Buffer.concat(f.uploads)).toEqual(bytes);
      expect(f.source.getMediaDownloadContext).toHaveBeenCalledWith(
        'account-one',
      );
      const input = downloadMediaMessage.mock.calls[0][0] as WAMessage;
      expect(
        Buffer.from(
          input.message!.ephemeralMessage!.message!.documentMessage!.mediaKey!,
        ),
      ).toEqual(mediaKey);
      await f.worker.poll();
      expect(downloadMediaMessage).toHaveBeenCalledOnce();
    },
  );

  it.each(['base64', 'typed-array', 'buffer-json'] as const)(
    'restores %s media keys before downloading',
    async (format) => {
      const f = fixture();
      const input = attachment();
      if (format === 'typed-array') {
        input.message!.ephemeralMessage!.message!.documentMessage!.mediaKey =
          new Uint8Array(mediaKey);
      }
      const message =
        format === 'base64'
          ? (proto.WebMessageInfo.fromObject(input) as WAMessage)
          : input;
      await f.inbox.handle(message, 'account-one');
      await f.worker.poll();
      const restored = downloadMediaMessage.mock.calls[0][0] as WAMessage;
      expect(
        Buffer.from(
          restored.message!.ephemeralMessage!.message!.documentMessage!
            .mediaKey!,
        ),
      ).toEqual(mediaKey);
      expect([...f.rows.values()][0].mediaStatus).toBe('UPLOADED');
    },
  );

  it('allows only one processor to claim a message while a download is still running', async () => {
    const f = fixture();
    await f.inbox.handle(attachment(), 'account-one');
    const row = [...f.rows.values()][0];
    let release!: (stream: Readable) => void;
    downloadMediaMessage.mockImplementationOnce(
      () =>
        new Promise<Readable>((resolve) => {
          release = resolve;
        }),
    );
    const running = f.processor.processOne(row.id);
    try {
      await vi.waitFor(() =>
        expect(downloadMediaMessage).toHaveBeenCalledOnce(),
      );
      vi.setSystemTime(new Date(Date.now() + 10_000));
      const competitor = new MediaProcessorService(
        f.prisma,
        f.media,
        f.source as unknown as ConnectionMessageSource,
      );
      await competitor.processOne(row.id);
      await f.worker.poll();
      expect(downloadMediaMessage).toHaveBeenCalledOnce();
      expect(row.mediaStatus).toBe('PROCESSING');
      expect(row.mediaUploadedAt).toBeNull();
    } finally {
      release(Readable.from([bytes]));
      await running;
    }
    expect(row.mediaStatus).toBe('UPLOADED');
  });

  it('isolates download failures and retries after the cooldown', async () => {
    const f = fixture();
    await f.inbox.handle(attachment('first'), 'account-one');
    await f.inbox.handle(attachment('second'), 'account-two');
    downloadMediaMessage.mockRejectedValueOnce(
      new Error('download unavailable'),
    );
    await f.worker.poll();
    const [failed, successful] = [...f.rows.values()];
    expect(successful.mediaStatus).toBe('UPLOADED');
    await f.worker.poll();
    expect(downloadMediaMessage).toHaveBeenCalledTimes(2);
    vi.setSystemTime(new Date(Date.now() + 30_000));
    await f.worker.poll();
    expect(failed.mediaStatus).toBe('UPLOADED');
    expect(downloadMediaMessage).toHaveBeenCalledTimes(3);
  });

  it('does not mark an attachment uploaded when MinIO rejects the upload', async () => {
    const f = fixture();
    await f.inbox.handle(attachment(), 'account-one');
    f.storage.uploadStream.mockRejectedValueOnce(
      new Error('MinIO unavailable'),
    );
    await f.worker.poll();
    expect([...f.rows.values()][0]).toMatchObject({
      mediaStatus: 'FAILED',
      mediaObjectKey: null,
      mediaMimeType: null,
      mediaUploadedAt: null,
    });
  });

  it('retries with the original session after its connection becomes available', async () => {
    const f = fixture();
    await f.inbox.handle(attachment(), 'account-one');
    f.source.getMediaDownloadContext.mockReturnValueOnce(undefined);
    await f.worker.poll();
    expect(downloadMediaMessage).not.toHaveBeenCalled();
    expect([...f.rows.values()][0].mediaStatus).toBe('FAILED');
    vi.setSystemTime(new Date(Date.now() + 30_000));
    await f.worker.poll();
    expect([...f.rows.values()][0].mediaStatus).toBe('UPLOADED');
  });

  it('continues polling after the inbox query fails', async () => {
    const f = fixture();
    await f.inbox.handle(attachment(), 'account-one');
    f.table.findMany.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(f.worker.poll()).resolves.toBeUndefined();
    expect(downloadMediaMessage).not.toHaveBeenCalled();
    await f.worker.poll();
    expect([...f.rows.values()][0].mediaStatus).toBe('UPLOADED');
  });

  it('continues the batch when claiming one message fails in the database', async () => {
    const f = fixture();
    await f.inbox.handle(attachment('first'), 'account-one');
    await f.inbox.handle(attachment('second'), 'account-two');
    f.table.updateMany.mockRejectedValueOnce(new Error('claim failed'));
    await f.worker.poll();
    const [first, second] = [...f.rows.values()];
    expect(first.mediaStatus).toBe('PENDING');
    expect(second.mediaStatus).toBe('UPLOADED');
    await f.worker.poll();
    expect(first.mediaStatus).toBe('UPLOADED');
  });

  it('reuses uploaded content on retry if saving its inbox metadata fails', async () => {
    const f = fixture();
    await f.inbox.handle(attachment(), 'account-one');
    const update = f.table.updateMany.getMockImplementation()!;
    f.table.updateMany
      .mockImplementationOnce(update)
      .mockRejectedValueOnce(new Error('completion failed'));
    const hash = createHash('sha256').update(bytes).digest('hex');
    const key = 'media/sha256/' + hash.slice(0, 2) + '/' + hash;
    f.storage.getExistingObject
      .mockResolvedValueOnce(null)
      .mockResolvedValue(f.stored(key));
    await f.worker.poll();
    const row = [...f.rows.values()][0];
    expect(row).toMatchObject({
      mediaStatus: 'FAILED',
      mediaObjectKey: null,
      mediaUploadedAt: null,
    });
    vi.setSystemTime(new Date(Date.now() + 30_000));
    await f.worker.poll();
    expect(row).toMatchObject({
      mediaStatus: 'UPLOADED',
      mediaObjectKey: key,
      status: 'READY',
    });
    expect(f.storage.uploadStream).toHaveBeenCalledOnce();
  });

  it.each([
    {},
    {
      key: { remoteJid: 'chat@s.whatsapp.net', id: 'plain' },
      message: { conversation: 'no attachment' },
    },
  ])(
    'does not mark invalid or non-media payloads as uploaded: %j',
    async (payload) => {
      const f = fixture();
      await f.inbox.handle(attachment(), 'account-one');
      const row = [...f.rows.values()][0];
      row.payload = payload;
      await f.worker.poll();
      expect(row).toMatchObject({
        mediaStatus: 'FAILED',
        mediaObjectKey: null,
        mediaUploadedAt: null,
      });
      expect(downloadMediaMessage).not.toHaveBeenCalled();
      expect(f.storage.uploadStream).not.toHaveBeenCalled();
    },
  );

  it('ignores plain text and own messages and bounds work to ten records per poll', async () => {
    const f = fixture();
    await f.inbox.handle(
      {
        key: { remoteJid: 'chat@s.whatsapp.net', id: 'plain' },
        message: { conversation: 'hello' },
      },
      'account-one',
    );
    const own = attachment('own');
    own.key.fromMe = true;
    await f.inbox.handle(own, 'account-one');
    for (let i = 0; i < 11; i++)
      await f.inbox.handle(attachment(`media-${i}`), 'account-one');
    await f.worker.poll();
    expect(downloadMediaMessage).toHaveBeenCalledTimes(10);
    await f.worker.poll();
    expect(downloadMediaMessage).toHaveBeenCalledTimes(11);
    expect(
      [...f.rows.values()].filter((row) => row.mediaStatus === 'NOT_REQUIRED'),
    ).toHaveLength(1);
  });
});

it('runs every five seconds without overlapping and stops scheduling on shutdown', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-10T12:00:00.000Z'));
  let release!: () => void;
  const processPending = vi.fn().mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const module = await Test.createTestingModule({
    imports: [ScheduleModule.forRoot()],
    providers: [
      InboxMediaWorker,
      { provide: MediaProcessorService, useValue: { processPending } },
    ],
  }).compile();
  await module.init();
  try {
    await vi.advanceTimersByTimeAsync(5_000);
    expect(processPending).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(processPending).toHaveBeenCalledOnce();
    release();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(processPending).toHaveBeenCalledTimes(2);
  } finally {
    release();
    await module.close();
  }
  await vi.advanceTimersByTimeAsync(10_000);
  expect(processPending).toHaveBeenCalledTimes(2);
});
