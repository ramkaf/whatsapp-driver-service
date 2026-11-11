import { Inject, Injectable } from '@nestjs/common';
import type { ConnectionMessageEvent } from '../../../connection/interfaces/message-event-source.ts';
import { MessageEventHandler } from '../interfaces/message-event-handler.ts';
import { InboxService } from '../../../inbox/providers/inbox.service.ts';

/** Handles per-user delivery, read and played receipts. */
@Injectable()
export class MessageReceiptUpdateEventHandler extends MessageEventHandler<'message-receipt.update'> {
  readonly event = 'message-receipt.update' as const;

  constructor(
    @Inject(InboxService) private readonly inboxService: InboxService,
  ) {
    super();
  }

  async handle(
    event: ConnectionMessageEvent<'message-receipt.update'>,
  ): Promise<void> {}
}
