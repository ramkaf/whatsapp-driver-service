import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, WhatsappMessageOutbox } from '@database/client.js';

import { PrismaService } from '../../../prisma.service.ts';
import type { IOutboxRepository } from './outbox.repository.interface.ts';

@Injectable()
export class OutboxRepository implements IOutboxRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  get findUnique(): IOutboxRepository['findUnique'] {
    const delegate = this.prisma.whatsappMessageOutbox;
    return delegate.findUnique.bind(delegate);
  }

  get findUniqueOrThrow(): IOutboxRepository['findUniqueOrThrow'] {
    const delegate = this.prisma.whatsappMessageOutbox;
    return delegate.findUniqueOrThrow.bind(delegate);
  }

  get findFirst(): IOutboxRepository['findFirst'] {
    const delegate = this.prisma.whatsappMessageOutbox;
    return delegate.findFirst.bind(delegate);
  }

  get findFirstOrThrow(): IOutboxRepository['findFirstOrThrow'] {
    const delegate = this.prisma.whatsappMessageOutbox;
    return delegate.findFirstOrThrow.bind(delegate);
  }

  get findMany(): IOutboxRepository['findMany'] {
    const delegate = this.prisma.whatsappMessageOutbox;
    return delegate.findMany.bind(delegate);
  }

  get create(): IOutboxRepository['create'] {
    const delegate = this.prisma.whatsappMessageOutbox;
    return delegate.create.bind(delegate);
  }

  get createMany(): IOutboxRepository['createMany'] {
    const delegate = this.prisma.whatsappMessageOutbox;
    return delegate.createMany.bind(delegate);
  }

  get update(): IOutboxRepository['update'] {
    const delegate = this.prisma.whatsappMessageOutbox;
    return delegate.update.bind(delegate);
  }

  get updateMany(): IOutboxRepository['updateMany'] {
    const delegate = this.prisma.whatsappMessageOutbox;
    return delegate.updateMany.bind(delegate);
  }

  get upsert(): IOutboxRepository['upsert'] {
    const delegate = this.prisma.whatsappMessageOutbox;
    return delegate.upsert.bind(delegate);
  }

  get delete(): IOutboxRepository['delete'] {
    const delegate = this.prisma.whatsappMessageOutbox;
    return delegate.delete.bind(delegate);
  }

  get deleteMany(): IOutboxRepository['deleteMany'] {
    const delegate = this.prisma.whatsappMessageOutbox;
    return delegate.deleteMany.bind(delegate);
  }

  get count(): IOutboxRepository['count'] {
    const delegate = this.prisma.whatsappMessageOutbox;
    return delegate.count.bind(delegate);
  }

  get aggregate(): IOutboxRepository['aggregate'] {
    const delegate = this.prisma.whatsappMessageOutbox;
    return delegate.aggregate.bind(delegate);
  }

  get groupBy(): IOutboxRepository['groupBy'] {
    const delegate = this.prisma.whatsappMessageOutbox;
    return delegate.groupBy.bind(delegate);
  }

  async findById(id: string): Promise<WhatsappMessageOutbox | null> {
    return this.prisma.whatsappMessageOutbox.findUnique({ where: { id } });
  }

  async exists(
    where: Prisma.WhatsappMessageOutboxWhereInput,
  ): Promise<boolean> {
    const record = await this.prisma.whatsappMessageOutbox.findFirst({
      where,
      select: { id: true },
    });
    return record !== null;
  }
}
