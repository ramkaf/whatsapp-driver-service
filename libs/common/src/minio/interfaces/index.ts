import type { Readable } from 'node:stream';

export const MINIO_STORAGE = Symbol('MINIO_STORAGE');

export interface MinioObjectInfo {
  objectKey: string;
  size: number;
  etag: string;
  sha256?: string;
}

export interface StoredMinioObject {
  bucket: string;
  objectKey: string;
  etag: string;
  url: string;
  urlExpiresAt: string;
}

export interface IMinioStorage {
  readonly bucket: string;
  uploadStream(
    objectKey: string,
    stream: Readable,
    size: number,
    mimeType: string,
    sha256: string,
  ): Promise<StoredMinioObject>;
  getExistingObject(
    objectKey: string,
    expectedSize: number,
    expectedSha256: string,
  ): Promise<StoredMinioObject | null>;
  getObjectInfo(objectKey: string): Promise<MinioObjectInfo | null>;
  objectExists(objectKey: string): Promise<boolean>;
  getStoredObject(objectKey: string, etag: string): Promise<StoredMinioObject>;
  getObject(objectKey: string): Promise<Readable>;
  downloadToFile(objectKey: string, filePath: string): Promise<void>;
  removeObject(objectKey: string): Promise<void>;
}
