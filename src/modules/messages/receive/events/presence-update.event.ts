import { Injectable } from '@nestjs/common';
import type { ConnectionMessageEvent } from '../../../connection/interfaces/message-event-source.ts';
import { MessageEventHandler } from '../interfaces/message-event-handler.ts';

@Injectable()
export class PresenceUpdateEventHandler extends MessageEventHandler<'presence.update'> {
  readonly event = 'presence.update' as const;

  async handle(
    _event: ConnectionMessageEvent<'presence.update'>,
  ): Promise<void> {
    // TODO: Handle online, typing and recording presence changes.
  }
}
