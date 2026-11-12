import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MediaProcessorService } from '../../media/providers/media-processor.service.ts';
import { createMediaTransferFailure } from '../../media/utils/media-transfer-failure.util.ts';

@Injectable()
export class InboxMediaWorker {
  private readonly logger = new Logger(InboxMediaWorker.name);

  constructor(
    @Inject(MediaProcessorService)
    private readonly processor: MediaProcessorService,
  ) {}

  @Cron('*/1 * * * * *', {
    name: 'inbox-media',
    waitForCompletion: true,
  })
  async poll(): Promise<void> {
    try {
      await this.processor.processPending();
    } catch (error) {
      const failure = createMediaTransferFailure('upload', 'poll', error);
      this.logger.error({
        event: 'media_worker_poll_failed',
        message: 'Unable to poll the inbox media queue',
        worker: 'inbox-media',
        service: 'database',
        errorCode: failure.errorCode,
        error: failure.error,
      });
    }
  }
}
