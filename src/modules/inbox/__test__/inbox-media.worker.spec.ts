import { Logger } from '@nestjs/common';
import type { MockInstance } from 'vitest';
import type { MediaProcessorService } from '../../media/providers/media-processor.service.ts';
import { InboxMediaWorker } from '../providers/inbox-media.worker.ts';
import { InboxMediaRetryWorker } from '../providers/inbox-media-retry.worker.ts';

let error: MockInstance;

beforeEach(() => {
  error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe.each([
  [InboxMediaWorker, 'processPending', 'inbox-media'],
  [InboxMediaRetryWorker, 'processRetries', 'inbox-media-retry'],
] as const)('%s', (Worker, method, workerName) => {
  it('polls its queue', async () => {
    const processor = {
      processPending: vi.fn().mockResolvedValue(undefined),
      processRetries: vi.fn().mockResolvedValue(undefined),
    };
    await new Worker(processor as unknown as MediaProcessorService).poll();
    expect(processor[method]).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
  });

  it('logs structured poll failures without crashing future scheduled runs', async () => {
    const processor = {
      processPending: vi.fn().mockResolvedValue(undefined),
      processRetries: vi.fn().mockResolvedValue(undefined),
    };
    processor[method].mockRejectedValueOnce(
      Object.assign(new Error('database unavailable'), {
        code: 'ECONNREFUSED',
      }),
    );
    const worker = new Worker(processor as unknown as MediaProcessorService);
    await expect(worker.poll()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'media_worker_poll_failed',
        worker: workerName,
        service: 'database',
        error: 'database unavailable',
        errorCode: 'ECONNREFUSED',
      }),
    );
    await expect(worker.poll()).resolves.toBeUndefined();
    expect(processor[method]).toHaveBeenCalledTimes(2);
  });
});
