import { Inject, Injectable } from '@nestjs/common';
import type { ConnectionMessageEvent } from '../../../connection/interfaces/message-event-source.ts';
import { MessageEventHandler } from '../interfaces/message-event-handler.ts';
import { MessageEventOutput } from '../interfaces/message-event-output.ts';

/** Handles history-sync completion and pause notifications. */
@Injectable()
export class MessagingHistoryStatusEventHandler extends MessageEventHandler<'messaging-history.status'> {
  readonly event = 'messaging-history.status' as const;

  constructor(
    @Inject(MessageEventOutput) private readonly output: MessageEventOutput,
  ) {
    super();
  }

  async handle(
    event: ConnectionMessageEvent<'messaging-history.status'>,
  ): Promise<void> {
    await this.output.write(event);
  }
}
