import { Inject, Injectable } from '@nestjs/common';
import type { ConnectionMessageEvent } from '../../../connection/interfaces/message-event-source.ts';
import { MessageEventHandler } from '../interfaces/message-event-handler.ts';
import { InboxService } from '../../../inbox/providers/inbox.service.ts';

/** Handles edits, delivery status changes and other message updates. */
@Injectable()
export class MessagesUpdateEventHandler extends MessageEventHandler<'messages.update'> {
  readonly event = 'messages.update' as const;

  constructor(
    @Inject(InboxService) private readonly inboxService: InboxService,
  ) {
    super();
  }

  async handle(
    event: ConnectionMessageEvent<'messages.update'>,
  ): Promise<void> {
    for (const update of event.data) {
    }
  }
}
