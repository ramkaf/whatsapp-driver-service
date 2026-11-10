import { Injectable } from '@nestjs/common';
import type { ConnectionMessageEvent } from '../../../connection/interfaces/message-event-source.ts';
import { MessageEventHandler } from '../interfaces/message-event-handler.ts';

@Injectable()
export class LidMappingUpdateEventHandler extends MessageEventHandler<'lid-mapping.update'> {
  readonly event = 'lid-mapping.update' as const;

  async handle(
    _event: ConnectionMessageEvent<'lid-mapping.update'>,
  ): Promise<void> {
    // TODO: Associate LID identifiers with phone-number identifiers.
  }
}
