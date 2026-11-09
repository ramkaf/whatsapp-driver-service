import { Inject, Injectable } from '@nestjs/common';
import type { ConnectionMessageEvent } from '../../../connection/interfaces/message-event-source.ts';
import { MessageEventHandler } from '../interfaces/message-event-handler.ts';
import { MessageEventOutput } from '../interfaces/message-event-output.ts';

/** Handles per-user delivery, read and played receipts. */
@Injectable()
export class MessageReceiptUpdateEventHandler extends MessageEventHandler<'message-receipt.update'> {
  readonly event = 'message-receipt.update' as const;

  constructor(
    @Inject(MessageEventOutput) private readonly output: MessageEventOutput,
  ) {
    super();
  }

  async handle(
    event: ConnectionMessageEvent<'message-receipt.update'>,
  ): Promise<void> {
    for (const receipt of event.data)
      await this.output.write({ ...event, data: receipt });
  }
}
