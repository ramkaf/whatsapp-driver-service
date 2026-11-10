import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PrismaService } from '@libs/prisma';
import type { WaSessionEventType } from '@libs/prisma';

@Injectable()
export class SessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async require(id: string) {
    const session = await this.prisma.waSession.findUnique({
      where: { id, supersededAt: null },
    });
    if (!session) throw new NotFoundException('Session not found');
    return session;
  }

  list() {
    return this.prisma.waSession.findMany({
      where: { supersededAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }
  currentByPhone(phone: string) {
    return this.prisma.waSession.findFirst({
      where: { phone, supersededAt: null },
    });
  }
  recoverable(limit: number) {
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
    data: Pick<Prisma.WaSessionCreateInput, 'name' | 'phone' | 'pairingMethod'>,
    maxSessions: number,
  ) {
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
      where: {
        isEnabled: true,
        supersededAt: null,
      },
    });
  }
  update(id: string, data: Prisma.WaSessionUpdateInput) {
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
  ) {
    return this.prisma.waSession.update({
      where: { id, supersededAt: null },
      data: {
        ...data,
        events: { create: { event, metadata } },
      },
    });
  }
  remove(id: string) {
    return this.prisma.waSession.delete({ where: { id } });
  }
}
