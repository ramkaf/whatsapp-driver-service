import { Module } from '@nestjs/common';
import { WhatsappMessageService } from './providers/whatsapp-message.service.ts';
import { MinioStorageModule } from '../../../storage/minio/minio-storage.module.ts';
import { WhatsappMediaService } from './providers/whatsapp-media.service.ts';
import { JsonlService } from './providers/jsonl.service.ts';

@Module({
  imports: [MinioStorageModule],
  providers: [WhatsappMessageService, WhatsappMediaService, JsonlService],
  exports: [WhatsappMessageService, WhatsappMediaService, JsonlService],
})
export class WhatsappMessageCoreModule {}
