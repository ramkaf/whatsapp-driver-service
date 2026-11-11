import type { Prisma, WaAuthCreds } from '@database/client.js';

export const WA_AUTH_CREDS_REPOSITORY = Symbol('WA_AUTH_CREDS_REPOSITORY');

export type IWaAuthCredsFindManyOptions = Prisma.WaAuthCredsFindManyArgs;

export interface IWaAuthCredsRepository extends Pick<
  Prisma.WaAuthCredsDelegate,
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
  findById(id: string): Promise<WaAuthCreds | null>;
  exists(where: Prisma.WaAuthCredsWhereInput): Promise<boolean>;
}
