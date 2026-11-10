import { Injectable } from '@nestjs/common';
import type { ConnectionMessageEvent } from '../../../connection/interfaces/message-event-source.ts';
import { MessageEventHandler } from '../interfaces/message-event-handler.ts';

@Injectable()
export class ChatsUpdateEventHandler extends MessageEventHandler<'chats.update'> {
  readonly event = 'chats.update' as const;

  async handle(_event: ConnectionMessageEvent<'chats.update'>): Promise<void> {
    // TODO: Apply chat metadata and unread-count changes.
  }
}
