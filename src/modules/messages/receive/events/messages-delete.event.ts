import { Inject, Injectable } from '@nestjs/common';
import type { ConnectionMessageEvent } from '../../../connection/interfaces/message-event-source.ts';
import { MessageEventHandler } from '../interfaces/message-event-handler.ts';
import { MessageEventOutput } from '../interfaces/message-event-output.ts';

/** Handles individual deletions and whole-chat message deletion events. */
@Injectable()
export class MessagesDeleteEventHandler extends MessageEventHandler<'messages.delete'> {
  readonly event = 'messages.delete' as const;

  constructor(
    @Inject(MessageEventOutput) private readonly output: MessageEventOutput,
  ) {
    super();
  }

  async handle(
    event: ConnectionMessageEvent<'messages.delete'>,
  ): Promise<void> {
    if ('keys' in event.data) {
      for (const key of event.data.keys)
        await this.output.write({ ...event, data: { key } });
    } else await this.output.write(event);
  }
}
