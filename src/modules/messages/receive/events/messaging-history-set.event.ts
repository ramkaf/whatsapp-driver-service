import { Inject, Injectable } from '@nestjs/common';
import type { ConnectionMessageEvent } from '../../../connection/interfaces/message-event-source.ts';
import { MessageEventHandler } from '../interfaces/message-event-handler.ts';
import { MessageEventOutput } from '../interfaces/message-event-output.ts';
import { MessageMediaService } from '../providers/message-media.service.ts';

/** Handles each historical message without logging unrelated contact or chat snapshots. */
@Injectable()
export class MessagingHistorySetEventHandler extends MessageEventHandler<'messaging-history.set'> {
  readonly event = 'messaging-history.set' as const;

  constructor(
    @Inject(MessageEventOutput) private readonly output: MessageEventOutput,
    private readonly media: MessageMediaService,
  ) {
    super();
  }

  async handle(
    event: ConnectionMessageEvent<'messaging-history.set'>,
  ): Promise<void> {
    for (const message of event.data.messages) {
      const attachment = await this.media.store(event.sessionId, message);
      await this.output.write({
        ...event,
        ...attachment,
        data: {
          message,
          isLatest: event.data.isLatest,
          progress: event.data.progress,
          syncType: event.data.syncType,
        },
      });
    }
  }
}
