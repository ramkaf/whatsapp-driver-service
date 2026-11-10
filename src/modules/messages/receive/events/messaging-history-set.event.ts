import { Inject, Injectable } from '@nestjs/common';
import type { ConnectionMessageEvent } from '../../../connection/interfaces/message-event-source.ts';
import { MessageEventHandler } from '../interfaces/message-event-handler.ts';
import { InboxService } from '../../../inbox/providers/inbox.service.ts';

/** Handles each historical message without logging unrelated contact or chat snapshots. */
@Injectable()
export class MessagingHistorySetEventHandler extends MessageEventHandler<'messaging-history.set'> {
  readonly event = 'messaging-history.set' as const;

  constructor(
    @Inject(InboxService) private readonly inboxService: InboxService,
  ) {
    super();
  }

  async handle(
    event: ConnectionMessageEvent<'messaging-history.set'>,
  ): Promise<void> {
    for (const message of event.data.messages) {
      await this.inboxService.handle(message, event.sessionId);
    }
  }
}
