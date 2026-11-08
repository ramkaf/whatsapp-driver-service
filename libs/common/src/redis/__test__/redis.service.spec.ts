import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import type { RedisOptions } from 'ioredis';
import { setTimeout as delay } from 'node:timers/promises';
import { RedisService } from '../redis.service.ts';
import type { IAppConfig } from '../../config/config.interface.ts';

vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn() }));
const fake = vi.hoisted(() => ({
  options: undefined as RedisOptions | undefined,
  connect: vi.fn(),
  disconnect: vi.fn(),
  quit: vi.fn(),
}));
vi.mock('ioredis', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    Redis: function (options: RedisOptions) {
      fake.options = options;
      return Object.assign(new EventEmitter(), {
        status: 'wait',
        connect: fake.connect,
        disconnect: fake.disconnect,
        quit: fake.quit,
      });
    },
  };
});

const config = {
  redis: {
    host: 'localhost',
    port: 6379,
    password: 'test-password',
    db: 0,
    connectTimeoutMs: 5000,
    connectionAttempts: 5,
    retryDelayMs: 1000,
    maxRetryDelayMs: 3000,
  },
} as IAppConfig;
const logs = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe('RedisService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fake.connect.mockReset().mockResolvedValue(undefined);
    fake.disconnect.mockReset();
    fake.quit.mockReset().mockResolvedValue('OK');
    vi.spyOn(Logger.prototype, 'log').mockImplementation(logs.log);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(logs.warn);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(logs.error);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vi.mocked(delay).mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  const strategy = () => fake.options!;

  it('uses shared configuration and connects lazily during module startup', async () => {
    const service = new RedisService(config);
    expect(strategy()).toMatchObject({
      host: 'localhost',
      port: 6379,
      password: 'test-password',
      db: 0,
      lazyConnect: true,
      enableOfflineQueue: false,
      connectTimeout: 5000,
    });
    expect(fake.connect).not.toHaveBeenCalled();
    await service.onModuleInit();
    service.client.emit('ready');
    expect(fake.connect).toHaveBeenCalledOnce();
    expect(delay).not.toHaveBeenCalled();
    expect(logs.log).toHaveBeenCalledWith('Redis connected successfully');
  });

  it('retries startup with capped exponential jitter and stops on success', async () => {
    const service = new RedisService(config);
    fake.connect
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValue(undefined);
    await service.onModuleInit();
    expect(fake.connect).toHaveBeenCalledTimes(4);
    expect(vi.mocked(delay).mock.calls).toEqual([[500], [1000], [1500]]);
  });

  it('fails startup after the configured attempts and releases the client', async () => {
    const service = new RedisService(config);
    const error = new Error('Unavailable');
    fake.connect.mockRejectedValue(error);
    await expect(service.onModuleInit()).rejects.toBe(error);
    expect(fake.connect).toHaveBeenCalledTimes(5);
    expect(fake.disconnect).toHaveBeenCalledTimes(5);
    expect(delay).toHaveBeenCalledTimes(4);
    expect(logs.error).toHaveBeenCalledWith(
      'Redis connection attempts exhausted; startup failed',
    );
  });

  it('reconnects after startup with jitter and stops at the configured limit', async () => {
    const service = new RedisService(config);
    const retry = strategy().retryStrategy!;
    expect(retry(1)).toBeNull();
    await service.onModuleInit();
    expect(retry(1)).toBe(500);
    expect(retry(2)).toBe(1000);
    expect(retry(4)).toBe(1500);
    expect(retry(5)).toBeNull();
    vi.mocked(Math.random).mockReturnValue(0.999);
    expect(retry(1)).toBe(999);
    service.client.emit('close');
    service.client.emit('reconnecting', 500);
    service.client.emit(
      'error',
      Object.assign(new Error('Unavailable'), { code: 'ECONNREFUSED' }),
    );
    expect(logs.warn).toHaveBeenCalledWith('Redis connection closed');
    expect(logs.warn).toHaveBeenCalledWith('Redis reconnecting in 500ms');
    expect(logs.warn).toHaveBeenCalledWith(
      'Redis connection error (ECONNREFUSED)',
    );
  });

  it('quits cleanly and prevents reconnection during shutdown', async () => {
    const service = new RedisService(config);
    await service.onModuleInit();
    service.client.status = 'ready';
    await service.onModuleDestroy();
    expect(fake.quit).toHaveBeenCalledOnce();
    expect(fake.disconnect).toHaveBeenCalledOnce();
    expect(strategy().retryStrategy!(1)).toBeNull();
    expect(logs.log).toHaveBeenCalledWith('Redis disconnected');
  });

  it('closes a reconnecting client without queuing QUIT', async () => {
    const service = new RedisService(config);
    service.client.status = 'reconnecting';
    await service.onModuleDestroy();
    expect(fake.quit).not.toHaveBeenCalled();
    expect(fake.disconnect).toHaveBeenCalledOnce();
  });

  it('releases the client even if graceful shutdown fails', async () => {
    const service = new RedisService(config);
    const error = new Error('Unavailable');
    service.client.status = 'ready';
    fake.quit.mockRejectedValue(error);
    await expect(service.onModuleDestroy()).rejects.toBe(error);
    expect(fake.disconnect).toHaveBeenCalledOnce();
    expect(logs.error).toHaveBeenCalledWith('Redis disconnect failed');
  });
});
