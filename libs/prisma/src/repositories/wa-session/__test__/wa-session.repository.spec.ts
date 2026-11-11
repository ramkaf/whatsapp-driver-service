import { Prisma } from '@database/client.js';
import type { PrismaService } from '@libs/prisma';
import { WaSessionRepository } from '../wa-session.repository.ts';

const input = {
  name: 'new version',
  phone: '989121234567',
  pairingMethod: 'QR' as const,
};

function fixture(existing: { isEnabled: boolean } | null = null, count = 0) {
  const tx = {
    waSession: {
      findFirst: vi.fn().mockResolvedValue(existing),
      count: vi.fn().mockResolvedValue(count),
      updateMany: vi.fn().mockResolvedValue({ count: existing ? 1 : 0 }),
      create: vi.fn().mockResolvedValue({
        id: 'new',
        ...input,
        isEnabled: true,
        supersededAt: null,
      }),
    },
  };
  const model = {
    findUnique: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    update: vi.fn(),
  };
  const transaction = vi.fn(
    async (work: (client: typeof tx) => Promise<unknown>, _options: unknown) =>
      work(tx),
  );
  const repository = new WaSessionRepository({
    $transaction: transaction,
    waSession: model,
  } as unknown as PrismaService);
  return { repository, transaction, tx, model };
}

describe('WaSessionRepository versions', () => {
  it('archives the previous version and inserts the new one in one serializable transaction at capacity', async () => {
    const { repository, transaction, tx } = fixture({ isEnabled: true }, 1);
    const result = await repository.replaceCurrent(input, 1);
    expect(result.id).toBe('new');
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(tx.waSession.updateMany).toHaveBeenCalledWith({
      where: { phone: input.phone, supersededAt: null },
      data: {
        isEnabled: false,
        supersededAt: expect.any(Date),
        status: 'DISCONNECTED',
        lastDisconnectedAt: expect.any(Date),
      },
    });
    expect(tx.waSession.create).toHaveBeenCalledWith({
      data: {
        ...input,
        isEnabled: true,
        events: { create: { event: 'SESSION_CREATED' } },
      },
    });
    expect(tx.waSession.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.waSession.create.mock.invocationCallOrder[0]!,
    );
  });

  it.each([null, { isEnabled: false }])(
    'rejects another active slot at capacity when the prior row is %j',
    async (existing) => {
      const { repository, tx } = fixture(existing, 1);
      await expect(repository.replaceCurrent(input, 1)).rejects.toThrow(
        'Session limit reached',
      );
      expect(tx.waSession.updateMany).not.toHaveBeenCalled();
      expect(tx.waSession.create).not.toHaveBeenCalled();
    },
  );

  it('retries serialization conflicts while preserving unrelated failures', async () => {
    const { repository, transaction } = fixture();
    const conflict = new Prisma.PrismaClientKnownRequestError('deadlock', {
      code: 'P2034',
      clientVersion: 'test',
    });
    transaction.mockRejectedValueOnce(conflict).mockRejectedValueOnce(conflict);
    await expect(repository.replaceCurrent(input, 1)).resolves.toMatchObject({
      id: 'new',
    });
    expect(transaction).toHaveBeenCalledTimes(3);
    transaction.mockClear();
    transaction.mockRejectedValueOnce(new Error('database failed'));
    await expect(repository.replaceCurrent(input, 1)).rejects.toThrow(
      'database failed',
    );
    expect(transaction).toHaveBeenCalledOnce();
  });

  it('excludes archived versions from lookup, listing, recovery and writes', async () => {
    const { repository, model } = fixture();
    await expect(repository.require('old')).rejects.toThrow(
      'Session not found',
    );
    expect(model.findUnique).toHaveBeenCalledWith({
      where: { id: 'old', supersededAt: null },
    });
    await repository.list();
    await repository.recoverable(10);
    expect(model.findMany).toHaveBeenCalledWith({
      where: { supersededAt: null },
      orderBy: { createdAt: 'asc' },
    });
    expect(model.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isEnabled: true, supersededAt: null }),
      }),
    );
    await repository.updateCurrent('old', { isEnabled: true });
    expect(model.update).toHaveBeenCalledWith({
      where: { id: 'old', supersededAt: null },
      data: { isEnabled: true },
    });
  });

  it('stops retrying after three serialization conflicts', async () => {
    const { repository, transaction, tx } = fixture();
    const conflict = new Prisma.PrismaClientKnownRequestError('deadlock', {
      code: 'P2034',
      clientVersion: 'test',
    });
    transaction.mockRejectedValue(conflict);

    await expect(repository.replaceCurrent(input, 1)).rejects.toBe(conflict);
    expect(transaction).toHaveBeenCalledTimes(3);
    expect(tx.waSession.updateMany).not.toHaveBeenCalled();
    expect(tx.waSession.create).not.toHaveBeenCalled();
  });
});
