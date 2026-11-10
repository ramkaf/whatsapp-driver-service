import { Injectable } from '@nestjs/common';
import type { ConnectionMessageEvent } from '../../../connection/interfaces/message-event-source.ts';
import { MessageEventHandler } from '../interfaces/message-event-handler.ts';

@Injectable()
export class GroupsUpdateEventHandler extends MessageEventHandler<'groups.update'> {
  readonly event = 'groups.update' as const;

  async handle(_event: ConnectionMessageEvent<'groups.update'>): Promise<void> {
    // TODO: Apply group subject, description and settings changes.
  }
}
