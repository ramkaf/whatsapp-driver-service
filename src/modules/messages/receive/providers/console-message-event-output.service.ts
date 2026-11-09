import { Injectable } from '@nestjs/common';
import { MessageEventOutput } from '../interfaces/message-event-output.ts';
import type { ReceivedMessageEvent } from '../interfaces/message-event-output.ts';
import { JsonlUtil } from '../../../../utils/jsonl.util.ts';
import { SessionRepository } from '../../../sessions/session.repository.ts';

/** Appends each received event, including stored media metadata, to its phone's JSONL. */
@Injectable()
export class ConsoleMessageEventOutput extends MessageEventOutput {
  constructor(private readonly sessionRepository: SessionRepository) {
    super();
  }

  async write(event: ReceivedMessageEvent): Promise<void> {
    const session = await this.sessionRepository.require(event.sessionId);
    await JsonlUtil.append(session.phone, event);
  }
}
