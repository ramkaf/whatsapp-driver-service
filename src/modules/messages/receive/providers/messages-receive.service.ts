import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConnectionMessageSource } from '../../../connection/interfaces/message-event-source.ts';
import type { ConnectionMessageEvent } from '../../../connection/interfaces/message-event-source.ts';
import { MESSAGE_EVENT_HANDLERS } from '../interfaces/message-event-handler.ts';
import type { MessageEventHandler } from '../interfaces/message-event-handler.ts';

/** Subscribes once to every session and dispatches message events to their own handlers. */
@Injectable()
export class MessagesReceiveService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MessagesReceiveService.name);
  private unsubscribe?: () => void;
  private readonly pending = new Set<Promise<void>>();

  constructor(
    @Inject(ConnectionMessageSource)
    private readonly source: ConnectionMessageSource,
    @Inject(MESSAGE_EVENT_HANDLERS)
    private readonly handlers: readonly MessageEventHandler[],
  ) {}

  onModuleInit(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.source.subscribe((event) => {
      const task = this.receive(event);
      this.pending.add(task);
      void task.then(
        () => this.pending.delete(task),
        () => this.pending.delete(task),
      );
    });
    this.logger.log('Listening for message events from all connected sessions');
  }

  private async receive(event: ConnectionMessageEvent): Promise<void> {
    const handler = this.handlers.find(
      (candidate) => candidate.event === event.event,
    );
    if (!handler) return;
    try {
      await handler.handle(event);
    } catch {
      // A bad payload or output failure must not interrupt another session's socket.
      // this.logger.error({
      //   sessionId: event.sessionId,
      //   event: event.event,
      //   reason: 'message_handler_failed',
      // });
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    await Promise.allSettled(this.pending);
  }
}
