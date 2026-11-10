import { Injectable } from '@nestjs/common';
import type { ConnectionMessageEvent } from '../../../connection/interfaces/message-event-source.ts';
import { MessageEventHandler } from '../interfaces/message-event-handler.ts';

@Injectable()
export class ContactsUpdateEventHandler extends MessageEventHandler<'contacts.update'> {
  readonly event = 'contacts.update' as const;

  async handle(
    _event: ConnectionMessageEvent<'contacts.update'>,
  ): Promise<void> {
    // TODO: Apply contact name and profile changes.
  }
}
