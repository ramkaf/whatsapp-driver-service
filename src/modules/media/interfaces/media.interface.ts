import type { WASocket } from '@whiskeysockets/baileys';

/** The only socket capability required to refresh expired media URLs. */
export type WhatsappMediaSocket = Pick<WASocket, 'updateMediaMessage'>;

export type MediaType =
  'image' | 'video' | 'voice' | 'audio' | 'document' | 'sticker';
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
  senderId: string;
  messageId: string;
  type: MediaType;
  mimeType: string;
  originalFileName: string | null;
}
