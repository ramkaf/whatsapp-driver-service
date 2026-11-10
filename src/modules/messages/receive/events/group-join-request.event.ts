import { Injectable } from '@nestjs/common';
import type { ConnectionMessageEvent } from '../../../connection/interfaces/message-event-source.ts';
import { MessageEventHandler } from '../interfaces/message-event-handler.ts';

@Injectable()
export class GroupJoinRequestEventHandler extends MessageEventHandler<'group.join-request'> {
  readonly event = 'group.join-request' as const;

  async handle(
    _event: ConnectionMessageEvent<'group.join-request'>,
  ): Promise<void> {
    // TODO: Handle group membership requests.
  }
}
