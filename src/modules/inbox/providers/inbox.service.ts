import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ReceivedMessageEvent } from '../../messages/receive/interfaces/message-event-output.ts';
import { WAMessage } from '@whiskeysockets/baileys';
import { PrismaService } from '@libs/common/prisma/index.js';
import { Prisma } from '@libs/common/prisma/src/index.js';
import { MediaDetectorUtil } from '../utils/media-detactor.utils.ts';
import {
  WhatsappMessageInboxStatus,
  WhatsappMessageMediaStatus,
} from '@libs/common/prisma/src/generated/enums.js';
import { generateMessageFingerprint } from '../utils/inbox.util.ts';

@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async handle(message: WAMessage, sessionId: string): Promise<void> {
    this.logger.log({ event: 'inbox_message_received', message });
    try {
      const hasMedia = MediaDetectorUtil.hasMedia(message);
      const remoteJid = message.key.remoteJid;
      const messageId = message.key.id;
      const fromMe = message.key.fromMe;

      if (!remoteJid || !messageId || fromMe) return;

      const key = generateMessageFingerprint(remoteJid, messageId);
      const payload = JSON.parse(
        JSON.stringify(message),
      ) as Prisma.InputJsonValue;
      await this.prisma.whatsappMessageInbox.upsert({
        where: { key },
        create: {
          key,
          payload,
          haveMedia: hasMedia,
          mediaStatus: hasMedia
            ? WhatsappMessageMediaStatus.PENDING
            : WhatsappMessageMediaStatus.NOT_REQUIRED,

          status: hasMedia
            ? WhatsappMessageInboxStatus.RECEIVED
            : WhatsappMessageInboxStatus.READY,
          sessionId,
        },
        update: {},
      });
    } catch (error) {
      this.logger.error(
        'Failed to save incoming WhatsApp message',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
