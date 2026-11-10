import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MediaProcessorService } from '../../media/providers/media-processor.service.ts';

@Injectable()
export class InboxMediaWorker {
  private readonly logger = new Logger(InboxMediaWorker.name);

  constructor(
    @Inject(MediaProcessorService)
    private readonly processor: MediaProcessorService,
  ) {}

  @Cron('*/5 * * * * *', {
    name: 'inbox-media',
    waitForCompletion: true,
  })
  async poll(): Promise<void> {
    try {
      await this.processor.processPending();
    } catch (error) {
      this.logger.error(
        'Failed to process inbox messages with undownloaded media',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
