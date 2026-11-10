import { Module } from '@nestjs/common';
import { ConnectionModule } from '../../connection/connection.module.ts';
import { InboxModule } from '../../inbox/inbox.module.ts';
import { MESSAGE_EVENT_HANDLERS } from './interfaces/message-event-handler.ts';
import type { MessageEventHandler } from './interfaces/message-event-handler.ts';
import { MessagesReceiveService } from './providers/messages-receive.service.ts';
import { MessagesUpsertEventHandler } from './events/messages-upsert.event.ts';
import { MessagesUpdateEventHandler } from './events/messages-update.event.ts';
import { MessagesDeleteEventHandler } from './events/messages-delete.event.ts';
import { MessagesReactionEventHandler } from './events/messages-reaction.event.ts';
import { MessagesMediaUpdateEventHandler } from './events/messages-media-update.event.ts';
import { MessageReceiptUpdateEventHandler } from './events/message-receipt-update.event.ts';
import { MessagingHistorySetEventHandler } from './events/messaging-history-set.event.ts';
import { MessagingHistoryStatusEventHandler } from './events/messaging-history-status.event.ts';
import { ChatsUpsertEventHandler } from './events/chats-upsert.event.ts';
import { ChatsUpdateEventHandler } from './events/chats-update.event.ts';
import { ChatsDeleteEventHandler } from './events/chats-delete.event.ts';
import { ContactsUpsertEventHandler } from './events/contacts-upsert.event.ts';
import { ContactsUpdateEventHandler } from './events/contacts-update.event.ts';
import { LidMappingUpdateEventHandler } from './events/lid-mapping-update.event.ts';
import { GroupsUpsertEventHandler } from './events/groups-upsert.event.ts';
import { GroupsUpdateEventHandler } from './events/groups-update.event.ts';
import { GroupParticipantsUpdateEventHandler } from './events/group-participants-update.event.ts';
import { GroupJoinRequestEventHandler } from './events/group-join-request.event.ts';
import { PresenceUpdateEventHandler } from './events/presence-update.event.ts';
import { CallEventHandler } from './events/call.event.ts';
import { BlocklistSetEventHandler } from './events/blocklist-set.event.ts';
import { BlocklistUpdateEventHandler } from './events/blocklist-update.event.ts';

const eventHandlers = [
  MessagesUpsertEventHandler,
  MessagesUpdateEventHandler,
  MessagesDeleteEventHandler,
  MessagesReactionEventHandler,
  MessagesMediaUpdateEventHandler,
  MessageReceiptUpdateEventHandler,
  MessagingHistorySetEventHandler,
  MessagingHistoryStatusEventHandler,
  ChatsUpsertEventHandler,
  ChatsUpdateEventHandler,
  ChatsDeleteEventHandler,
  ContactsUpsertEventHandler,
  ContactsUpdateEventHandler,
  LidMappingUpdateEventHandler,
  GroupsUpsertEventHandler,
  GroupsUpdateEventHandler,
  GroupParticipantsUpdateEventHandler,
  GroupJoinRequestEventHandler,
  PresenceUpdateEventHandler,
  CallEventHandler,
  BlocklistSetEventHandler,
  BlocklistUpdateEventHandler,
];

/** Registers all handlers in one place and exposes the receiving service. */
@Module({
  imports: [ConnectionModule, InboxModule],
  providers: [
    ...eventHandlers,
    {
      provide: MESSAGE_EVENT_HANDLERS,
      inject: eventHandlers,
      useFactory: (...handlers: MessageEventHandler[]) => handlers,
    },
    MessagesReceiveService,
  ],
  exports: [MessagesReceiveService],
})
export class MessagesReceiveModule {}
