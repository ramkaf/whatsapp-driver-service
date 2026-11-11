import type { Prisma, WhatsappMessageInbox } from '@database/client.js';
import type { PrismaService } from '../../../../prisma.service.ts';
import { InboxRepository } from '../inbox.repository.ts';
import type { IInboxRepository } from '../inbox.repository.interface.ts';

describe('InboxRepository', () => {
  it('preserves the delegate context, query object, and lazy Prisma promise when detached', () => {
    const query = {
      [Symbol.toStringTag]: 'PrismaPromise',
      // oxlint-disable-next-line unicorn/no-thenable -- Model a lazy PrismaPromise without executing it.
      then: vi.fn(),
      catch: vi.fn(),
      finally: vi.fn(),
      requestTransaction: vi.fn(),
    };
    const delegate = { upsert: vi.fn().mockReturnValue(query) };
    const repository = new InboxRepository({
      whatsappMessageInbox: delegate,
    } as unknown as PrismaService);
    const args = {
      where: { key: 'message-one' },
      create: { key: 'message-one', payload: { text: 'hello' } },
      update: {},
      select: { id: true },
    } satisfies Prisma.WhatsappMessageInboxUpsertArgs;

    const { upsert } = repository;
    const result = upsert(args);

    expect(result).toBe(query);
    expect(delegate.upsert.mock.contexts).toEqual([delegate]);
    expect(delegate.upsert.mock.calls[0][0]).toBe(args);
    expect(query.then).not.toHaveBeenCalled();
    expectTypeOf(result).toExtend<Prisma.PrismaPromise<{ id: string }>>();
  });

  it('retains Prisma projection, count, grouping, and transaction result types', () => {
    const query = Promise.resolve([]);
    const repository: IInboxRepository = new InboxRepository({
      whatsappMessageInbox: {
        findMany: vi.fn().mockReturnValue(query),
        findUnique: vi.fn().mockReturnValue(query),
        count: vi.fn().mockReturnValue(query),
        groupBy: vi.fn().mockReturnValue(query),
      },
    } as unknown as PrismaService);

    const selected = repository.findMany({ select: { id: true, key: true } });
    expectTypeOf<Awaited<typeof selected>>().toEqualTypeOf<
      { id: string; key: string }[]
    >();

    const omitted = repository.findUnique({
      where: { id: 'inbox-one' },
      omit: { payload: true },
    });
    expectTypeOf<Awaited<typeof omitted>>().toEqualTypeOf<Omit<
      WhatsappMessageInbox,
      'payload'
    > | null>();

    const counts = repository.count({ select: { _all: true, payload: true } });
    expectTypeOf<Awaited<typeof counts>>().toEqualTypeOf<{
      _all: number;
      payload: number;
    }>();
    const total = repository.count();
    expectTypeOf<Awaited<typeof total>>().toEqualTypeOf<number>();

    const grouped = repository.groupBy({
      by: ['status'],
      _count: { _all: true },
      orderBy: { status: 'asc' },
    });
    expectTypeOf<Awaited<typeof grouped>>().toExtend<
      { status: WhatsappMessageInbox['status']; _count: { _all: number } }[]
    >();
    expectTypeOf<keyof Awaited<typeof grouped>[number]>().toEqualTypeOf<
      'status' | '_count'
    >();

    const batch = (prisma: PrismaService) =>
      prisma.$transaction([selected, counts, grouped]);
    expectTypeOf<Awaited<ReturnType<typeof batch>>>().toExtend<
      [
        { id: string; key: string }[],
        { _all: number; payload: number },
        { status: WhatsappMessageInbox['status']; _count: { _all: number } }[],
      ]
    >();
  });
});
