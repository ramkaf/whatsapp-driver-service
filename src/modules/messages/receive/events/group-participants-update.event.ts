import { Injectable } from '@nestjs/common';
import type { ConnectionMessageEvent } from '../../../connection/interfaces/message-event-source.ts';
import { MessageEventHandler } from '../interfaces/message-event-handler.ts';

@Injectable()
export class GroupParticipantsUpdateEventHandler extends MessageEventHandler<'group-participants.update'> {
  readonly event = 'group-participants.update' as const;

  async handle(
    _event: ConnectionMessageEvent<'group-participants.update'>,
  ): Promise<void> {
    // TODO: Handle member additions, removals and admin-role changes.
  }
}
