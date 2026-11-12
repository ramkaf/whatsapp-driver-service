import { Injectable, Logger } from '@nestjs/common';
import type { Readable } from 'node:stream';

import type {
  MinioObjectInfo,
  StoredMinioObject,
} from '../interfaces/index.ts';
import { MinioConnectionService } from './minio-connection.service.ts';
import type { IMinioStorage } from '../interfaces/index.ts';

const DOWNLOAD_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

@Injectable()
export class MinioStorageService implements IMinioStorage {
  private readonly logger = new Logger(MinioStorageService.name);

  constructor(private readonly connection: MinioConnectionService) {}

  get bucket(): string {
    return this.connection.bucket;
  }

  private get client() {
    return this.connection.client;
  }

  /**
   * Uploads a stream with known size and SHA-256 metadata.
   */
  async uploadStream(
    objectKey: string,
    stream: Readable,
    size: number,
    mimeType: string,
    sha256: string,
  ): Promise<StoredMinioObject> {
    const result = await this.client.putObject(
      this.bucket,
      objectKey,
      stream,
      size,
      {
        'Content-Type': mimeType,
        'x-amz-meta-sha256': sha256,
      },
    );

    return this.getStoredObject(objectKey, result.etag);
  }

  /**
   * Checks an existing object using its deterministic key.
   */
  async getExistingObject(
    objectKey: string,
    expectedSize: number,
    expectedSha256: string,
  ): Promise<StoredMinioObject | null> {
    const current = await this.getObjectInfo(objectKey);
    if (!current) {
      return null;
    }
    // Same content already exists.
    if (current.size === expectedSize && current.sha256 === expectedSha256) {
      return this.getStoredObject(current.objectKey, current.etag);
    }
    // Existing object is not a valid match.
    this.logger.warn({
      message: 'Existing object failed integrity check',
      objectKey,
      expectedSize,
      actualSize: current.size,
    });

    return null;
  }

  /**
   * Retrieves object information from MinIO.
   */
  async getObjectInfo(objectKey: string): Promise<MinioObjectInfo | null> {
    try {
      const info = await this.client.statObject(this.bucket, objectKey);

      const metadata =
        (
          info as typeof info & {
            metaData?: Record<string, string>;
          }
        ).metaData ?? {};

      const sha256 = Object.entries(metadata).find(([key]) =>
        ['x-amz-meta-sha256', 'sha256'].includes(key.toLowerCase()),
      )?.[1];

      return {
        objectKey,
        size: info.size,
        etag: info.etag,
        sha256,
      };
    } catch (error) {
      if (this.isNotFoundError(error)) {
        return null;
      }

      throw error;
    }
  }

  async objectExists(objectKey: string): Promise<boolean> {
    return (await this.getObjectInfo(objectKey)) !== null;
  }

  /**
   * Generates a temporary download URL.
   */
  async getStoredObject(
    objectKey: string,
    etag: string,
  ): Promise<StoredMinioObject> {
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

  getObject(objectKey: string): Promise<Readable> {
    return this.client.getObject(this.bucket, objectKey);
  }

  downloadToFile(objectKey: string, filePath: string): Promise<void> {
    return this.client.fGetObject(this.bucket, objectKey, filePath);
  }

  removeObject(objectKey: string): Promise<void> {
    return this.client.removeObject(this.bucket, objectKey);
  }

  private isNotFoundError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const candidate = error as {
      code?: string;
      statusCode?: number;
    };

    return (
      candidate.statusCode === 404 ||
      candidate.code === 'NoSuchKey' ||
      candidate.code === 'NoSuchObject' ||
      candidate.code === 'NotFound'
    );
  }
}
