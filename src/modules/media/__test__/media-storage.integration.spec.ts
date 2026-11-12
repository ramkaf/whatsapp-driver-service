import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { Logger } from '@nestjs/common';
import type { IAppConfig } from '@libs/common';
import type { WAMessage } from '@whiskeysockets/baileys';
import { MediaService } from '../providers/media.service.ts';
import { MinioStorageService } from '../providers/minio-storage.service.ts';
import { isMediaTransferFailure } from '../utils/media-transfer-failure.util.ts';

const { downloadMediaMessage, statObject, putObject, presignedGetObject } =
  vi.hoisted(() => ({
    downloadMediaMessage: vi.fn(),
    statObject: vi.fn(),
    putObject: vi.fn(),
    presignedGetObject: vi.fn(),
  }));
vi.mock('@whiskeysockets/baileys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@whiskeysockets/baileys')>()),
  downloadMediaMessage,
}));
vi.mock('minio', () => ({
  Client: class {
    statObject = statObject;
    putObject = putObject;
    presignedGetObject = presignedGetObject;
  },
}));

const config = {
  minio: {
    endpoint: 'storage.test',
    port: 9000,
    useSsl: false,
    accessKey: 'test-access',
    secretKey: 'test-secret',
    bucket: 'test-media',
  },
} as IAppConfig;
const bytes = Buffer.from([0x00, 0xff, 0x80, 0x25, 0x50, 0x44, 0x46]);
const hash = createHash('sha256').update(bytes).digest('hex');
const key = 'media/sha256/' + hash.slice(0, 2) + '/' + hash;

function attachment(
  chat = 'chat@s.whatsapp.net',
  id = 'same-message',
): WAMessage {
  return {
    key: { remoteJid: chat, id },
    message: {
      ephemeralMessage: {
        message: {
          documentMessage: {
            url: 'https://media.invalid/document',
            mimetype: 'application/pdf',
            fileName: 'report.pdf',
          },
        },
      },
    },
  };
}

describe('MediaService integration with MinioStorageService', () => {
  let media: MediaService;
  let objects: Map<string, { bytes: Buffer; metadata: Record<string, string> }>;
  const context = { updateMediaMessage: vi.fn() };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    objects = new Map();
    statObject.mockImplementation(
      async (_bucket: string, objectKey: string) => {
        const object = objects.get(objectKey);
        if (!object)
          throw Object.assign(new Error('missing'), { code: 'NoSuchKey' });
        return {
          size: object.bytes.length,
          etag: 'stored-etag',
          metaData: object.metadata,
        };
      },
    );
    putObject.mockImplementation(
      async (
        _bucket: string,
        objectKey: string,
        stream: Readable,
        size: number,
        metadata: Record<string, string>,
      ) => {
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(Buffer.from(chunk));
        const downloaded = Buffer.concat(chunks);
        expect(downloaded.length).toBe(size);
        objects.set(objectKey, { bytes: downloaded, metadata });
        return { etag: 'stored-etag' };
      },
    );
    presignedGetObject.mockImplementation(
      async (_bucket: string, objectKey: string) =>
        'https://storage.test/' +
        objectKey +
        '?signature=' +
        presignedGetObject.mock.calls.length,
    );
    downloadMediaMessage.mockImplementation(async () => Readable.from([bytes]));
    media = new MediaService(new MinioStorageService(config));
  });
  afterEach(() => vi.restoreAllMocks());

  it('uploads matching content once across simultaneous messages from different conversations', async () => {
    const messages = [
      attachment('first@s.whatsapp.net', 'one'),
      attachment('second@s.whatsapp.net', 'two'),
    ];
    const results = await Promise.all(
      messages.map((message) => media.save(context, message)),
    );
    const stored = results.map((result) => {
      if (!result || isMediaTransferFailure(result))
        throw new Error('Expected successful media storage');
      return result;
    });
    expect(downloadMediaMessage).toHaveBeenCalledTimes(2);
    expect(putObject).toHaveBeenCalledOnce();
    expect(presignedGetObject).toHaveBeenCalledTimes(2);
    expect(objects.get(key)).toEqual({
      bytes,
      metadata: {
        'Content-Type': 'application/pdf',
        'x-amz-meta-sha256': hash,
      },
    });
    expect(stored.map((result) => result.objectKey)).toEqual([key, key]);
    expect(new Set(stored.map((result) => result.url)).size).toBe(2);
    for (const [index, result] of results.entries()) {
      expect(result).toMatchObject({
        bucket: 'test-media',
        objectKey: key,
        sha256: hash,
        mimeType: 'application/pdf',
        chatId: messages[index].key.remoteJid,
        messageId: messages[index].key.id,
        originalFileName: 'report.pdf',
      });
    }
  });

  it('uploads identical thumbnails once across concurrent conversations', async () => {
    const thumbnail = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const thumbnailHash = createHash('sha256').update(thumbnail).digest('hex');
    const thumbnailKey =
      'media/sha256/' + thumbnailHash.slice(0, 2) + '/' + thumbnailHash;
    const messages: WAMessage[] = ['first', 'second'].map((chat) => ({
      key: { remoteJid: chat + '@s.whatsapp.net', id: 'message' },
      message: { imageMessage: { jpegThumbnail: thumbnail } },
    }));
    const results = await Promise.all(
      messages.map((message) => media.saveThumbnail(message)),
    );

    expect(results).toEqual([thumbnailKey, thumbnailKey]);
    expect(putObject).toHaveBeenCalledOnce();
    expect(downloadMediaMessage).not.toHaveBeenCalled();
    expect(objects.get(thumbnailKey)).toEqual({
      bytes: thumbnail,
      metadata: {
        'Content-Type': 'image/jpeg',
        'x-amz-meta-sha256': thumbnailHash,
      },
    });
  });

  it('replaces an object whose checksum metadata does not match the downloaded content', async () => {
    objects.set(key, {
      bytes: Buffer.alloc(bytes.length),
      metadata: { 'x-amz-meta-sha256': 'wrong-checksum' },
    });
    await expect(media.save(context, attachment())).resolves.toMatchObject({
      objectKey: key,
      sha256: hash,
    });
    expect(putObject).toHaveBeenCalledOnce();
    expect(objects.get(key)!.bytes).toEqual(bytes);
    expect(objects.get(key)!.metadata['x-amz-meta-sha256']).toBe(hash);
  });

  it('stores different content separately even when message identifiers and byte lengths match', async () => {
    const different = Buffer.from(bytes);
    different[0] = 0x7f;
    downloadMediaMessage
      .mockImplementationOnce(async () => Readable.from([bytes]))
      .mockImplementationOnce(async () => Readable.from([different]));
    const first = await media.save(context, attachment());
    const second = await media.save(context, attachment());
    if (
      !first ||
      !second ||
      isMediaTransferFailure(first) ||
      isMediaTransferFailure(second)
    )
      throw new Error('Expected successful media storage');
    expect(first.objectKey).not.toBe(second.objectKey);
    expect(putObject).toHaveBeenCalledTimes(2);
    expect(objects.get(first.objectKey)!.bytes).toEqual(bytes);
    expect(objects.get(second.objectKey)!.bytes).toEqual(different);
  });

  it('returns an upload failure if signing fails and reuses the already uploaded file on retry', async () => {
    presignedGetObject.mockRejectedValueOnce(
      Object.assign(new Error('signing unavailable'), { code: 'ETIMEDOUT' }),
    );
    await expect(media.save(context, attachment())).resolves.toMatchObject({
      status: 'failed',
      stage: 'upload',
      operation: 'upload',
      errorCode: 'ETIMEDOUT',
    });
    expect(objects.get(key)!.bytes).toEqual(bytes);
    await expect(media.save(context, attachment())).resolves.toMatchObject({
      objectKey: key,
    });
    expect(putObject).toHaveBeenCalledOnce();
  });
});
