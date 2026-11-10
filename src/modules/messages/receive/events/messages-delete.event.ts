import { Inject, Injectable } from '@nestjs/common';
import type { ConnectionMessageEvent } from '../../../connection/interfaces/message-event-source.ts';
import { MessageEventHandler } from '../interfaces/message-event-handler.ts';
import { InboxService } from '../../../inbox/providers/inbox.service.ts';

/** Handles individual deletions and whole-chat message deletion events. */
@Injectable()
export class MessagesDeleteEventHandler extends MessageEventHandler<'messages.delete'> {
  readonly event = 'messages.delete' as const;

  constructor(
    @Inject(InboxService)
    private readonly inboxService: InboxService,
  ) {
    super();
  }

  async handle(
    event: ConnectionMessageEvent<'messages.delete'>,
  ): Promise<void> {

  }
}
