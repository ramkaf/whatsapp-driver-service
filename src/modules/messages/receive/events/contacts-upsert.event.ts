import { Injectable } from '@nestjs/common';
import type { ConnectionMessageEvent } from '../../../connection/interfaces/message-event-source.ts';
import { MessageEventHandler } from '../interfaces/message-event-handler.ts';

@Injectable()
export class ContactsUpsertEventHandler extends MessageEventHandler<'contacts.upsert'> {
  readonly event = 'contacts.upsert' as const;

  async handle(
    _event: ConnectionMessageEvent<'contacts.upsert'>,
  ): Promise<void> {
    // TODO: Persist newly discovered contacts.
  }
}
