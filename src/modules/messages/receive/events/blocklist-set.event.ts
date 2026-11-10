import { Injectable } from '@nestjs/common';
import type { ConnectionMessageEvent } from '../../../connection/interfaces/message-event-source.ts';
import { MessageEventHandler } from '../interfaces/message-event-handler.ts';

@Injectable()
export class BlocklistSetEventHandler extends MessageEventHandler<'blocklist.set'> {
  readonly event = 'blocklist.set' as const;

  async handle(_event: ConnectionMessageEvent<'blocklist.set'>): Promise<void> {
    // TODO: Synchronize the initial blocked-contact list.
  }
}
