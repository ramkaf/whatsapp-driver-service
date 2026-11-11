import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, WaSessionEvent } from '@database/client.js';

import { PrismaService } from '../../../prisma.service.ts';
import type { IWaSessionEventRepository } from './wa-session-event.repository.interface.ts';

@Injectable()
export class WaSessionEventRepository implements IWaSessionEventRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  get findUnique(): IWaSessionEventRepository['findUnique'] {
    const delegate = this.prisma.waSessionEvent;
    return delegate.findUnique.bind(delegate);
  }

  get findUniqueOrThrow(): IWaSessionEventRepository['findUniqueOrThrow'] {
    const delegate = this.prisma.waSessionEvent;
    return delegate.findUniqueOrThrow.bind(delegate);
  }

  get findFirst(): IWaSessionEventRepository['findFirst'] {
    const delegate = this.prisma.waSessionEvent;
    return delegate.findFirst.bind(delegate);
  }

  get findFirstOrThrow(): IWaSessionEventRepository['findFirstOrThrow'] {
    const delegate = this.prisma.waSessionEvent;
    return delegate.findFirstOrThrow.bind(delegate);
  }

  get findMany(): IWaSessionEventRepository['findMany'] {
    const delegate = this.prisma.waSessionEvent;
    return delegate.findMany.bind(delegate);
  }

  get create(): IWaSessionEventRepository['create'] {
    const delegate = this.prisma.waSessionEvent;
    return delegate.create.bind(delegate);
  }

  get createMany(): IWaSessionEventRepository['createMany'] {
    const delegate = this.prisma.waSessionEvent;
    return delegate.createMany.bind(delegate);
  }

  get update(): IWaSessionEventRepository['update'] {
    const delegate = this.prisma.waSessionEvent;
    return delegate.update.bind(delegate);
  }

  get updateMany(): IWaSessionEventRepository['updateMany'] {
    const delegate = this.prisma.waSessionEvent;
    return delegate.updateMany.bind(delegate);
  }

  get upsert(): IWaSessionEventRepository['upsert'] {
    const delegate = this.prisma.waSessionEvent;
    return delegate.upsert.bind(delegate);
  }

  get delete(): IWaSessionEventRepository['delete'] {
    const delegate = this.prisma.waSessionEvent;
    return delegate.delete.bind(delegate);
  }

  get deleteMany(): IWaSessionEventRepository['deleteMany'] {
    const delegate = this.prisma.waSessionEvent;
    return delegate.deleteMany.bind(delegate);
  }

  get count(): IWaSessionEventRepository['count'] {
    const delegate = this.prisma.waSessionEvent;
    return delegate.count.bind(delegate);
  }

  get aggregate(): IWaSessionEventRepository['aggregate'] {
    const delegate = this.prisma.waSessionEvent;
    return delegate.aggregate.bind(delegate);
  }

  get groupBy(): IWaSessionEventRepository['groupBy'] {
    const delegate = this.prisma.waSessionEvent;
    return delegate.groupBy.bind(delegate);
  }

  async findById(id: string): Promise<WaSessionEvent | null> {
    return this.prisma.waSessionEvent.findUnique({ where: { id } });
  }

  async exists(where: Prisma.WaSessionEventWhereInput): Promise<boolean> {
    const record = await this.prisma.waSessionEvent.findFirst({
      where,
      select: { id: true },
    });
    return record !== null;
  }
}
