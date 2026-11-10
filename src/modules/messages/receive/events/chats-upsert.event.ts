import { Injectable } from '@nestjs/common';
import type { ConnectionMessageEvent } from '../../../connection/interfaces/message-event-source.ts';
import { MessageEventHandler } from '../interfaces/message-event-handler.ts';

@Injectable()
export class ChatsUpsertEventHandler extends MessageEventHandler<'chats.upsert'> {
  readonly event = 'chats.upsert' as const;

  async handle(_event: ConnectionMessageEvent<'chats.upsert'>): Promise<void> {
    // TODO: Persist newly discovered chats.
  }
}
