import { Inject, Injectable, Logger } from '@nestjs/common';
import type { WAMessage } from '@whiskeysockets/baileys';
import { ConnectionMessageSource } from '../../../connection/interfaces/message-event-source.ts';
import { MediaService } from '../../../media/providers/media.service.ts';
import type { ReceivedMessageEvent } from '../interfaces/message-event-output.ts';

/** Stores an attachment before its message is written to the receiving output. */
@Injectable()
export class MessageMediaService {
  private readonly logger = new Logger(MessageMediaService.name);

  constructor(
    @Inject(ConnectionMessageSource)
    private readonly source: ConnectionMessageSource,
    private readonly media: MediaService,
  ) {}

  async store(
    sessionId: string,
    message: WAMessage,
  ): Promise<Pick<ReceivedMessageEvent, 'media' | 'mediaError'>> {
    if (!this.media.hasMedia(message)) return {};
    try {
      const context = this.source.getMediaDownloadContext(sessionId);
      if (!context) throw new Error('Session media connection is unavailable');
      const media = await this.media.save(context, message);
      return media ? { media } : {};
    } catch {
      this.logger.error({
        sessionId,
        messageId: message.key.id,
        reason: 'media_storage_failed',
      });
      // Preserve the message even when its attachment could not be stored.
      return { mediaError: 'MEDIA_STORAGE_FAILED' };
    }
  }
}
