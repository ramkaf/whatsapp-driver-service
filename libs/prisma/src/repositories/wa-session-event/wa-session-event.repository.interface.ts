import type { Prisma, WaSessionEvent } from '@database/client.js';

export const WA_SESSION_EVENT_REPOSITORY = Symbol(
  'WA_SESSION_EVENT_REPOSITORY',
);

export type IWaSessionEventFindManyOptions = Prisma.WaSessionEventFindManyArgs;

export interface IWaSessionEventRepository extends Pick<
  Prisma.WaSessionEventDelegate,
  | 'findUnique'
  | 'findUniqueOrThrow'
  | 'findFirst'
  | 'findFirstOrThrow'
  | 'findMany'
  | 'create'
  | 'createMany'
  | 'update'
  | 'updateMany'
  | 'upsert'
  | 'delete'
  | 'deleteMany'
  | 'count'
  | 'aggregate'
  | 'groupBy'
> {
  findById(id: string): Promise<WaSessionEvent | null>;
  exists(where: Prisma.WaSessionEventWhereInput): Promise<boolean>;
}
