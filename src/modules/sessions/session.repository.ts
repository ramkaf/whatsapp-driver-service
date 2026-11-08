import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaService } from '@libs/prisma';
import type { WaSessionEventType } from '@libs/prisma';

@Injectable()
export class SessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async require(id: string) {
    const session = await this.prisma.waSession.findUnique({ where: { id } });
    if (!session) throw new NotFoundException('Session not found');
    return session;
  }

  list() {
    return this.prisma.waSession.findMany({ orderBy: { createdAt: 'asc' } });
  }
  count() {
    return this.prisma.waSession.count();
  }
  recoverable(limit: number) {
    return this.prisma.waSession.findMany({
      where: {
        enabled: true,
        status: { notIn: ['LOGGED_OUT', 'FAILED', 'EXPIRED'] },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }
  create(data: Prisma.WaSessionCreateInput) {
    return this.prisma.waSession.create({
      data: {
        ...data,
        events: { create: { event: 'SESSION_CREATED' } },
      },
    });
  }
  update(id: string, data: Prisma.WaSessionUpdateInput) {
    return this.prisma.waSession.update({ where: { id }, data });
  }
  async transition(
    id: string,
    data: Prisma.WaSessionUpdateInput,
    event: WaSessionEventType,
    metadata?: Prisma.InputJsonObject,
  ) {
    return this.prisma.waSession.update({
      where: { id },
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
