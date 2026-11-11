import type { WASocket } from '@whiskeysockets/baileys';

export interface MediaDescriptor {
  type: MediaType;
  mimeType: string;
  extension: string;
  originalFileName: string | null;
}
export interface MinioObjectInfo {
  objectKey: string;
  size: number;
  etag: string;
}

export interface StoredMinioObject {
  bucket: string;
  objectKey: string;
  etag: string;
  /** Presigned URL for reading this object from a private bucket. */
  url: string;
  /** ISO timestamp when the presigned URL expires. */
  urlExpiresAt: string;
}

export interface StoredWhatsappMedia extends StoredMinioObject {
  chatId: string;
  messageId: string;
  type: MediaType;
  mimeType: string;
  originalFileName: string | null;
}
export type MediaType =
  'image' | 'video' | 'audio' | 'voice' | 'document' | 'sticker';

export interface MediaDescriptor {
  type: MediaType;
  mimeType: string;
  extension: string;
  originalFileName: string | null;
}

export interface PreparedMedia {
  media: MediaDescriptor;
  chatId: string;
  messageId: string;
}

export interface TemporaryMediaFile {
  directory: string;
  filePath: string;
  size: number;
  sha256: string;
}

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

export interface StoredWhatsappMedia extends StoredMinioObject {
  chatId: string;
  messageId: string;
  type: MediaType;
  mimeType: string;
  originalFileName: string | null;
  sha256: string;
}
export type WhatsappMediaSocket = Pick<WASocket, 'updateMediaMessage'>;
