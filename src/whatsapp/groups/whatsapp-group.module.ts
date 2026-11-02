import { Module } from '@nestjs/common';
import { WhatsappGroupController } from './controllers/whatsapp-group.controller.ts';
import { WhatsappGroupService } from './providers/whatsapp-group.service.ts';
import { WhatsappConnectionModule } from '../connection/whatsapp-connection.module.ts';
import { WhatsappGroupRepository } from './providers/whatsapp-group.repository.ts';

@Module({
  imports: [WhatsappConnectionModule],
  controllers: [WhatsappGroupController],
  providers: [WhatsappGroupService, WhatsappGroupRepository],
  exports: [WhatsappGroupService, WhatsappGroupRepository],
})
export class WhatsappGroupModule {}
