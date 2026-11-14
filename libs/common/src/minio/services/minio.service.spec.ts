import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Inject, Injectable, Logger, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';

const mocks = vi.hoisted(() => ({
  bucketExists: vi.fn(),
  makeBucket: vi.fn(),
  statObject: vi.fn(),
  presignedGetObject: vi.fn(),
  putObject: vi.fn(),
  fGetObject: vi.fn(),
  removeObject: vi.fn(),
  delay: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock('node:timers/promises', () => ({ setTimeout: mocks.delay }));
vi.mock('minio', () => ({
  Client: class {
    bucketExists = mocks.bucketExists;
    makeBucket = mocks.makeBucket;
    statObject = mocks.statObject;
    presignedGetObject = mocks.presignedGetObject;
    putObject = mocks.putObject;
    fGetObject = mocks.fGetObject;
    removeObject = mocks.removeObject;
  },
}));

import { MinioConnectionService } from './minio-connection.service.ts';
import { MinioStorageService } from './minio.service.ts';
import { MinioModule } from '../minio.module.ts';
import { MINIO_STORAGE, type IMinioStorage } from '../interfaces/index.ts';
import { readMinioConfig } from '../../config/minio/minio.env.ts';

const options = {
  endpoint: 'localhost',
  port: 9000,
  accessKey: 'access',
  secretKey: 'secret',
  bucket: 'files',
};

@Injectable()
class ConsumerA {
  constructor(@Inject(MINIO_STORAGE) readonly storage: IMinioStorage) {}
}
@Injectable()
class ConsumerB {
  constructor(@Inject(MINIO_STORAGE) readonly storage: IMinioStorage) {}
}
@Module({ providers: [ConsumerA] })
class FeatureA {}
@Module({ providers: [ConsumerB] })
class FeatureB {}

describe('Minio storage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.delay.mockResolvedValue(undefined);
    vi.stubGlobal('fetch', mocks.fetch);
    mocks.fetch.mockResolvedValue({ ok: true });
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  it('retries five times with Redis backoff and propagates the last error', async () => {
    const error = new Error('unavailable');
    mocks.fetch.mockRejectedValue(error);
    await expect(
      new MinioConnectionService(options).onModuleInit(),
    ).rejects.toBe(error);
    expect(mocks.fetch).toHaveBeenCalledTimes(5);
    expect(mocks.bucketExists).not.toHaveBeenCalled();
    expect(mocks.delay.mock.calls.map(([ms]) => ms)).toEqual([
      1000, 2000, 4000, 8000,
    ]);
  });

  it('creates a missing bucket after a failed attempt', async () => {
    mocks.fetch
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce({ ok: true });
    mocks.bucketExists.mockResolvedValue(false);
    mocks.makeBucket.mockResolvedValue(undefined);
    await new MinioConnectionService(options).onModuleInit();
    expect(mocks.makeBucket).toHaveBeenCalledWith('files', 'us-east-1');
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.bucketExists).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.bucketExists.mock.invocationCallOrder[0],
    );
  });

  it('does not retry bucket errors after connecting', async () => {
    const error = new Error('bucket denied');
    mocks.bucketExists.mockRejectedValue(error);
    await expect(
      new MinioConnectionService(options).onModuleInit(),
    ).rejects.toBe(error);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.bucketExists).toHaveBeenCalledTimes(1);
    expect(mocks.delay).not.toHaveBeenCalled();
  });

  it('does not retry a failed bucket creation', async () => {
    const error = new Error('creation denied');
    mocks.bucketExists.mockResolvedValue(false);
    mocks.makeBucket.mockRejectedValue(error);
    await expect(
      new MinioConnectionService(options).onModuleInit(),
    ).rejects.toBe(error);
    expect(mocks.makeBucket).toHaveBeenCalledTimes(1);
    expect(mocks.delay).not.toHaveBeenCalled();
  });

  it('exposes the same injectable interface with both module factories', async () => {
    for (const module of [
      MinioModule.forRoot(options),
      MinioModule.forRootAsync({ useFactory: async () => options }),
    ]) {
      const testingModule = await Test.createTestingModule({
        imports: [module],
      }).compile();
      expect(testingModule.get<IMinioStorage>(MINIO_STORAGE)).toBeInstanceOf(
        MinioStorageService,
      );
      await testingModule.close();
    }
  });

  it('shares one globally available storage service and initializes once', async () => {
    mocks.bucketExists.mockResolvedValue(false);
    mocks.makeBucket.mockResolvedValue(undefined);
    const module = await Test.createTestingModule({
      imports: [MinioModule.forRoot(options), FeatureA, FeatureB],
    }).compile();
    await module.init();
    expect(module.get(ConsumerA).storage).toBe(module.get(ConsumerB).storage);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.bucketExists).toHaveBeenCalledTimes(1);
    expect(mocks.makeBucket).toHaveBeenCalledTimes(1);
    await module.close();
  });

  it('downloads to a local path and deletes by the object key', async () => {
    const service = new MinioStorageService(
      new MinioConnectionService(options),
    );
    mocks.fGetObject.mockResolvedValue(undefined);
    mocks.removeObject.mockResolvedValue(undefined);
    await service.downloadToFile('images/photo.jpg', '/tmp/photo.jpg');
    await service.removeObject('images/photo.jpg');
    expect(mocks.fGetObject).toHaveBeenCalledWith(
      'files',
      'images/photo.jpg',
      '/tmp/photo.jpg',
    );
    expect(mocks.removeObject).toHaveBeenCalledWith(
      'files',
      'images/photo.jpg',
    );
    const error = new Error('download failed');
    mocks.fGetObject.mockRejectedValueOnce(error);
    await expect(
      service.downloadToFile('images/photo.jpg', '/tmp/photo.jpg'),
    ).rejects.toBe(error);
  });

  it('reads object metadata and only treats missing objects as absent', async () => {
    const service = new MinioStorageService(
      new MinioConnectionService(options),
    );
    mocks.statObject.mockResolvedValueOnce({
      size: 12,
      etag: 'tag',
      metaData: { 'x-amz-meta-sha256': 'hash' },
    });
    expect(await service.getObjectInfo('key')).toEqual({
      objectKey: 'key',
      size: 12,
      etag: 'tag',
      sha256: 'hash',
    });
    mocks.statObject.mockRejectedValueOnce({ code: 'NoSuchKey' });
    expect(await service.objectExists('missing')).toBe(false);
    const error = new Error('denied');
    mocks.statObject.mockRejectedValueOnce(error);
    await expect(service.getObjectInfo('key')).rejects.toBe(error);
  });
});

describe('Minio environment', () => {
  const env = {
    MINIO_ENDPOINT: 'localhost',
    MINIO_PORT: '9000',
    MINIO_ACCESS_KEY: 'access',
    MINIO_SECRET_KEY: 'secret',
    MINIO_BUCKET: 'files',
    MINIO_USE_SSL: 'false',
  };
  it('parses SSL explicitly and validates required settings', () => {
    expect(readMinioConfig(env)).toEqual({ ...options, useSsl: false });
    expect(readMinioConfig({ ...env, MINIO_USE_SSL: 'true' }).useSsl).toBe(
      true,
    );
    expect(() => readMinioConfig({ ...env, MINIO_PORT: '0' })).toThrow(
      'MINIO_PORT',
    );
    expect(() => readMinioConfig({ ...env, MINIO_BUCKET: '' })).toThrow(
      'MINIO_BUCKET',
    );
    expect(() => readMinioConfig({ ...env, MINIO_USE_SSL: 'no' })).toThrow(
      'MINIO_USE_SSL',
    );
  });
});
