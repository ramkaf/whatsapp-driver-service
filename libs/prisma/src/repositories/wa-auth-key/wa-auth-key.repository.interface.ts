import type { Prisma, WaAuthKey } from '@database/client.js';

export const WA_AUTH_KEY_REPOSITORY = Symbol('WA_AUTH_KEY_REPOSITORY');

export type IWaAuthKeyFindManyOptions = Prisma.WaAuthKeyFindManyArgs;

export interface IWaAuthKeyRepository extends Pick<
  Prisma.WaAuthKeyDelegate,
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
  findById(id: string): Promise<WaAuthKey | null>;
  exists(where: Prisma.WaAuthKeyWhereInput): Promise<boolean>;
}
