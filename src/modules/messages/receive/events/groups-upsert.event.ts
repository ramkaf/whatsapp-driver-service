import { Injectable } from '@nestjs/common';
import type { ConnectionMessageEvent } from '../../../connection/interfaces/message-event-source.ts';
import { MessageEventHandler } from '../interfaces/message-event-handler.ts';

@Injectable()
export class GroupsUpsertEventHandler extends MessageEventHandler<'groups.upsert'> {
  readonly event = 'groups.upsert' as const;

  async handle(_event: ConnectionMessageEvent<'groups.upsert'>): Promise<void> {
    // TODO: Persist newly discovered group metadata.
  }
}
