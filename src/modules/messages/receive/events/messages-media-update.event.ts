import { Inject, Injectable } from '@nestjs/common';
import type { ConnectionMessageEvent } from '../../../connection/interfaces/message-event-source.ts';
import { MessageEventHandler } from '../interfaces/message-event-handler.ts';
import { MessageEventOutput } from '../interfaces/message-event-output.ts';

/** Handles availability notifications, which do not contain a downloadable message. */
@Injectable()
export class MessagesMediaUpdateEventHandler extends MessageEventHandler<'messages.media-update'> {
  readonly event = 'messages.media-update' as const;

  constructor(
    @Inject(MessageEventOutput) private readonly output: MessageEventOutput,
  ) {
    super();
  }

  async handle(
    event: ConnectionMessageEvent<'messages.media-update'>,
  ): Promise<void> {
    for (const update of event.data)
      await this.output.write({ ...event, data: update });
  }
}
