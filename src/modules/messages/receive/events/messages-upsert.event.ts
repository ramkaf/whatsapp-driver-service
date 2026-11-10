import { Inject, Injectable } from '@nestjs/common';
import type { ConnectionMessageEvent } from '../../../connection/interfaces/message-event-source.ts';
import { MessageEventHandler } from '../interfaces/message-event-handler.ts';
import { InboxService } from '../../../inbox/providers/inbox.service.ts';
import { JsonlUtil } from '../../../../utils/jsonl.util.ts';

/** Persists incoming messages; attachments are processed by the inbox worker. */
@Injectable()
export class MessagesUpsertEventHandler extends MessageEventHandler<'messages.upsert'> {
  readonly event = 'messages.upsert' as const;

  constructor(
    @Inject(InboxService) private readonly inboxService: InboxService,
  ) {
    super();
  }

  async handle(
    event: ConnectionMessageEvent<'messages.upsert'>,
  ): Promise<void> {
    await JsonlUtil.append('a', event);
    for (const message of event.data.messages) {
      await this.inboxService.handle(message, event.sessionId);
    }
  }
}
