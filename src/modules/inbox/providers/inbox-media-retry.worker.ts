import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MediaProcessorService } from '../../media/providers/media-processor.service.ts';
import { createMediaTransferFailure } from '../../media/utils/media-transfer-failure.util.ts';

@Injectable()
export class InboxMediaRetryWorker {
  private readonly logger = new Logger(InboxMediaRetryWorker.name);

  constructor(
    @Inject(MediaProcessorService)
    private readonly processor: MediaProcessorService,
  ) {}

  @Cron('* * * * * *', {
    name: 'inbox-media-retry',
    waitForCompletion: true,
  })
  async poll(): Promise<void> {
    try {
      await this.processor.processRetries();
    } catch (error) {
      const failure = createMediaTransferFailure('upload', 'poll', error);
      this.logger.error({
        event: 'media_worker_poll_failed',
        message:
          'Unable to poll the media retry queue or recover expired attempts',
        worker: 'inbox-media-retry',
        service: 'database',
        errorCode: failure.errorCode,
        error: failure.error,
      });
    }
  }
}
