import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { setTimeout as delay } from 'node:timers/promises';
import { Test } from '@nestjs/testing';
import { configuer } from '@libs/common';
import { PrismaService } from '../prisma.service.ts';

vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn() }));

const logs = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe('PrismaService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(logs.log);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(logs.warn);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(logs.error);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vi.mocked(delay).mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  const createService = () =>
    new PrismaService({
      databaseUrl: 'mysql://user:password@localhost:3306/whatsapp',
    } as ReturnType<typeof configuer>);

  it('requires a database URL from the shared configuration', () => {
    expect(
      () => new PrismaService({ ...configuer(), databaseUrl: undefined }),
    ).toThrow('DATABASE_URL is required');
  });

  it('uses injected configuration and connects/disconnects with Nest lifecycle', async () => {
    const module = await Test.createTestingModule({
      providers: [
        PrismaService,
        {
          provide: configuer.KEY,
          useValue: {
            databaseUrl: 'mysql://user:password@localhost:3306/whatsapp',
          },
        },
      ],
    }).compile();
    const service = module.get(PrismaService);
    const connect = vi.spyOn(service, '$connect').mockResolvedValue(undefined);
    const disconnect = vi
      .spyOn(service, '$disconnect')
      .mockResolvedValue(undefined);
    await module.init();
    expect(connect).toHaveBeenCalledOnce();
    expect(delay).not.toHaveBeenCalled();
    expect(logs.log).toHaveBeenCalledWith('Database connected successfully');
    await module.close();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(logs.log).toHaveBeenCalledWith('Database disconnected');
  });

  it('retries with exponential jitter and stops after a successful connection', async () => {
    const service = createService();
    const connect = vi
      .spyOn(service, '$connect')
      .mockRejectedValueOnce(new Error('Database unavailable'))
      .mockRejectedValueOnce(new Error('Database unavailable'))
      .mockResolvedValue(undefined);

    await service.onModuleInit();

    expect(connect).toHaveBeenCalledTimes(3);
    expect(vi.mocked(delay).mock.calls).toEqual([[500], [1_000]]);
    expect(logs.warn).toHaveBeenCalledWith(
      'Database connection failed (attempt 1/5)',
    );
    expect(logs.log).toHaveBeenCalledWith('Database connected successfully');
  });

  it('fails startup with the original error after five unsuccessful attempts', async () => {
    const service = createService();
    const error = new Error('Database unavailable');
    const connect = vi.spyOn(service, '$connect').mockRejectedValue(error);

    await expect(service.onModuleInit()).rejects.toBe(error);

    expect(connect).toHaveBeenCalledTimes(5);
    expect(vi.mocked(delay).mock.calls).toEqual([
      [500],
      [1_000],
      [2_000],
      [4_000],
    ]);
    expect(logs.error).toHaveBeenCalledWith(
      'Database connection attempts exhausted; startup failed',
    );
    expect(logs.log).not.toHaveBeenCalledWith(
      'Database connected successfully',
    );
  });

  it('uses randomness to vary retry delays within the exponential window', async () => {
    const service = createService();
    vi.mocked(Math.random).mockReturnValueOnce(0).mockReturnValueOnce(0.999);
    vi.spyOn(service, '$connect')
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValue(undefined);

    await service.onModuleInit();

    expect(vi.mocked(delay).mock.calls).toEqual([[0], [1_998]]);
  });

  it('logs and propagates disconnect failures', async () => {
    const service = createService();
    const error = new Error('Disconnect failed');
    vi.spyOn(service, '$disconnect').mockRejectedValue(error);

    await expect(service.onApplicationShutdown()).rejects.toBe(error);

    expect(logs.error).toHaveBeenCalledWith('Database disconnect failed');
    expect(logs.log).not.toHaveBeenCalledWith('Database disconnected');
  });
});
