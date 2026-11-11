import { Inject, Injectable } from '@nestjs/common';
import type { ConnectionMessageEvent } from '../../../connection/interfaces/message-event-source.ts';
import { MessageEventHandler } from '../interfaces/message-event-handler.ts';
import { InboxService } from '../../../inbox/providers/inbox.service.ts';

/** Handles history-sync completion and pause notifications. */
@Injectable()
export class MessagingHistoryStatusEventHandler extends MessageEventHandler<'messaging-history.status'> {
  readonly event = 'messaging-history.status' as const;

  constructor(
    @Inject(InboxService) private readonly inboxService: InboxService,
  ) {
    super();
  }
  async handle(
    event: ConnectionMessageEvent<'messaging-history.status'>,
  ): Promise<void> {}
}
