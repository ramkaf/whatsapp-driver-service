import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { ReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { WAMessage, WAMessageContent } from '@whiskeysockets/baileys';
import { MediaService } from '../providers/media.service.ts';
import type { MinioStorageService } from '../providers/minio-storage.service.ts';
import type { StoredMinioObject } from '../interfaces/media.interface.ts';

const { downloadMediaMessage } = vi.hoisted(() => ({
  downloadMediaMessage: vi.fn(),
}));
vi.mock('@whiskeysockets/baileys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@whiskeysockets/baileys')>()),
  downloadMediaMessage,
}));

const bytes = Buffer.from('downloaded attachment');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const objectKey = 'media/sha256/' + sha256.slice(0, 2) + '/' + sha256;

function message(
  content: WAMessageContent | null = {
    imageMessage: { url: 'https://media.invalid/image' },
  },
  key: WAMessage['key'] = {},
): WAMessage {
  return {
    key: { remoteJid: 'chat@s.whatsapp.net', id: 'message-one', ...key },
    message: content,
  };
}

function stored(key = objectKey): StoredMinioObject {
  return {
    bucket: 'test-media',
    objectKey: key,
    etag: 'uploaded-etag',
    url: 'https://storage.test/test-media/' + key + '?signature=test',
    urlExpiresAt: '2026-11-17T00:00:00.000Z',
  };
}

function fixture() {
  const uploadedBytes: Buffer[] = [];
  const downloads: Readable[] = [];
  downloadMediaMessage.mockImplementation(async () => {
    const stream = Readable.from([bytes]);
    downloads.push(stream);
    return stream;
  });
  const storage = {
    getExistingObject: vi
      .fn<MinioStorageService['getExistingObject']>()
      .mockResolvedValue(null),
    uploadStream: vi.fn<MinioStorageService['uploadStream']>(
      async (key, stream) => {
        for await (const chunk of stream)
          uploadedBytes.push(Buffer.from(chunk));
        return stored(key);
      },
    ),
  };
  const socket = { updateMediaMessage: vi.fn() };
  return {
    service: new MediaService(storage as unknown as MinioStorageService),
    storage,
    socket,
    uploadedBytes,
    downloads,
  };
}

beforeEach(() => {
  downloadMediaMessage.mockReset();
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('MediaService', () => {
  it.each([
    { conversation: 'plain text' },
    {
      extendedTextMessage: {
        text: 'a link',
        jpegThumbnail: Buffer.from('preview'),
      },
    },
    null,
  ] satisfies (WAMessageContent | null)[])(
    'ignores content without an attachment: %j',
    async (content) => {
      const { service, storage, socket } = fixture();
      const input = message(content);
      expect(service.hasMedia(input)).toBe(false);
      await expect(service.save(socket, input)).resolves.toBeNull();
      expect(downloadMediaMessage).not.toHaveBeenCalled();
      expect(storage.uploadStream).not.toHaveBeenCalled();
      expect(storage.getExistingObject).not.toHaveBeenCalled();
    },
  );

  it.each([{ id: undefined }, { remoteJid: undefined }])(
    'does not download a message without its required identifiers: %j',
    async (key) => {
      const { service, socket } = fixture();
      await expect(
        service.save(socket, message(undefined, key)),
      ).resolves.toBeNull();
      expect(downloadMediaMessage).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      { imageMessage: { url: 'https://media.invalid/image' } },
      'image',
      'image/jpeg',
    ],
    [
      { videoMessage: { url: 'https://media.invalid/video' } },
      'video',
      'video/mp4',
    ],
    [
      { ptvMessage: { url: 'https://media.invalid/note' } },
      'video',
      'video/mp4',
    ],
    [
      { audioMessage: { url: 'https://media.invalid/audio' } },
      'audio',
      'audio/ogg',
    ],
    [
      { audioMessage: { url: 'https://media.invalid/voice', ptt: true } },
      'voice',
      'audio/ogg',
    ],
    [
      {
        documentMessage: {
          url: 'https://media.invalid/document',
          mimetype: 'application/pdf',
          fileName: 'report.PDF',
        },
      },
      'document',
      'application/pdf',
    ],
    [
      { stickerMessage: { url: 'https://media.invalid/sticker' } },
      'sticker',
      'image/webp',
    ],
  ] satisfies [WAMessageContent, string, string][])(
    'streams %j into content-addressed storage as %s',
    async (content, type, mimeType) => {
      const f = fixture();
      const input = message(content);
      expect(f.service.hasMedia(input)).toBe(true);
      const result = await f.service.save(f.socket, input);
      expect(result).toEqual({
        ...stored(),
        chatId: 'chat@s.whatsapp.net',
        messageId: 'message-one',
        type,
        mimeType,
        originalFileName: type === 'document' ? 'report.PDF' : null,
        sha256,
      });
      expect(downloadMediaMessage).toHaveBeenCalledWith(
        input,
        'stream',
        {},
        expect.objectContaining({
          reuploadRequest: f.socket.updateMediaMessage,
        }),
      );
      expect(f.storage.getExistingObject).toHaveBeenCalledExactlyOnceWith(
        objectKey,
        bytes.length,
        sha256,
      );
      expect(f.storage.uploadStream).toHaveBeenCalledWith(
        objectKey,
        expect.any(Readable),
        bytes.length,
        mimeType,
        sha256,
      );
      expect(Buffer.concat(f.uploadedBytes)).toEqual(bytes);
      expect(input.message).toEqual(content);
      const inputStream = f.storage.uploadStream.mock.calls[0][1] as ReadStream;
      expect(inputStream.destroyed).toBe(true);
      await expect(access(inputStream.path)).rejects.toMatchObject({
        code: 'ENOENT',
      });
    },
  );

  it.each([
    'ephemeralMessage',
    'viewOnceMessage',
    'viewOnceMessageV2',
    'documentWithCaptionMessage',
    'editedMessage',
  ] as const)('finds attachments wrapped in %s', async (wrapper) => {
    const { service, socket } = fixture();
    const input = message({
      [wrapper]: {
        message: {
          documentMessage: {
            url: 'https://media.invalid/document',
            fileName: 'invoice.pdf',
          },
        },
      },
    });
    await expect(service.save(socket, input)).resolves.toMatchObject({
      type: 'document',
      originalFileName: 'invoice.pdf',
    });
  });

  it('uses the same extraction as Baileys for attachments in templates', async () => {
    const { service, socket } = fixture();
    const input = message({
      templateMessage: {
        hydratedTemplate: {
          imageMessage: { url: 'https://media.invalid/image' },
        },
      },
    });
    await expect(service.save(socket, input)).resolves.toMatchObject({
      type: 'image',
    });
  });

  it('normalizes MIME types and preserves the original filename independently of the storage key', async () => {
    const f = fixture();
    const input = message({
      documentMessage: {
        url: 'https://media.invalid/document',
        mimetype: ' TEXT/PLAIN; charset=utf-8 ',
        fileName: 'notes.TXT',
      },
    });
    await expect(f.service.save(f.socket, input)).resolves.toMatchObject({
      mimeType: 'text/plain',
      originalFileName: 'notes.TXT',
      objectKey,
    });
    expect(f.storage.uploadStream).toHaveBeenCalledWith(
      objectKey,
      expect.any(Readable),
      bytes.length,
      'text/plain',
      sha256,
    );
  });

  it('does not put conversation or message identifiers into the object key', async () => {
    const { service, socket } = fixture();
    const input = message(undefined, {
      remoteJid: '../chat/one@s.whatsapp.net',
      id: '../message/one',
    });
    await expect(service.save(socket, input)).resolves.toMatchObject({
      objectKey,
    });
  });

  it('reuses matching content after measuring its actual size instead of trusting fileLength', async () => {
    const f = fixture();
    const existing = {
      ...stored(),
      etag: 'existing-etag',
      url: 'https://storage.test/existing?signature=fresh',
    };
    f.storage.getExistingObject.mockResolvedValueOnce(existing);
    const input = message({
      imageMessage: { url: 'https://media.invalid/image', fileLength: 1 },
    });
    await expect(f.service.save(f.socket, input)).resolves.toMatchObject(
      existing,
    );
    expect(f.storage.getExistingObject).toHaveBeenCalledWith(
      objectKey,
      bytes.length,
      sha256,
    );
    expect(f.storage.uploadStream).not.toHaveBeenCalled();
    expect(f.downloads[0].destroyed).toBe(true);
  });

  it('propagates download and object-lookup failures without uploading', async () => {
    const f = fixture();
    const downloadFailure = new Error('download unavailable');
    downloadMediaMessage.mockRejectedValueOnce(downloadFailure);
    await expect(f.service.save(f.socket, message())).rejects.toBe(
      downloadFailure,
    );
    expect(f.storage.getExistingObject).not.toHaveBeenCalled();
    const lookupFailure = new Error('MinIO unavailable');
    f.storage.getExistingObject.mockRejectedValueOnce(lookupFailure);
    await expect(f.service.save(f.socket, message())).rejects.toBe(
      lookupFailure,
    );
    expect(f.storage.uploadStream).not.toHaveBeenCalled();
  });

  it('closes the upload stream and removes its temporary file after an upload failure', async () => {
    const f = fixture();
    const failure = new Error('upload unavailable');
    f.storage.uploadStream.mockRejectedValueOnce(failure);
    await expect(f.service.save(f.socket, message())).rejects.toBe(failure);
    const stream = f.storage.uploadStream.mock.calls[0][1] as ReadStream;
    expect(stream.destroyed).toBe(true);
    await expect(access(stream.path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects empty media before checking or uploading an object', async () => {
    const f = fixture();
    downloadMediaMessage.mockResolvedValueOnce(Readable.from([]));
    await expect(f.service.save(f.socket, message())).rejects.toThrow(
      'Downloaded media is empty',
    );
    expect(f.storage.getExistingObject).not.toHaveBeenCalled();
    expect(f.storage.uploadStream).not.toHaveBeenCalled();
  });

  it('rejects media exceeding the streamed 25 MiB limit even when fileLength claims it is small', async () => {
    const f = fixture();
    const chunk = Buffer.alloc(1024 * 1024);
    const stream = Readable.from(
      (function* () {
        for (let i = 0; i < 26; i++) yield chunk;
      })(),
    );
    downloadMediaMessage.mockResolvedValueOnce(stream);
    const input = message({
      imageMessage: { url: 'https://media.invalid/image', fileLength: 1 },
    });
    await expect(f.service.save(f.socket, input)).rejects.toThrow(
      'Media exceeds maximum allowed size',
    );
    expect(stream.destroyed).toBe(true);
    expect(f.storage.uploadStream).not.toHaveBeenCalled();
  });

  it('propagates a download stream failure without uploading partial content', async () => {
    const f = fixture();
    const failure = new Error('stream interrupted');
    downloadMediaMessage.mockResolvedValueOnce(
      Readable.from(
        (async function* () {
          yield bytes;
          throw failure;
        })(),
      ),
    );
    await expect(f.service.save(f.socket, message())).rejects.toBe(failure);
    expect(f.storage.uploadStream).not.toHaveBeenCalled();
  });

  it('does not poison the per-message queue when an upload fails', async () => {
    const f = fixture();
    f.storage.uploadStream.mockRejectedValueOnce(
      new Error('first attempt failed'),
    );
    await expect(f.service.save(f.socket, message())).rejects.toThrow(
      'first attempt failed',
    );
    await expect(f.service.save(f.socket, message())).resolves.toMatchObject({
      objectKey,
    });
  });
});
