import { Inject, Injectable } from '@nestjs/common';
import type { ConnectionMessageEvent } from '../../../connection/interfaces/message-event-source.ts';
import { MessageEventHandler } from '../interfaces/message-event-handler.ts';
import { MessageEventOutput } from '../interfaces/message-event-output.ts';
import { MessageMediaService } from '../providers/message-media.service.ts';

/** Handles edits, delivery status changes and other message updates. */
@Injectable()
export class MessagesUpdateEventHandler extends MessageEventHandler<'messages.update'> {
  readonly event = 'messages.update' as const;

  constructor(
    @Inject(MessageEventOutput) private readonly output: MessageEventOutput,
    private readonly media: MessageMediaService,
  ) {
    super();
  }

  async handle(
    event: ConnectionMessageEvent<'messages.update'>,
  ): Promise<void> {
    for (const update of event.data) {
      const attachment = update.update.message
        ? await this.media.store(event.sessionId, {
            ...update.update,
            key: update.key,
          })
        : {};
      await this.output.write({ ...event, ...attachment, data: update });
    }
  }
}
