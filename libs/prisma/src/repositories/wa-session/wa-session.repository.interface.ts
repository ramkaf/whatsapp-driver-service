import type { Prisma, WaSession } from '@database/client.js';
import type { WaSessionEventType } from '@database/enums.js';

export const WA_SESSION_REPOSITORY = Symbol('WA_SESSION_REPOSITORY');

export type IWaSessionFindManyOptions = Prisma.WaSessionFindManyArgs;

export type IWaSessionReplaceCurrentInput = Pick<
  Prisma.WaSessionCreateInput,
  'name' | 'phone' | 'pairingMethod'
>;

export interface IWaSessionRepository extends Pick<
  Prisma.WaSessionDelegate,
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
  findById(id: string): Promise<WaSession | null>;
  exists(where: Prisma.WaSessionWhereInput): Promise<boolean>;
  require(id: string): Promise<WaSession>;
  list(): Promise<WaSession[]>;
  currentByPhone(phone: string): Promise<WaSession | null>;
  recoverable(limit: number): Promise<WaSession[]>;
  replaceCurrent(
    data: IWaSessionReplaceCurrentInput,
    maxSessions: number,
  ): Promise<WaSession>;
  countEnabledSessions(): Promise<number>;
  updateCurrent(
    id: string,
    data: Prisma.WaSessionUpdateInput,
  ): Promise<WaSession>;
  transition(
    id: string,
    data: Prisma.WaSessionUpdateInput,
    event: WaSessionEventType,
    metadata?: Prisma.InputJsonObject,
  ): Promise<WaSession>;
  remove(id: string): Promise<WaSession>;
}
