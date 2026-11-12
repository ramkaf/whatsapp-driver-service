import { Inject, Injectable } from '@nestjs/common';
import { INBOX_REPOSITORY, type IInboxRepository } from '@libs/prisma';
import {
  WhatsappMessageInboxStatus,
  WhatsappMessageMediaStatus,
} from '@database/enums.js';
import type { InboxEntry } from '../interfaces/inbox-entry.ts';

@Injectable()
export class InboxService {
  constructor(
    @Inject(INBOX_REPOSITORY)
    private readonly inboxRepository: IInboxRepository,
  ) {}

  async handle(entry: InboxEntry): Promise<void> {
    // Atomic duplicate suppression under simultaneous deliveries. Existing
    // rows, their original session and processing state are never overwritten.
    await this.inboxRepository.createMany({
      data: [
        {
          key: entry.key,
          event: entry.event,
          sessionId: entry.sessionId,
          payload: entry.payload,
          ...(entry.reformPayload !== undefined
            ? { reformPayload: entry.reformPayload }
            : {}),
          haveMedia: entry.haveMedia,
          mediaStatus: entry.haveMedia
            ? WhatsappMessageMediaStatus.PENDING
            : WhatsappMessageMediaStatus.NOT_REQUIRED,
          status: entry.haveMedia
            ? WhatsappMessageInboxStatus.RECEIVED
            : WhatsappMessageInboxStatus.READY,
        },
      ],
      skipDuplicates: true,
    });
  }
}
