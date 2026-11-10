import { Injectable } from '@nestjs/common';
import type { ConnectionMessageEvent } from '../../../connection/interfaces/message-event-source.ts';
import { MessageEventHandler } from '../interfaces/message-event-handler.ts';

@Injectable()
export class BlocklistUpdateEventHandler extends MessageEventHandler<'blocklist.update'> {
  readonly event = 'blocklist.update' as const;

  async handle(
    _event: ConnectionMessageEvent<'blocklist.update'>,
  ): Promise<void> {
    // TODO: Apply additions and removals to the blocked-contact list.
  }
}
