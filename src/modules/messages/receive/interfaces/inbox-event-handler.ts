import { Inject } from '@nestjs/common';
import type {
  ConnectionMessageEvent,
  MessageEventName,
} from '../../../connection/interfaces/message-event-source.ts';
import { InboxService } from '../../../inbox/providers/inbox.service.ts';
import { MessageEventHandler } from './message-event-handler.ts';
import { toInboxEntries } from '../utils/message-inbox-entry.util.ts';
import type { InboxEntry } from '../../../inbox/interfaces/inbox-entry.ts';

/** Shared persistence path; subclasses keep the typed per-event extension point. */
export abstract class InboxEventHandler<
  K extends MessageEventName,
> extends MessageEventHandler<K> {
  constructor(@Inject(InboxService) private readonly inbox: InboxService) {
    super();
  }

  protected abstract shouldHandle(payload: InboxEntry['payload']): boolean;

  protected abstract normalizePayload(
    payload: InboxEntry['payload'],
  ): InboxEntry['payload'];

  async handle(event: ConnectionMessageEvent<K>): Promise<void> {
    const failures: unknown[] = [];
    for (const entry of toInboxEntries(event as ConnectionMessageEvent)) {
      try {
        if (!this.shouldHandle(entry.payload)) continue;
        await this.inbox.handle({
          ...entry,
          reformPayload: this.normalizePayload(entry.payload),
        });
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length)
      throw new AggregateError(failures, 'Failed to persist inbox events');
  }
}
