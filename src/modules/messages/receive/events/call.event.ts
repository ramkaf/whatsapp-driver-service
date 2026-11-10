import { Injectable } from '@nestjs/common';
import type { ConnectionMessageEvent } from '../../../connection/interfaces/message-event-source.ts';
import { MessageEventHandler } from '../interfaces/message-event-handler.ts';

@Injectable()
export class CallEventHandler extends MessageEventHandler<'call'> {
  readonly event = 'call' as const;

  async handle(_event: ConnectionMessageEvent<'call'>): Promise<void> {
    // TODO: Handle incoming call status notifications.
  }
}
