import { Readable } from 'node:stream';
import type { IAppConfig } from '@libs/common';
import { MinioStorageService } from '../providers/minio-storage.service.ts';

const {
  statObject,
  bucketExists,
  makeBucket,
  putObject,
  createClient,
  presignedGetObject,
  listObjectsV2,
} = vi.hoisted(() => ({
  statObject: vi.fn(),
  bucketExists: vi.fn(),
  makeBucket: vi.fn(),
  putObject: vi.fn(),
  createClient: vi.fn(),
  presignedGetObject: vi.fn(),
  listObjectsV2: vi.fn(),
}));
vi.mock('minio', () => ({
  Client: class {
    constructor(options: unknown) {
      createClient(options);
    }
    statObject = statObject;
    bucketExists = bucketExists;
    makeBucket = makeBucket;
    putObject = putObject;
    presignedGetObject = presignedGetObject;
    listObjectsV2 = listObjectsV2;
  },
}));

const config = {
  minio: {
    endpoint: 'storage.internal',
    port: 9443,
    useSsl: true,
    accessKey: 'test-access',
    secretKey: 'test-secret',
    bucket: 'test-bucket',
  },
} as IAppConfig;

describe('MinioStorageService', () => {
  let storage: MinioStorageService;

  beforeEach(() => {
    vi.resetAllMocks();
    storage = new MinioStorageService(config);
  });

  afterEach(() => vi.useRealTimers());

  it('uses resolved application configuration to create the client', () => {
    expect(createClient).toHaveBeenCalledExactlyOnceWith({
      endPoint: 'storage.internal',
      port: 9443,
      useSSL: true,
      accessKey: 'test-access',
      secretKey: 'test-secret',
    });
    expect(storage.bucket).toBe('test-bucket');
  });

  it('creates a missing bucket during initialization', async () => {
    bucketExists.mockResolvedValue(false);
    await storage.onModuleInit();
    expect(bucketExists).toHaveBeenCalledExactlyOnceWith('test-bucket');
    expect(makeBucket).toHaveBeenCalledExactlyOnceWith(
      'test-bucket',
      'us-east-1',
    );
  });

  it('reuses an existing bucket', async () => {
    bucketExists.mockResolvedValue(true);
    await storage.onModuleInit();
    expect(makeBucket).not.toHaveBeenCalled();
  });

  it('propagates bucket initialization failures', async () => {
    const error = new Error('Storage unavailable');
    bucketExists.mockRejectedValue(error);
    await expect(storage.onModuleInit()).rejects.toBe(error);
    expect(makeBucket).not.toHaveBeenCalled();
  });

  it('streams uploads with the media content type and returns object metadata', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-09T10:00:00.789Z'));
    const stream = Readable.from(['media-bytes']);
    const url =
      'https://storage.internal:9443/test-bucket/media/image.jpg?X-Amz-Signature=test-signature';
    presignedGetObject.mockResolvedValue(url);
    putObject.mockImplementation(
      async (_bucket: string, _key: string, body: Readable) => {
        const chunks: Buffer[] = [];
        for await (const chunk of body) chunks.push(Buffer.from(chunk));
        expect(Buffer.concat(chunks).toString()).toBe('media-bytes');
        return { etag: 'stored-etag' };
      },
    );
    await expect(
      storage.uploadStream('media/image.jpg', stream, 'image/jpeg'),
    ).resolves.toEqual({
      bucket: 'test-bucket',
      objectKey: 'media/image.jpg',
      etag: 'stored-etag',
      url,
      urlExpiresAt: '2026-11-16T10:00:00.000Z',
    });
    expect(putObject).toHaveBeenCalledExactlyOnceWith(
      'test-bucket',
      'media/image.jpg',
      stream,
      undefined,
      { 'Content-Type': 'image/jpeg' },
    );
    expect(presignedGetObject).toHaveBeenCalledExactlyOnceWith(
      'test-bucket',
      'media/image.jpg',
      604800,
      {},
      new Date('2026-11-09T10:00:00.000Z'),
    );
  });

  it('propagates upload failures', async () => {
    const error = new Error('Access denied');
    const stream = Readable.from(['media-bytes']);
    putObject.mockRejectedValue(error);
    await expect(
      storage.uploadStream('media/image.jpg', stream, 'image/jpeg'),
    ).rejects.toBe(error);
    expect(presignedGetObject).not.toHaveBeenCalled();
    stream.destroy();
  });

  it('passes reserved path characters to the SDK and preserves the signed URL unchanged', async () => {
    const objectKey = 'sessions/one/chat@s.whatsapp.net/report #1+فارسی.pdf';
    const url =
      'https://storage.internal:9443/test-bucket/signed-encoded-path?X-Amz-Signature=encoded';
    putObject.mockResolvedValue({ etag: 'etag' });
    presignedGetObject.mockResolvedValue(url);
    const stream = Readable.from(['bytes']);
    const result = await storage.uploadStream(
      objectKey,
      stream,
      'application/pdf',
    );
    expect(presignedGetObject).toHaveBeenCalledWith(
      'test-bucket',
      objectKey,
      604800,
      {},
      expect.any(Date),
    );
    expect(result.url).toBe(url);
    stream.destroy();
  });

  it('propagates signing failures rather than returning an unusable address', async () => {
    const error = new Error('Could not sign the download URL');
    putObject.mockResolvedValue({ etag: 'etag' });
    presignedGetObject.mockRejectedValue(error);
    const stream = Readable.from(['bytes']);
    await expect(
      storage.uploadStream('media/image.jpg', stream, 'image/jpeg'),
    ).rejects.toBe(error);
    stream.destroy();
  });

  it('refreshes the URL for an existing object without uploading it again', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-09T10:00:00.789Z'));
    presignedGetObject
      .mockResolvedValueOnce('first-url')
      .mockResolvedValueOnce('fresh-url');
    const first = await storage.getStoredObject(
      'conversations/chat/file.jpg',
      'existing-etag',
    );
    vi.setSystemTime(new Date('2026-11-10T10:00:00.789Z'));
    const fresh = await storage.getStoredObject(
      'conversations/chat/file.jpg',
      'existing-etag',
    );
    expect(first.urlExpiresAt).toBe('2026-11-16T10:00:00.000Z');
    expect(fresh).toEqual({
      bucket: 'test-bucket',
      objectKey: 'conversations/chat/file.jpg',
      etag: 'existing-etag',
      url: 'fresh-url',
      urlExpiresAt: '2026-11-17T10:00:00.000Z',
    });
    expect(putObject).not.toHaveBeenCalled();
    expect(statObject).not.toHaveBeenCalled();
  });

  it('lists object metadata recursively under the requested conversation prefix', async () => {
    const stream = Readable.from([
      { prefix: 'conversations/chat/subdirectory/', size: 0 },
      { name: 'conversations/chat/first.jpg', size: 12, etag: 'first-etag' },
      { name: 'conversations/chat/second.jpg', size: 34, etag: 'second-etag' },
    ]);
    listObjectsV2.mockReturnValue(stream);
    const result = [];
    for await (const object of storage.listObjects('conversations/chat/'))
      result.push(object);
    expect(result).toEqual([
      {
        objectKey: 'conversations/chat/first.jpg',
        size: 12,
        etag: 'first-etag',
      },
      {
        objectKey: 'conversations/chat/second.jpg',
        size: 34,
        etag: 'second-etag',
      },
    ]);
    expect(listObjectsV2).toHaveBeenCalledExactlyOnceWith(
      'test-bucket',
      'conversations/chat/',
      true,
    );
    expect(stream.destroyed).toBe(true);
  });

  it('closes the listing stream when the caller finds a match early', async () => {
    const stream = Readable.from([
      { name: 'conversations/chat/first.jpg', size: 12, etag: 'first-etag' },
      { name: 'conversations/chat/second.jpg', size: 34, etag: 'second-etag' },
    ]);
    listObjectsV2.mockReturnValue(stream);
    for await (const object of storage.listObjects('conversations/chat/')) {
      expect(object.objectKey).toBe('conversations/chat/first.jpg');
      break;
    }
    expect(stream.destroyed).toBe(true);
  });

  it('propagates listing failures and releases the failed stream', async () => {
    const error = Object.assign(new Error('Storage unavailable'), {
      code: 'AccessDenied',
    });
    const stream = new Readable({
      objectMode: true,
      read() {
        this.destroy(error);
      },
    });
    listObjectsV2.mockReturnValue(stream);
    const collect = async () => {
      const result = [];
      for await (const object of storage.listObjects('conversations/chat/'))
        result.push(object);
      return result;
    };
    await expect(collect()).rejects.toBe(error);
    expect(stream.destroyed).toBe(true);
  });

  it.each([0, 1234])(
    'reads current metadata including size %s',
    async (size) => {
      statObject.mockResolvedValue({ size, etag: 'current-etag' });
      await expect(
        storage.getObjectInfo('conversations/chat/file.jpg'),
      ).resolves.toEqual({
        objectKey: 'conversations/chat/file.jpg',
        size,
        etag: 'current-etag',
      });
      expect(statObject).toHaveBeenCalledExactlyOnceWith(
        'test-bucket',
        'conversations/chat/file.jpg',
      );
    },
  );

  it('returns true for an existing object', async () => {
    statObject.mockResolvedValue({ etag: 'existing-etag' });
    await expect(storage.objectExists('media/image.jpg')).resolves.toBe(true);
    expect(statObject).toHaveBeenCalledWith('test-bucket', 'media/image.jpg');
  });

  it.each(['NoSuchKey', 'NotFound'])('returns false for %s', async (code) => {
    statObject.mockRejectedValue(
      Object.assign(new Error('not found'), { code }),
    );
    await expect(storage.objectExists('media/image.jpg')).resolves.toBe(false);
    await expect(storage.getObjectInfo('media/image.jpg')).resolves.toBeNull();
  });

  it.each(['AccessDenied', 'NoSuchBucket', 'ECONNREFUSED'])(
    'propagates %s instead of treating the object as missing',
    async (code) => {
      const error = Object.assign(new Error('storage failed'), { code });
      statObject.mockRejectedValue(error);
      await expect(storage.objectExists('media/image.jpg')).rejects.toBe(error);
      await expect(storage.getObjectInfo('media/image.jpg')).rejects.toBe(
        error,
      );
    },
  );
});
