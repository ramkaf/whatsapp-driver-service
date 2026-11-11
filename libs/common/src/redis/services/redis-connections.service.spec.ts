import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  ping: vi.fn(),
  disconnect: vi.fn(),
  delay: vi.fn(),
  instances: [] as Array<{ options: Record<string, unknown> }>,
}));

vi.mock('node:timers/promises', () => ({ setTimeout: mocks.delay }));
vi.mock('ioredis', () => ({
  Redis: class {
    constructor(public options: Record<string, unknown>) {
      mocks.instances.push(this);
    }
    on() {
      return this;
    }
    connect() {
      return mocks.connect();
    }
    ping() {
      return mocks.ping();
    }
    disconnect() {
      return mocks.disconnect();
    }
  },
}));

import { RedisConnectionsService } from './redis-connections.service.ts';

describe('RedisConnectionsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.instances.length = 0;
    mocks.connect.mockResolvedValue(undefined);
    mocks.ping.mockResolvedValue('PONG');
    mocks.delay.mockResolvedValue(undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  it('retries startup with database backoff and fails after five attempts', async () => {
    const failure = new Error('connection failed');
    mocks.connect.mockRejectedValue(failure);
    const service = new RedisConnectionsService({
      redis: { host: 'localhost', db: 2 },
    });

    await expect(service.onModuleInit()).rejects.toBe(failure);
    expect(mocks.connect).toHaveBeenCalledTimes(5);
    expect(mocks.delay.mock.calls.map(([ms]) => ms)).toEqual([
      1000, 2000, 4000, 8000,
    ]);
    expect(mocks.disconnect).toHaveBeenCalledTimes(5);
    expect(
      mocks.instances.every(
        ({ options }) => options.db === 2 && options.retryStrategy === null,
      ),
    ).toBe(true);
  });

  it('checks readiness and stops retrying after a successful ping', async () => {
    mocks.connect.mockRejectedValueOnce(new Error('connection failed'));
    const service = new RedisConnectionsService({
      redis: { host: 'localhost' },
    });

    await service.onModuleInit();
    expect(mocks.connect).toHaveBeenCalledTimes(2);
    expect(mocks.ping).toHaveBeenCalledTimes(1);
    expect(mocks.delay).toHaveBeenCalledTimes(1);
    expect(mocks.disconnect).toHaveBeenCalledTimes(2);
  });

  it('reuses clients per database and limits runtime reconnects', () => {
    const service = new RedisConnectionsService({ redis: { db: 0 } });
    const first = service.db(1);
    expect(service.db(1)).toBe(first);
    expect(service.db(2)).not.toBe(first);
    const options = mocks.instances[0].options;
    const retry = options.retryStrategy as (attempt: number) => number | null;
    expect([1, 2, 3, 4, 5, 6].map(retry)).toEqual([
      1000,
      2000,
      4000,
      8000,
      10000,
      null,
    ]);
    expect(options.maxRetriesPerRequest).toBe(5);
    service.onModuleDestroy();
    expect(mocks.disconnect).toHaveBeenCalledTimes(2);
  });
});
