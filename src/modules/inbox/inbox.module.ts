import { Module } from '@nestjs/common';
import { InboxController } from './controllers/inbox.controller.ts';
import { InboxService } from './providers/inbox.service.ts';
import { PrismaModule } from '@libs/prisma';
import { InboxMediaWorker } from './providers/inbox-media.worker.ts';
import { InboxMediaRetryWorker } from './providers/inbox-media-retry.worker.ts';
import { ConnectionModule } from '../connection/connection.module.ts';
import { MediaModule } from '../media/media.module.ts';
import { MediaProcessorService } from '../media/providers/media-processor.service.ts';

@Module({
  imports: [PrismaModule, ConnectionModule, MediaModule],
  controllers: [InboxController],
  providers: [
    InboxService,
    InboxMediaWorker,
    InboxMediaRetryWorker,
    MediaProcessorService,
  ],
  exports: [InboxService],
})
export class InboxModule {}
