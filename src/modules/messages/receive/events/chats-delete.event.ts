import { Injectable } from '@nestjs/common';
import type { ConnectionMessageEvent } from '../../../connection/interfaces/message-event-source.ts';
import { MessageEventHandler } from '../interfaces/message-event-handler.ts';

@Injectable()
export class ChatsDeleteEventHandler extends MessageEventHandler<'chats.delete'> {
  readonly event = 'chats.delete' as const;

  async handle(_event: ConnectionMessageEvent<'chats.delete'>): Promise<void> {
    // TODO: Handle deleted chat identifiers.
  }
}
