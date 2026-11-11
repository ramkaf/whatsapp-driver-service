import { Inject, Injectable, Logger } from '@nestjs/common';
import type { WAMessage } from '@whiskeysockets/baileys';
import { INBOX_REPOSITORY, type IInboxRepository } from '@libs/prisma';
import type { Prisma } from '@database/client.js';
import { MediaDetectorUtil } from '../utils/media-detactor.utils.ts';
import {
  WhatsappMessageInboxStatus,
  WhatsappMessageMediaStatus,
} from '@database/enums.js';
import { generateMessageFingerprint } from '../utils/inbox.util.ts';

@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);
  constructor(
    @Inject(INBOX_REPOSITORY)
    private readonly inboxRepository: IInboxRepository,
  ) {}

  async handle(message: WAMessage, sessionId: string): Promise<void> {
    try {
      const hasMedia = MediaDetectorUtil.hasMedia(message);
      const remoteJid = message.key.remoteJid;
      const messageId = message.key.id;
      const fromMe = message.key.fromMe;
      const phone = message.key.participantAlt;
      const messageText = message.message?.conversation ?? 'unknown';

      if (!remoteJid || !messageId || fromMe) return;

      const key = generateMessageFingerprint(remoteJid, messageId);
      const payload = JSON.parse(
        JSON.stringify(message),
      ) as Prisma.InputJsonValue;
      // await this.inboxRepository.createMany({
      //   data: [
      //     {
      //       key,
      //       payload,
      //       haveMedia: hasMedia,
      //       mediaStatus: hasMedia
      //         ? WhatsappMessageMediaStatus.PENDING
      //         : WhatsappMessageMediaStatus.NOT_REQUIRED,
      //       status: hasMedia
      //         ? WhatsappMessageInboxStatus.RECEIVED
      //         : WhatsappMessageInboxStatus.READY,
      //       sessionId,
      //       willBeDeleteColumn: `${phone}`
      //     },
      //   ],
      //   skipDuplicates: true,
      // });
      await this.inboxRepository.upsert({
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
          temp: `${phone}:${messageText}`,
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
