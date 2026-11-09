import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { configuer } from '@libs/common';
import type { IAppConfig } from '@libs/common';

import * as Minio from 'minio';
import type { Readable } from 'node:stream';
import type {
  MinioObjectInfo,
  StoredMinioObject,
} from '../interfaces/media.interface.ts';
import { safeId } from '../../../utils/message.utils.ts';

const DOWNLOAD_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

@Injectable()
export class MinioStorageService implements OnModuleInit {
  private readonly logger = new Logger(MinioStorageService.name);

  private readonly client: Minio.Client;

  readonly bucket: string;

  constructor(@Inject(configuer.KEY) config: IAppConfig) {
    const { endpoint, port, useSsl, accessKey, secretKey, bucket } =
      config.minio;

    this.bucket = bucket;
    this.client = new Minio.Client({
      endPoint: endpoint,
      port,
      useSSL: useSsl,
      accessKey,
      secretKey,
    });
  }

  async onModuleInit(): Promise<void> {
    const exists = await this.client.bucketExists(this.bucket);

    if (!exists) {
      await this.client.makeBucket(this.bucket, 'us-east-1');
    }

    this.logger.log(`MinIO ready: ${this.bucket}`);
  }

  /** Lists the requested prefix lazily so callers can stop on the first match. */
  async *listObjects(prefix: string): AsyncGenerator<MinioObjectInfo> {
    const stream = this.client.listObjectsV2(this.bucket, prefix, true);
    try {
      for await (const object of stream as AsyncIterable<Minio.BucketItem>) {
        if (object.name === undefined) continue;
        yield {
          objectKey: object.name,
          size: object.size,
          etag: object.etag,
        };
      }
    } finally {
      stream.destroy();
    }
  }

  /** Rechecks object metadata instead of relying on an earlier listing snapshot. */
  async getObjectInfo(objectKey: string): Promise<MinioObjectInfo | null> {
    try {
      const info = await this.client.statObject(this.bucket, objectKey);
      return { objectKey, size: info.size, etag: info.etag };
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error.code === 'NoSuchKey' || error.code === 'NotFound')
      ) {
        return null;
      }
      throw error;
    }
  }

  // Checks whether an object exists while propagating storage access failures.
  async objectExists(objectKey: string): Promise<boolean> {
    return (await this.getObjectInfo(objectKey)) !== null;
  }

  async uploadStream(
    objectKey: string,
    stream: Readable,
    mimeType: string,
  ): Promise<StoredMinioObject> {
    const result = await this.client.putObject(
      this.bucket,
      objectKey,
      stream,
      undefined,
      {
        'Content-Type': mimeType,
      },
    );

    return this.getStoredObject(objectKey, result.etag);
  }

  /** Refreshes a stored object's download URL without uploading its bytes again. */
  async getStoredObject(
    objectKey: string,
    etag: string,
  ): Promise<StoredMinioObject> {
    // S3 signatures use second precision; use the same instant for expiry metadata.
    const signedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
    const url = await this.client.presignedGetObject(
      this.bucket,
      objectKey,
      DOWNLOAD_URL_TTL_SECONDS,
      {},
      signedAt,
    );

    return {
      bucket: this.bucket,
      objectKey,
      etag,
      url,
      urlExpiresAt: new Date(
        signedAt.getTime() + DOWNLOAD_URL_TTL_SECONDS * 1000,
      ).toISOString(),
    };
  }

  async exists(
    conversationId: string,
    messageId: string,
    size: number,
  ): Promise<StoredMinioObject | null> {
    const prefix = `conversations/${safeId(conversationId)}/`;
    const expectedMessageId = safeId(messageId);
    for await (const candidate of this.listObjects(prefix)) {
      if (!candidate.objectKey.startsWith(prefix) || candidate.size !== size)
        continue;
      const filename = candidate.objectKey.slice(prefix.length);
      if (filename.includes('/')) continue;
      // Filenames are date_uuid_messageId.ext; compare the full message ID.
      const storedMessageId = filename.match(/^[^_]+_[^_]+_(.+)\.[^.]+$/)?.[1];
      if (storedMessageId !== expectedMessageId) continue;
      // Confirm the object still exists and its current size agrees with listing.
      const current = await this.getObjectInfo(candidate.objectKey);
      if (!current || current.size !== size) continue;
      return this.getStoredObject(current.objectKey, current.etag);
    }
    return null;
  }
}
