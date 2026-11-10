import { Inject, Injectable } from '@nestjs/common';
import type { ConnectionMessageEvent } from '../../../connection/interfaces/message-event-source.ts';
import { MessageEventHandler } from '../interfaces/message-event-handler.ts';
import { InboxService } from '../../../inbox/providers/inbox.service.ts';

/** Handles reactions and reaction removal, preserving the target message key. */
@Injectable()
export class MessagesReactionEventHandler extends MessageEventHandler<'messages.reaction'> {
  readonly event = 'messages.reaction' as const;

  constructor(
    @Inject(InboxService)
    private readonly inboxService: InboxService,
  ) {
    super();
  }

  async handle(
    event: ConnectionMessageEvent<'messages.reaction'>,
  ): Promise<void> {
    for (const reaction of event.data){
      
  }
}
}