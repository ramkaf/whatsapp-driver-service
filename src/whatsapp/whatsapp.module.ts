import { Module } from '@nestjs/common';
import { WhatsappConnectionModule } from './connection/whatsapp-connection.module.ts';
import { WhatsappGroupModule } from './groups/whatsapp-group.module.ts';
import { WhatsappMessageCoreModule } from './messages/core/whatsapp-message-core.module.ts';
import { WhatsappMessageModule } from './messages/message/whatsapp-message.module.ts';

@Module({
  imports: [
    WhatsappMessageCoreModule,
    WhatsappConnectionModule,
    WhatsappGroupModule,
    WhatsappMessageModule,
  ],
})
export class WhatsappModule {}
