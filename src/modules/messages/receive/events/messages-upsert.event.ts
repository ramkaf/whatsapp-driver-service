import { Inject, Injectable } from '@nestjs/common';
import type { ConnectionMessageEvent } from '../../../connection/interfaces/message-event-source.ts';
import { MessageEventHandler } from '../interfaces/message-event-handler.ts';
import { MessageEventOutput } from '../interfaces/message-event-output.ts';
import { MessageMediaService } from '../providers/message-media.service.ts';

/** Logs every message in a batch, including offline append and own-message echoes. */
@Injectable()
export class MessagesUpsertEventHandler extends MessageEventHandler<'messages.upsert'> {
  readonly event = 'messages.upsert' as const;

  constructor(
    @Inject(MessageEventOutput) private readonly output: MessageEventOutput,
    private readonly media: MessageMediaService,
  ) {
    super();
  }

  async handle(
    event: ConnectionMessageEvent<'messages.upsert'>,
  ): Promise<void> {
    for (const message of event.data.messages) {
      const attachment = await this.media.store(event.sessionId, message);
      await this.output.write({
        ...event,
        ...attachment,
        data: {
          type: event.data.type,
          requestId: event.data.requestId,
          message,
        },
      });
    }
  }
}
