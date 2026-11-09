import { Module } from '@nestjs/common';
import { ConnectionModule } from '../../connection/connection.module.ts';
import { MESSAGE_EVENT_HANDLERS } from './interfaces/message-event-handler.ts';
import type { MessageEventHandler } from './interfaces/message-event-handler.ts';
import { MessageEventOutput } from './interfaces/message-event-output.ts';
import { ConsoleMessageEventOutput } from './providers/console-message-event-output.service.ts';
import { MessagesReceiveService } from './providers/messages-receive.service.ts';
import { MessagesUpsertEventHandler } from './events/messages-upsert.event.ts';
import { MessagesUpdateEventHandler } from './events/messages-update.event.ts';
import { MessagesDeleteEventHandler } from './events/messages-delete.event.ts';
import { MessagesReactionEventHandler } from './events/messages-reaction.event.ts';
import { MessagesMediaUpdateEventHandler } from './events/messages-media-update.event.ts';
import { MessageReceiptUpdateEventHandler } from './events/message-receipt-update.event.ts';
import { MessagingHistorySetEventHandler } from './events/messaging-history-set.event.ts';
import { MessagingHistoryStatusEventHandler } from './events/messaging-history-status.event.ts';
import { SessionDataModule } from '../../sessions/session-data.module.ts';
import { MediaModule } from '../../media/media.module.ts';
import { MessageMediaService } from './providers/message-media.service.ts';

const eventHandlers = [
  MessagesUpsertEventHandler,
  MessagesUpdateEventHandler,
  MessagesDeleteEventHandler,
  MessagesReactionEventHandler,
  MessagesMediaUpdateEventHandler,
  MessageReceiptUpdateEventHandler,
  MessagingHistorySetEventHandler,
  MessagingHistoryStatusEventHandler,
];

/** Registers all handlers in one place and exposes the receiving service. */
@Module({
  imports: [ConnectionModule, SessionDataModule, MediaModule],
  providers: [
    ...eventHandlers,
    { provide: MessageEventOutput, useClass: ConsoleMessageEventOutput },
    {
      provide: MESSAGE_EVENT_HANDLERS,
      inject: eventHandlers,
      useFactory: (...handlers: MessageEventHandler[]) => handlers,
    },
    MessagesReceiveService,
    MessageMediaService,
  ],
  exports: [MessagesReceiveService],
})
export class MessagesReceiveModule {}
