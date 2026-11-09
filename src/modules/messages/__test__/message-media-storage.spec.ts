import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { PassThrough, Readable } from 'node:stream';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { Provider } from '@nestjs/common';
import type { WAMessage, WASocket } from '@whiskeysockets/baileys';
import { configuer } from '@libs/common';
import type { IAppConfig } from '@libs/common';
import { ConnectionMessageSource } from '../../connection/interfaces/message-event-source.ts';
import { SocketEventRegistrarService } from '../../connection/providers/socket/socket-event-registrar.service.ts';
import type { RealtimeService } from '../../connection/providers/realtime/realtime.service.ts';
import { MediaService } from '../../media/providers/media.service.ts';
import { MinioStorageService } from '../../media/providers/minio-storage.service.ts';
import { MessagesReceiveModule } from '../receive/messages-receive.module.ts';
import { MessageEventOutput } from '../receive/interfaces/message-event-output.ts';
import type { ReceivedMessageEvent } from '../receive/interfaces/message-event-output.ts';

const {
  downloadMediaMessage,
  putObject,
  presignedGetObject,
  listObjectsV2,
  statObject,
} = vi.hoisted(() => ({
  downloadMediaMessage: vi.fn(),
  putObject: vi.fn(),
  presignedGetObject: vi.fn(),
  listObjectsV2: vi.fn(),
  statObject: vi.fn(),
}));

vi.mock('@whiskeysockets/baileys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@whiskeysockets/baileys')>()),
  downloadMediaMessage,
}));

vi.mock('minio', () => ({
  Client: class {
    async bucketExists() {
      return true;
    }
    putObject = putObject;
    presignedGetObject = presignedGetObject;
    listObjectsV2 = listObjectsV2;
    statObject = statObject;
  },
}));

interface UploadedObject {
  bucket: string;
  objectKey: string;
  bytes: Buffer;
  metadata: Record<string, string>;
}

function attachment(chatId = 'chat@s.whatsapp.net'): WAMessage {
  return {
    key: { remoteJid: chatId, id: 'same-message' },
    message: {
      ephemeralMessage: {
        message: {
          documentWithCaptionMessage: {
            message: {
              documentMessage: {
                mimetype: 'application/pdf',
                fileName: 'report.pdf',
              },
            },
          },
        },
      },
    },
  };
}

describe('Received attachment streaming to MinIO', () => {
  let module: TestingModule;
  let source: SocketEventRegistrarService;
  let write: ReturnType<typeof vi.fn<(event: ReceivedMessageEvent) => void>>;
  let uploads: UploadedObject[];
  const bytes = Buffer.from([0x00, 0xff, 0x80, 0x25, 0x50, 0x44, 0x46]);

  beforeEach(async () => {
    vi.resetAllMocks();
    uploads = [];
    write = vi.fn<(event: ReceivedMessageEvent) => void>();
    presignedGetObject.mockImplementation(
      async (bucket: string, key: string) =>
        `http://storage.test:9000/${bucket}/${key}?signature=test-${presignedGetObject.mock.calls.length}`,
    );
    listObjectsV2.mockImplementation((bucket: string, prefix: string) =>
      Readable.from(
        uploads
          .filter(
            (upload) =>
              upload.bucket === bucket && upload.objectKey.startsWith(prefix),
          )
          .map((upload) => ({
            name: upload.objectKey,
            size: upload.bytes.length,
            etag: 'uploaded-etag',
          })),
        { objectMode: true },
      ),
    );
    statObject.mockImplementation(async (bucket: string, objectKey: string) => {
      const upload = uploads.find(
        (candidate) =>
          candidate.bucket === bucket && candidate.objectKey === objectKey,
      );
      if (!upload)
        throw Object.assign(new Error('Object not found'), {
          code: 'NoSuchKey',
        });
      return { size: upload.bytes.length, etag: 'uploaded-etag' };
    });
    downloadMediaMessage.mockImplementation(async () => {
      const stream = new PassThrough();
      stream.end(bytes);
      return stream;
    });
    putObject.mockImplementation(
      async (
        bucket: string,
        objectKey: string,
        stream: Readable,
        _size: number | undefined,
        metadata: Record<string, string>,
      ) => {
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(Buffer.from(chunk));
        uploads.push({
          bucket,
          objectKey,
          bytes: Buffer.concat(chunks),
          metadata,
        });
        return { etag: 'uploaded-etag' };
      },
    );
    source = new SocketEventRegistrarService({
      publish: vi.fn(),
    } as unknown as RealtimeService);
    module = await Test.createTestingModule({
      providers: [
        ...(Reflect.getMetadata(
          'providers',
          MessagesReceiveModule,
        ) as Provider[]),
        MediaService,
        MinioStorageService,
        { provide: ConnectionMessageSource, useValue: source },
        {
          provide: configuer.KEY,
          useValue: {
            minio: {
              endpoint: 'storage.test',
              port: 9000,
              useSsl: false,
              accessKey: 'test-access',
              secretKey: 'test-secret',
              bucket: 'test-media',
            },
          } as IAppConfig,
        },
      ],
    })
      .overrideProvider(MessageEventOutput)
      .useValue({ write })
      .compile();
    await module.init();
  });

  afterEach(async () => {
    await module.close();
  });

  it('uploads concurrent duplicate attachments once and returns the existing file with a fresh URL to every session', async () => {
    const message = attachment();
    for (const sessionId of ['account-one', 'account-two']) {
      const ev = new EventEmitter();
      source.register(sessionId, {
        ev,
        updateMediaMessage: vi.fn(),
      } as unknown as WASocket);
      ev.emit('messages.upsert', { type: 'notify', messages: [message] });
    }

    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(downloadMediaMessage).toHaveBeenCalledTimes(2);
    expect(putObject).toHaveBeenCalledOnce();
    expect(presignedGetObject).toHaveBeenCalledTimes(2);
    expect(uploads).toHaveLength(1);
    expect(
      new Set(write.mock.calls.map(([record]) => record.media!.objectKey)).size,
    ).toBe(1);
    expect(
      new Set(write.mock.calls.map(([record]) => record.media!.url)).size,
    ).toBe(2);
    for (const sessionId of ['account-one', 'account-two']) {
      const record = write.mock.calls.find(
        ([event]) => event.sessionId === sessionId,
      )![0];
      const objectKey = record.media!.objectKey;
      const segments = objectKey.split('/');
      expect(segments.slice(0, -1)).toEqual([
        'conversations',
        'chat@s.whatsapp.net',
      ]);
      expect(segments.at(-1)).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z_[0-9a-f-]{36}_same-message\.pdf$/,
      );
      expect(uploads).toContainEqual({
        bucket: 'test-media',
        objectKey,
        bytes,
        metadata: { 'Content-Type': 'application/pdf' },
      });
      expect(record).toMatchObject({
        sessionId,
        event: 'messages.upsert',
        data: { message },
        media: {
          bucket: 'test-media',
          objectKey,
          etag: 'uploaded-etag',
          url: expect.stringContaining(
            `http://storage.test:9000/test-media/${objectKey}?signature=test-`,
          ),
          urlExpiresAt: expect.any(String),
          chatId: 'chat@s.whatsapp.net',
          senderId: 'chat@s.whatsapp.net',
          messageId: 'same-message',
          type: 'document',
          mimeType: 'application/pdf',
          originalFileName: 'report.pdf',
        },
      });
      expect(record).not.toHaveProperty('mediaError');
      const signedAt = presignedGetObject.mock.calls.find(
        ([, key], index) =>
          key === objectKey &&
          record.media!.url.endsWith(`signature=test-${index + 1}`),
      )![4] as Date;
      expect(record?.media?.urlExpiresAt).toBe(
        new Date(signedAt.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      );
    }
  });

  it('uploads a new file when the existing message filename has a different byte size', async () => {
    const existingKey =
      'conversations/chat@s.whatsapp.net/2026-11-09T12-00-00-000Z_123e4567-e89b-42d3-a456-426614174000_same-message.pdf';
    uploads.push({
      bucket: 'test-media',
      objectKey: existingKey,
      bytes: Buffer.from('a different file size'),
      metadata: { 'Content-Type': 'application/pdf' },
    });
    const ev = new EventEmitter();
    source.register('account-one', {
      ev,
      updateMediaMessage: vi.fn(),
    } as unknown as WASocket);
    ev.emit('messages.upsert', { type: 'notify', messages: [attachment()] });

    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    expect(putObject).toHaveBeenCalledOnce();
    expect(uploads).toHaveLength(2);
    const record = write.mock.calls[0]![0];
    expect(record.media!.objectKey).not.toBe(existingKey);
    expect(
      uploads.find((upload) => upload.objectKey === record.media!.objectKey)
        ?.bytes,
    ).toEqual(bytes);
    expect(record).not.toHaveProperty('mediaError');
  });

  it('does not reuse a same-ID same-size attachment from another conversation', async () => {
    const existingKey =
      'conversations/other@s.whatsapp.net/2026-11-09T12-00-00-000Z_123e4567-e89b-42d3-a456-426614174000_same-message.pdf';
    uploads.push({
      bucket: 'test-media',
      objectKey: existingKey,
      bytes,
      metadata: { 'Content-Type': 'application/pdf' },
    });
    const ev = new EventEmitter();
    source.register('account-one', {
      ev,
      updateMediaMessage: vi.fn(),
    } as unknown as WASocket);
    ev.emit('messages.upsert', { type: 'notify', messages: [attachment()] });

    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    expect(listObjectsV2).toHaveBeenCalledWith(
      'test-media',
      'conversations/chat@s.whatsapp.net/',
      true,
    );
    expect(putObject).toHaveBeenCalledOnce();
    expect(uploads).toHaveLength(2);
    const record = write.mock.calls[0]![0];
    expect(record.media!.objectKey).toMatch(
      /^conversations\/chat@s\.whatsapp\.net\//,
    );
    expect(record.media!.objectKey).not.toBe(existingKey);
    expect(record).not.toHaveProperty('mediaError');
  });

  it('outputs plain text without downloading or uploading an attachment', async () => {
    const ev = new EventEmitter();
    source.register('account-one', { ev } as unknown as WASocket);
    const message: WAMessage = {
      key: { remoteJid: 'chat@s.whatsapp.net', id: 'plain' },
      message: { conversation: 'پیام بدون فایل' },
    };

    ev.emit('messages.upsert', { type: 'notify', messages: [message] });

    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    expect(write.mock.calls[0]?.[0]).toMatchObject({
      sessionId: 'account-one',
      data: { message },
    });
    expect(write.mock.calls[0]?.[0]).not.toHaveProperty('media');
    expect(downloadMediaMessage).not.toHaveBeenCalled();
    expect(putObject).not.toHaveBeenCalled();
    expect(presignedGetObject).not.toHaveBeenCalled();
  });
});
