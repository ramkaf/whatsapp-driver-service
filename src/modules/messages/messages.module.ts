import { Module } from '@nestjs/common';
import { MessagesReceiveModule } from './receive/messages-receive.module.ts';
import { MessagesSendModule } from './send/messages-send.module.ts';

/** Groups independent receiving and future sending capabilities. */
@Module({
  imports: [MessagesReceiveModule, MessagesSendModule],
  exports: [MessagesReceiveModule, MessagesSendModule],
})
export class MessagesModule {}
