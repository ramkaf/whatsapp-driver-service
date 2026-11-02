import { Module } from '@nestjs/common';
import { WhatsappMessageService } from './providers/whatsapp-message.service.ts';
import { MinioStorageModule } from '../../../storage/minio/minio-storage.module.ts';
import { WhatsappMediaService } from './providers/whatsapp-media.service.ts';
import { JsonlService } from './providers/jsonl.service.ts';
import { WhatsappEventListener } from './providers/whatsapp-event-listener.service.ts';

@Module({
  imports: [MinioStorageModule],
  providers: [
    WhatsappMessageService,
    WhatsappMediaService,
    WhatsappEventListener,
    JsonlService,
  ],
  exports: [
    WhatsappMessageService,
    WhatsappMediaService,
    WhatsappEventListener,
    JsonlService,
  ],
})
export class WhatsappMessageCoreModule {}
