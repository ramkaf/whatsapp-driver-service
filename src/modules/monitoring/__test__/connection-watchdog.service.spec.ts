import { Logger } from '@nestjs/common';
import type { MockInstance } from 'vitest';
import type { IAppConfig } from '@libs/common';
import type { SessionManagerService } from '../../connection/providers/session/session-manager.service.ts';
import { ConnectionWatchdogService } from '../providers/connection-watchdog.service.ts';

describe('ConnectionWatchdogService', () => {
  let inspect: ReturnType<typeof vi.fn>;
  let watchdog: ConnectionWatchdogService;
  let loggedError: MockInstance;

  beforeEach(() => {
    vi.useFakeTimers();
    loggedError = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    inspect = vi.fn().mockResolvedValue(undefined);
    watchdog = new ConnectionWatchdogService(
      { inspectConnections: inspect } as unknown as SessionManagerService,
      { whatsapp: { watchdogIntervalMs: 1_000 } } as IAppConfig,
    );
  });
  afterEach(async () => {
    await watchdog.onModuleDestroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('skips overlapping checks and resumes after the current inspection finishes', async () => {
    let release!: () => void;
    inspect.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    watchdog.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(1_000);
    try {
      await vi.advanceTimersByTimeAsync(3_000);
      expect(inspect).toHaveBeenCalledOnce();
    } finally {
      release();
    }
    await vi.advanceTimersByTimeAsync(1_000);
    expect(inspect).toHaveBeenCalledTimes(2);
  });

  it('contains a failed inspection and checks again at the next interval', async () => {
    const failure = new Error('persistence unavailable');
    inspect.mockRejectedValueOnce(failure);
    watchdog.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(loggedError).toHaveBeenCalledWith({
      event: 'watchdog_check_failed',
      error: failure,
    });
  });

  it('stops scheduling on shutdown and waits for an inspection already in progress', async () => {
    let release!: () => void;
    inspect.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    watchdog.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(1_000);
    let stopped = false;
    const closing = watchdog.onModuleDestroy().then(() => {
      stopped = true;
    });
    try {
      await vi.advanceTimersByTimeAsync(5_000);
      expect(inspect).toHaveBeenCalledOnce();
      expect(stopped).toBe(false);
    } finally {
      release();
      await closing;
    }
    expect(stopped).toBe(true);
  });
});
