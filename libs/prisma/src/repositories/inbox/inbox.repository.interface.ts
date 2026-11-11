import type { Prisma, WhatsappMessageInbox } from '@database/client.js';

export const INBOX_REPOSITORY = Symbol('INBOX_REPOSITORY');

export type IInboxFindManyOptions = Prisma.WhatsappMessageInboxFindManyArgs;

export interface IInboxRepository extends Pick<
  Prisma.WhatsappMessageInboxDelegate,
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
  findById(id: string): Promise<WhatsappMessageInbox | null>;
  findByKey(key: string): Promise<WhatsappMessageInbox | null>;
  updateStatus(
    id: string,
    status: WhatsappMessageInbox['status'],
  ): Promise<WhatsappMessageInbox>;
  updateMediaStatus(
    id: string,
    mediaStatus: WhatsappMessageInbox['mediaStatus'],
  ): Promise<WhatsappMessageInbox>;
  exists(where: Prisma.WhatsappMessageInboxWhereInput): Promise<boolean>;
}
