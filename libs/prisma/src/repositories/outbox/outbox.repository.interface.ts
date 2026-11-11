import type { Prisma, WhatsappMessageOutbox } from '@database/client.js';

export const OUTBOX_REPOSITORY = Symbol('OUTBOX_REPOSITORY');

export type IOutboxFindManyOptions = Prisma.WhatsappMessageOutboxFindManyArgs;

export interface IOutboxRepository extends Pick<
  Prisma.WhatsappMessageOutboxDelegate,
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
  findById(id: string): Promise<WhatsappMessageOutbox | null>;
  exists(where: Prisma.WhatsappMessageOutboxWhereInput): Promise<boolean>;
}
