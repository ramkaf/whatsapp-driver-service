import { Logger } from '@nestjs/common';
import type { ReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { WAMessage, WAMessageContent } from '@whiskeysockets/baileys';
import { MediaService } from '../providers/media.service.ts';
import type { MinioStorageService } from '../providers/minio-storage.service.ts';

const { downloadMediaMessage } = vi.hoisted(() => ({
  downloadMediaMessage: vi.fn(),
}));

vi.mock('@whiskeysockets/baileys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@whiskeysockets/baileys')>()),
  downloadMediaMessage,
}));
vi.mock('../providers/minio-storage.service.ts', () => ({
  MinioStorageService: class {},
}));

const datePrefix = '2026-11-09T12-00-00-000Z';
const uuidPattern =
  '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

function message(
  content: WAMessageContent | null = {
    imageMessage: { url: 'https://media.invalid/image' },
  },
  key: WAMessage['key'] = {},
): WAMessage {
  return {
    key: {
      remoteJid: 'chat@s.whatsapp.net',
      id: 'message-one',
      ...key,
    },
    message: content,
  };
}

function fixture() {
  const stream = Readable.from([Buffer.from('downloaded attachment')]);
  downloadMediaMessage.mockResolvedValue(stream);
  const uploadedBytes: Buffer[] = [];
  const storage = {
    exists: vi.fn<MinioStorageService['exists']>().mockResolvedValue(null),
    uploadStream: vi.fn(
      async (objectKey: string, input: Readable, _mimeType: string) => {
        for await (const chunk of input) uploadedBytes.push(Buffer.from(chunk));
        return {
          bucket: 'test-media',
          objectKey,
          etag: 'uploaded-etag',
          url: `https://storage.test/test-media/${objectKey}?signature=test`,
          urlExpiresAt: '2026-11-16T00:00:00.000Z',
        };
      },
    ),
  };
  const socket = { updateMediaMessage: vi.fn() };
  const service = new MediaService(storage as unknown as MinioStorageService);
  return { service, storage, socket, stream, uploadedBytes };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-09T12:00:00.000Z'));
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('MediaService', () => {
  it.each([
    [{ conversation: 'plain text' }],
    [
      {
        extendedTextMessage: {
          text: 'a link',
          jpegThumbnail: Buffer.from('preview'),
        },
      },
    ],
    [null],
  ] satisfies [WAMessageContent | null][])(
    'ignores content without an attachment: %j',
    async (content) => {
      const { service, storage, socket } = fixture();
      const input = message(content);
      expect(service.hasMedia(input)).toBe(false);
      await expect(service.save(socket, input)).resolves.toBeNull();
      expect(downloadMediaMessage).not.toHaveBeenCalled();
      expect(storage.uploadStream).not.toHaveBeenCalled();
      expect(storage.exists).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      { imageMessage: { url: 'https://media.invalid/image' } },
      'image',
      'image/jpeg',
      '.jpg',
    ],
    [
      { videoMessage: { url: 'https://media.invalid/video' } },
      'video',
      'video/mp4',
      '.mp4',
    ],
    [
      { ptvMessage: { url: 'https://media.invalid/video-note' } },
      'video',
      'video/mp4',
      '.mp4',
    ],
    [
      { audioMessage: { url: 'https://media.invalid/audio' } },
      'audio',
      'audio/ogg',
      '.ogg',
    ],
    [
      { audioMessage: { url: 'https://media.invalid/voice', ptt: true } },
      'voice',
      'audio/ogg',
      '.ogg',
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
      '.pdf',
    ],
    [
      { stickerMessage: { url: 'https://media.invalid/sticker' } },
      'sticker',
      'image/webp',
      '.webp',
    ],
  ] satisfies [WAMessageContent, string, string, string][])(
    'streams %j into storage as %s',
    async (content, type, mimeType, extension) => {
      const { service, storage, socket, uploadedBytes } = fixture();
      const input = message(content);
      expect(service.hasMedia(input)).toBe(true);
      const result = await service.save(socket, input);
      expect(result).not.toBeNull();
      const objectKey = result!.objectKey;
      expect(objectKey).toMatch(
        new RegExp(
          `^conversations/chat@s\\.whatsapp\\.net/${datePrefix}_${uuidPattern}_message-one\\${extension}$`,
        ),
      );
      expect(downloadMediaMessage).toHaveBeenCalledWith(
        input,
        'stream',
        {},
        expect.objectContaining({ reuploadRequest: socket.updateMediaMessage }),
      );
      expect(storage.uploadStream).toHaveBeenCalledWith(
        objectKey,
        expect.any(Readable),
        mimeType,
      );
      expect(storage.exists).toHaveBeenCalledExactlyOnceWith(
        'chat@s.whatsapp.net',
        'message-one',
        Buffer.byteLength('downloaded attachment'),
      );
      expect(Buffer.concat(uploadedBytes).toString()).toBe(
        'downloaded attachment',
      );
      expect(result).toMatchObject({
        bucket: 'test-media',
        objectKey,
        etag: 'uploaded-etag',
        url: `https://storage.test/test-media/${objectKey}?signature=test`,
        urlExpiresAt: '2026-11-16T00:00:00.000Z',
        chatId: 'chat@s.whatsapp.net',
        senderId: 'chat@s.whatsapp.net',
        messageId: 'message-one',
        type,
        mimeType,
        originalFileName: type === 'document' ? 'report.PDF' : null,
      });
      expect(input.message).toEqual(content);
      const inputStream = storage.uploadStream.mock.calls[0]![1] as ReadStream;
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
            mimetype: 'application/pdf',
            fileName: 'invoice.pdf',
          },
        },
      },
    });
    expect(service.hasMedia(input)).toBe(true);
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
    expect(service.hasMedia(input)).toBe(true);
    await expect(service.save(socket, input)).resolves.toMatchObject({
      type: 'image',
    });
  });

  it('sanitizes conversation and message identifiers without adding a session directory', async () => {
    const { service, socket } = fixture();
    const input = message(undefined, {
      remoteJid: '../chat/one@s.whatsapp.net',
      id: '../message/one',
    });
    const result = await service.save(socket, input);
    expect(result).not.toBeNull();
    expect(result!.objectKey.split('/').slice(0, -1)).toEqual([
      'conversations',
      '.._chat_one@s.whatsapp.net',
    ]);
    expect(result!.objectKey).toMatch(/_\.\._message_one\.jpg$/);
  });

  it('stores repeated messages in the conversation directory with unique dated filenames regardless of sender or direction', async () => {
    const { service, socket } = fixture();
    downloadMediaMessage.mockImplementation(async () =>
      Readable.from(['attachment']),
    );
    const keys = [
      {
        remoteJid: 'group@g.us',
        participant: 'member-one@s.whatsapp.net',
        fromMe: false,
      },
      {
        remoteJid: 'group@g.us',
        participant: 'member-two@s.whatsapp.net',
        fromMe: true,
      },
      {
        remoteJid: 'group@g.us',
        participant: 'member-one@s.whatsapp.net',
        fromMe: false,
      },
      { remoteJid: 'chat@s.whatsapp.net', fromMe: false },
      { remoteJid: 'chat@s.whatsapp.net', fromMe: true },
    ];
    const results = await Promise.all(
      keys.map((key) => service.save(socket, message(undefined, key))),
    );
    for (const [index, result] of results.entries()) {
      expect(result).not.toBeNull();
      expect(result!.chatId).toBe(keys[index]!.remoteJid);
      const [directory, conversationId, filename, extra] =
        result!.objectKey.split('/');
      expect(directory).toBe('conversations');
      expect(conversationId).toBe(keys[index]!.remoteJid);
      expect(filename).toMatch(
        new RegExp(`^${datePrefix}_${uuidPattern}_message-one\\.jpg$`),
      );
      expect(extra).toBeUndefined();
    }
    expect(new Set(results.map((result) => result!.objectKey)).size).toBe(
      keys.length,
    );
  });

  it('normalizes content types and keeps document filename metadata', async () => {
    const { service, storage, socket } = fixture();
    const input = message({
      documentMessage: {
        url: 'https://media.invalid/document',
        mimetype: ' TEXT/PLAIN; charset=utf-8 ',
        fileName: 'notes.TXT',
      },
    });
    await expect(service.save(socket, input)).resolves.toMatchObject({
      mimeType: 'text/plain',
      originalFileName: 'notes.TXT',
      objectKey: expect.stringMatching(/_message-one\.txt$/),
    });
    expect(storage.uploadStream).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Readable),
      'text/plain',
    );
  });

  it('propagates download failures without uploading an empty attachment', async () => {
    const { service, storage, socket } = fixture();
    const error = new Error('Download failed');
    downloadMediaMessage.mockRejectedValueOnce(error);
    await expect(service.save(socket, message())).rejects.toBe(error);
    expect(storage.uploadStream).not.toHaveBeenCalled();
    expect(storage.exists).not.toHaveBeenCalled();
  });

  it('destroys the download stream if uploading fails', async () => {
    const { service, storage, socket, stream } = fixture();
    const error = new Error('Upload failed');
    storage.uploadStream.mockRejectedValueOnce(error);
    await expect(service.save(socket, message())).rejects.toBe(error);
    expect(stream.destroyed).toBe(true);
    const inputStream = storage.uploadStream.mock.calls[0]![1] as ReadStream;
    expect(inputStream.destroyed).toBe(true);
    await expect(access(inputStream.path)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('reuses an existing file with a fresh address and compares the downloaded byte size', async () => {
    const { service, storage, socket, stream } = fixture();
    const existing = {
      bucket: 'test-media',
      objectKey:
        'conversations/chat@s.whatsapp.net/older-date_uuid_message-one.jpg',
      etag: 'existing-etag',
      url: 'https://storage.test/existing.jpg?signature=fresh',
      urlExpiresAt: '2026-11-16T12:00:00.000Z',
    };
    storage.exists.mockResolvedValueOnce(existing);
    const input = message({
      imageMessage: {
        url: 'https://media.invalid/image',
        fileLength: 1,
      },
    });

    await expect(service.save(socket, input)).resolves.toMatchObject({
      ...existing,
      messageId: 'message-one',
      chatId: 'chat@s.whatsapp.net',
      type: 'image',
    });

    expect(storage.exists).toHaveBeenCalledExactlyOnceWith(
      'chat@s.whatsapp.net',
      'message-one',
      Buffer.byteLength('downloaded attachment'),
    );
    expect(storage.uploadStream).not.toHaveBeenCalled();
    expect(stream.destroyed).toBe(true);
  });

  it('does not upload when the existing-file lookup fails', async () => {
    const { service, storage, socket, stream } = fixture();
    const error = new Error('MinIO listing failed');
    storage.exists.mockRejectedValueOnce(error);

    await expect(service.save(socket, message())).rejects.toBe(error);

    expect(storage.uploadStream).not.toHaveBeenCalled();
    expect(stream.destroyed).toBe(true);
  });

  it('serializes identical concurrent messages so only one file is uploaded', async () => {
    const { service, storage, socket } = fixture();
    downloadMediaMessage.mockImplementation(async () =>
      Readable.from(['same bytes']),
    );
    let stored: {
      bucket: string;
      objectKey: string;
      etag: string;
      url: string;
      urlExpiresAt: string;
    } | null = null;
    storage.exists.mockImplementation(async () => stored);
    let release!: () => void;
    const uploadPending = new Promise<void>((resolve) => {
      release = resolve;
    });
    storage.uploadStream.mockImplementation(async (objectKey, input) => {
      await uploadPending;
      const chunks: Buffer[] = [];
      for await (const chunk of input) chunks.push(Buffer.from(chunk));
      expect(Buffer.concat(chunks).toString()).toBe('same bytes');
      stored = {
        bucket: 'test-media',
        objectKey,
        etag: 'uploaded-etag',
        url: `https://storage.test/test-media/${objectKey}?signature=test`,
        urlExpiresAt: '2026-11-16T12:00:00.000Z',
      };
      return stored;
    });

    const saving = Promise.all([
      service.save(socket, message()),
      service.save(socket, message()),
    ]);
    let downloadsBeforeFirstUpload = 0;
    try {
      await vi.waitFor(() =>
        expect(storage.uploadStream).toHaveBeenCalledOnce(),
      );
      downloadsBeforeFirstUpload = downloadMediaMessage.mock.calls.length;
    } finally {
      release();
    }
    const [first, second] = await saving;

    expect(downloadsBeforeFirstUpload).toBe(1);
    expect(storage.uploadStream).toHaveBeenCalledOnce();
    expect(storage.exists).toHaveBeenCalledTimes(2);
    expect(first?.objectKey).toBe(second?.objectKey);
    expect(second?.url).toBe(first?.url);
  });

  it('uploads another version of the same message when the actual size differs', async () => {
    const { service, storage, socket } = fixture();
    downloadMediaMessage.mockResolvedValueOnce(Readable.from(['old']));
    downloadMediaMessage.mockResolvedValueOnce(Readable.from(['new content']));
    const first = await service.save(socket, message());
    storage.exists.mockImplementation(async (_chatId, _messageId, size) =>
      size === Buffer.byteLength('old') ? first : null,
    );

    const second = await service.save(socket, message());

    expect(storage.uploadStream).toHaveBeenCalledTimes(2);
    expect(storage.exists).toHaveBeenLastCalledWith(
      'chat@s.whatsapp.net',
      'message-one',
      Buffer.byteLength('new content'),
    );
    expect(first?.objectKey).not.toBe(second?.objectKey);
  });
});
