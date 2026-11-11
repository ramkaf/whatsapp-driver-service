import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type WaSession } from '@database/client.js';
import type { WaSessionEventType } from '@database/enums.js';

import { PrismaService } from '../../../prisma.service.ts';
import type {
  IWaSessionReplaceCurrentInput,
  IWaSessionRepository,
} from './wa-session.repository.interface.ts';

@Injectable()
export class WaSessionRepository implements IWaSessionRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  get findUnique(): IWaSessionRepository['findUnique'] {
    const delegate = this.prisma.waSession;
    return delegate.findUnique.bind(delegate);
  }

  get findUniqueOrThrow(): IWaSessionRepository['findUniqueOrThrow'] {
    const delegate = this.prisma.waSession;
    return delegate.findUniqueOrThrow.bind(delegate);
  }

  get findFirst(): IWaSessionRepository['findFirst'] {
    const delegate = this.prisma.waSession;
    return delegate.findFirst.bind(delegate);
  }

  get findFirstOrThrow(): IWaSessionRepository['findFirstOrThrow'] {
    const delegate = this.prisma.waSession;
    return delegate.findFirstOrThrow.bind(delegate);
  }

  get findMany(): IWaSessionRepository['findMany'] {
    const delegate = this.prisma.waSession;
    return delegate.findMany.bind(delegate);
  }

  get create(): IWaSessionRepository['create'] {
    const delegate = this.prisma.waSession;
    return delegate.create.bind(delegate);
  }

  get createMany(): IWaSessionRepository['createMany'] {
    const delegate = this.prisma.waSession;
    return delegate.createMany.bind(delegate);
  }

  get update(): IWaSessionRepository['update'] {
    const delegate = this.prisma.waSession;
    return delegate.update.bind(delegate);
  }

  get updateMany(): IWaSessionRepository['updateMany'] {
    const delegate = this.prisma.waSession;
    return delegate.updateMany.bind(delegate);
  }

  get upsert(): IWaSessionRepository['upsert'] {
    const delegate = this.prisma.waSession;
    return delegate.upsert.bind(delegate);
  }

  get delete(): IWaSessionRepository['delete'] {
    const delegate = this.prisma.waSession;
    return delegate.delete.bind(delegate);
  }

  get deleteMany(): IWaSessionRepository['deleteMany'] {
    const delegate = this.prisma.waSession;
    return delegate.deleteMany.bind(delegate);
  }

  get count(): IWaSessionRepository['count'] {
    const delegate = this.prisma.waSession;
    return delegate.count.bind(delegate);
  }

  get aggregate(): IWaSessionRepository['aggregate'] {
    const delegate = this.prisma.waSession;
    return delegate.aggregate.bind(delegate);
  }

  get groupBy(): IWaSessionRepository['groupBy'] {
    const delegate = this.prisma.waSession;
    return delegate.groupBy.bind(delegate);
  }

  async findById(id: string): Promise<WaSession | null> {
    return this.prisma.waSession.findUnique({ where: { id } });
  }

  async exists(where: Prisma.WaSessionWhereInput): Promise<boolean> {
    const record = await this.prisma.waSession.findFirst({
      where,
      select: { id: true },
    });
    return record !== null;
  }

  async require(id: string): Promise<WaSession> {
    const session = await this.prisma.waSession.findUnique({
      where: { id, supersededAt: null },
    });
    if (!session) throw new NotFoundException('Session not found');
    return session;
  }

  list(): Promise<WaSession[]> {
    return this.prisma.waSession.findMany({
      where: { supersededAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  currentByPhone(phone: string): Promise<WaSession | null> {
    return this.prisma.waSession.findFirst({
      where: { phone, supersededAt: null },
    });
  }

  recoverable(limit: number): Promise<WaSession[]> {
    return this.prisma.waSession.findMany({
      where: {
        isEnabled: true,
        supersededAt: null,
        OR: [
          { status: { notIn: ['LOGGED_OUT', 'FAILED', 'EXPIRED'] } },
          // Older builds stopped temporary failures after exhausting retries.
          { status: 'FAILED', lastError: 'Reconnect threshold reached' },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  async replaceCurrent(
    data: IWaSessionReplaceCurrentInput,
    maxSessions: number,
  ): Promise<WaSession> {
    // Serializable reads also protect the active-session limit across phone numbers.
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const existing = await tx.waSession.findFirst({
              where: { phone: data.phone, supersededAt: null },
            });
            const count = await tx.waSession.count({
              where: { isEnabled: true, supersededAt: null },
            });
            if (count - (existing?.isEnabled ? 1 : 0) >= maxSessions)
              throw new ConflictException('Session limit reached');

            await tx.waSession.updateMany({
              where: { phone: data.phone, supersededAt: null },
              data: {
                isEnabled: false,
                supersededAt: new Date(),
                status: 'DISCONNECTED',
                lastDisconnectedAt: new Date(),
              },
            });
            return tx.waSession.create({
              data: {
                ...data,
                isEnabled: true,
                events: { create: { event: 'SESSION_CREATED' } },
              },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== 'P2034' ||
          attempt >= 2
        )
          throw error;
      }
    }
  }

  async countEnabledSessions(): Promise<number> {
    return this.prisma.waSession.count({
      where: { isEnabled: true, supersededAt: null },
    });
  }

  updateCurrent(
    id: string,
    data: Prisma.WaSessionUpdateInput,
  ): Promise<WaSession> {
    return this.prisma.waSession.update({
      where: { id, supersededAt: null },
      data,
    });
  }

  async transition(
    id: string,
    data: Prisma.WaSessionUpdateInput,
    event: WaSessionEventType,
    metadata?: Prisma.InputJsonObject,
  ): Promise<WaSession> {
    return this.prisma.waSession.update({
      where: { id, supersededAt: null },
      data: {
        ...data,
        events: { create: { event, metadata } },
      },
    });
  }

  remove(id: string): Promise<WaSession> {
    return this.prisma.waSession.delete({ where: { id } });
  }
}
