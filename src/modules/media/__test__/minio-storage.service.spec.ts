import { Logger } from '@nestjs/common';
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
} = vi.hoisted(() => ({
  statObject: vi.fn(),
  bucketExists: vi.fn(),
  makeBucket: vi.fn(),
  putObject: vi.fn(),
  createClient: vi.fn(),
  presignedGetObject: vi.fn(),
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
const hash = 'a'.repeat(64);
const key = 'media/sha256/aa/' + hash;

describe('MinioStorageService', () => {
  let storage: MinioStorageService;
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    storage = new MinioStorageService(config);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('uses the application configuration to construct the SDK client', () => {
    expect(createClient).toHaveBeenCalledExactlyOnceWith({
      endPoint: 'storage.internal',
      port: 9443,
      useSSL: true,
      accessKey: 'test-access',
      secretKey: 'test-secret',
      transport: { request: expect.any(Function) },
      retryOptions: { disableRetry: true },
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

  it.each(['lookup', 'creation'] as const)(
    'propagates a bucket %s failure',
    async (operation) => {
      const failure = new Error('Storage unavailable');
      if (operation === 'lookup') bucketExists.mockRejectedValue(failure);
      else {
        bucketExists.mockResolvedValue(false);
        makeBucket.mockRejectedValue(failure);
      }
      await expect(storage.onModuleInit()).rejects.toBe(failure);
    },
  );

  it('uploads bytes with their known size, MIME type and SHA-256 metadata and signs the resulting object', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-10T10:00:00.789Z'));
    const stream = Readable.from(['media-bytes']);
    const url = 'https://storage.internal/object?signature=test';
    putObject.mockImplementation(
      async (_bucket: string, _key: string, body: Readable) => {
        const chunks: Buffer[] = [];
        for await (const chunk of body) chunks.push(Buffer.from(chunk));
        expect(Buffer.concat(chunks).toString()).toBe('media-bytes');
        return { etag: 'stored-etag' };
      },
    );
    presignedGetObject.mockResolvedValue(url);
    await expect(
      storage.uploadStream(key, stream, 11, 'image/jpeg', hash),
    ).resolves.toEqual({
      bucket: 'test-bucket',
      objectKey: key,
      etag: 'stored-etag',
      url,
      urlExpiresAt: '2026-11-17T10:00:00.000Z',
    });
    expect(putObject).toHaveBeenCalledExactlyOnceWith(
      'test-bucket',
      key,
      stream,
      11,
      { 'Content-Type': 'image/jpeg', 'x-amz-meta-sha256': hash },
    );
    expect(presignedGetObject).toHaveBeenCalledExactlyOnceWith(
      'test-bucket',
      key,
      604800,
      {},
      new Date('2026-11-10T10:00:00.000Z'),
    );
  });

  it.each(['upload', 'signing'] as const)(
    'propagates %s failures without returning a successful result',
    async (operation) => {
      const failure = new Error('Storage unavailable');
      putObject.mockResolvedValue({ etag: 'etag' });
      if (operation === 'upload') putObject.mockRejectedValue(failure);
      else presignedGetObject.mockRejectedValue(failure);
      const stream = Readable.from(['bytes']);
      try {
        await expect(
          storage.uploadStream(key, stream, 5, 'application/pdf', hash),
        ).rejects.toBe(failure);
        if (operation === 'upload')
          expect(presignedGetObject).not.toHaveBeenCalled();
      } finally {
        stream.destroy();
      }
    },
  );

  it('passes reserved path characters to the SDK without rewriting its signed URL', async () => {
    const objectKey = 'legacy/report #1+فارسی.pdf';
    const url = 'https://storage.internal/encoded?signature=unchanged';
    presignedGetObject.mockResolvedValue(url);
    await expect(
      storage.getStoredObject(objectKey, 'etag'),
    ).resolves.toMatchObject({ objectKey, url });
    expect(presignedGetObject).toHaveBeenCalledWith(
      'test-bucket',
      objectKey,
      604800,
      {},
      expect.any(Date),
    );
  });

  it('refreshes download URLs for existing objects without uploading again', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-10T10:00:00.789Z'));
    presignedGetObject
      .mockResolvedValueOnce('first-url')
      .mockResolvedValueOnce('fresh-url');
    const first = await storage.getStoredObject(key, 'existing-etag');
    vi.setSystemTime(new Date('2026-11-11T10:00:00.789Z'));
    const fresh = await storage.getStoredObject(key, 'existing-etag');
    expect(first.urlExpiresAt).toBe('2026-11-17T10:00:00.000Z');
    expect(fresh).toMatchObject({
      objectKey: key,
      etag: 'existing-etag',
      url: 'fresh-url',
      urlExpiresAt: '2026-11-18T10:00:00.000Z',
    });
    expect(putObject).not.toHaveBeenCalled();
    expect(statObject).not.toHaveBeenCalled();
  });

  it.each(['x-amz-meta-sha256', 'X-Amz-Meta-Sha256'])(
    'reads size, etag and checksum metadata from %s',
    async (header) => {
      statObject.mockResolvedValue({
        size: 1234,
        etag: 'current-etag',
        metaData: { [header]: hash },
      });
      await expect(storage.getObjectInfo(key)).resolves.toEqual({
        objectKey: key,
        size: 1234,
        etag: 'current-etag',
        sha256: hash,
      });
      expect(statObject).toHaveBeenCalledExactlyOnceWith('test-bucket', key);
    },
  );

  it('reuses an object only when both its actual size and SHA-256 match', async () => {
    statObject.mockResolvedValue({
      size: 20,
      etag: 'current-etag',
      metaData: { 'x-amz-meta-sha256': hash },
    });
    presignedGetObject.mockResolvedValue('fresh-url');
    await expect(
      storage.getExistingObject(key, 20, hash),
    ).resolves.toMatchObject({
      objectKey: key,
      etag: 'current-etag',
      url: 'fresh-url',
    });
    expect(putObject).not.toHaveBeenCalled();
  });

  it.each([
    { size: 21, metaData: { 'x-amz-meta-sha256': hash } },
    { size: 20, metaData: { 'x-amz-meta-sha256': 'b'.repeat(64) } },
    { size: 20 },
  ])(
    'does not reuse an object with mismatched or missing integrity metadata: %j',
    async (info) => {
      statObject.mockResolvedValue({ etag: 'etag', ...info });
      await expect(
        storage.getExistingObject(key, 20, hash),
      ).resolves.toBeNull();
      expect(presignedGetObject).not.toHaveBeenCalled();
    },
  );

  it('returns null for a nonexistent content key', async () => {
    statObject.mockRejectedValue(
      Object.assign(new Error('missing'), { code: 'NoSuchKey' }),
    );
    await expect(storage.getExistingObject(key, 20, hash)).resolves.toBeNull();
    expect(presignedGetObject).not.toHaveBeenCalled();
  });

  it.each([
    { code: 'NoSuchKey' },
    { code: 'NoSuchObject' },
    { code: 'NotFound' },
    { statusCode: 404 },
  ])(
    'recognizes missing objects without hiding other storage errors: %j',
    async (details) => {
      statObject.mockRejectedValue(
        Object.assign(new Error('missing'), details),
      );
      await expect(storage.getObjectInfo(key)).resolves.toBeNull();
      await expect(storage.objectExists(key)).resolves.toBe(false);
    },
  );

  it.each(['AccessDenied', 'NoSuchBucket', 'ECONNREFUSED'])(
    'propagates %s instead of treating the object as missing',
    async (code) => {
      const failure = Object.assign(new Error('storage failed'), { code });
      statObject.mockRejectedValue(failure);
      await expect(storage.getObjectInfo(key)).rejects.toBe(failure);
      await expect(storage.getExistingObject(key, 20, hash)).rejects.toBe(
        failure,
      );
    },
  );

  it('reports an existing object even when checksum metadata is unavailable', async () => {
    statObject.mockResolvedValue({ size: 0, etag: 'etag' });
    await expect(storage.objectExists(key)).resolves.toBe(true);
  });
});
