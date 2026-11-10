import { extractMessageContent } from '@whiskeysockets/baileys';

import type { WAMessage, WAMessageContent } from '@whiskeysockets/baileys';

import type {
  MediaDescriptor,
  MediaType,
} from '../interfaces/media.interface.ts';

import { EXTENSIONS } from '../constants/media.constant.ts';

export function getMessageMediaDescriptor(
  message: WAMessage,
): MediaDescriptor | null {
  if (!message.key.remoteJid || !message.key.id || !message.message) {
    return null;
  }

  const content = extractMessageContent(message.message);

  return content ? getMediaDescriptor(content) : null;
}

function getMediaDescriptor(content: WAMessageContent): MediaDescriptor | null {
  if (content.imageMessage) {
    return createMediaDescriptor(
      'image',
      content.imageMessage.mimetype || 'image/jpeg',
    );
  }

  const video = content.videoMessage || content.ptvMessage;

  if (video) {
    return createMediaDescriptor('video', video.mimetype || 'video/mp4');
  }

  if (content.audioMessage) {
    return createMediaDescriptor(
      content.audioMessage.ptt ? 'voice' : 'audio',
      content.audioMessage.mimetype || 'audio/ogg',
    );
  }

  if (content.documentMessage) {
    return createMediaDescriptor(
      'document',
      content.documentMessage.mimetype || 'application/octet-stream',
      content.documentMessage.fileName || null,
    );
  }

  if (content.stickerMessage) {
    return createMediaDescriptor(
      'sticker',
      content.stickerMessage.mimetype || 'image/webp',
    );
  }

  return null;
}

function createMediaDescriptor(
  type: MediaType,
  mimeType: string,
  originalFileName: string | null = null,
): MediaDescriptor {
  const normalizedMime = mimeType.split(';')[0].trim().toLowerCase();

  const originalExtension = originalFileName
    ?.match(/\.([a-zA-Z0-9]{1,10})$/)?.[0]
    ?.toLowerCase();

  return {
    type,
    mimeType: normalizedMime,
    extension: originalExtension || EXTENSIONS[normalizedMime] || '.bin',
    originalFileName,
  };
}
