import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, WhatsappMessageInbox } from '@database/client.js';

import { PrismaService } from '../../../prisma.service.ts';
import type { IInboxRepository } from './inbox.repository.interface.ts';

@Injectable()
export class InboxRepository implements IInboxRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  get findUnique(): IInboxRepository['findUnique'] {
    const delegate = this.prisma.whatsappMessageInbox;
    return delegate.findUnique.bind(delegate);
  }

  get findUniqueOrThrow(): IInboxRepository['findUniqueOrThrow'] {
    const delegate = this.prisma.whatsappMessageInbox;
    return delegate.findUniqueOrThrow.bind(delegate);
  }

  get findFirst(): IInboxRepository['findFirst'] {
    const delegate = this.prisma.whatsappMessageInbox;
    return delegate.findFirst.bind(delegate);
  }

  get findFirstOrThrow(): IInboxRepository['findFirstOrThrow'] {
    const delegate = this.prisma.whatsappMessageInbox;
    return delegate.findFirstOrThrow.bind(delegate);
  }

  get findMany(): IInboxRepository['findMany'] {
    const delegate = this.prisma.whatsappMessageInbox;
    return delegate.findMany.bind(delegate);
  }

  get create(): IInboxRepository['create'] {
    const delegate = this.prisma.whatsappMessageInbox;
    return delegate.create.bind(delegate);
  }

  get createMany(): IInboxRepository['createMany'] {
    const delegate = this.prisma.whatsappMessageInbox;
    return delegate.createMany.bind(delegate);
  }

  get update(): IInboxRepository['update'] {
    const delegate = this.prisma.whatsappMessageInbox;
    return delegate.update.bind(delegate);
  }

  get updateMany(): IInboxRepository['updateMany'] {
    const delegate = this.prisma.whatsappMessageInbox;
    return delegate.updateMany.bind(delegate);
  }

  get upsert(): IInboxRepository['upsert'] {
    const delegate = this.prisma.whatsappMessageInbox;
    return delegate.upsert.bind(delegate);
  }

  get delete(): IInboxRepository['delete'] {
    const delegate = this.prisma.whatsappMessageInbox;
    return delegate.delete.bind(delegate);
  }

  get deleteMany(): IInboxRepository['deleteMany'] {
    const delegate = this.prisma.whatsappMessageInbox;
    return delegate.deleteMany.bind(delegate);
  }

  get count(): IInboxRepository['count'] {
    const delegate = this.prisma.whatsappMessageInbox;
    return delegate.count.bind(delegate);
  }

  get aggregate(): IInboxRepository['aggregate'] {
    const delegate = this.prisma.whatsappMessageInbox;
    return delegate.aggregate.bind(delegate);
  }

  get groupBy(): IInboxRepository['groupBy'] {
    const delegate = this.prisma.whatsappMessageInbox;
    return delegate.groupBy.bind(delegate);
  }

  async findById(id: string): Promise<WhatsappMessageInbox | null> {
    return this.prisma.whatsappMessageInbox.findUnique({ where: { id } });
  }

  async findByKey(key: string): Promise<WhatsappMessageInbox | null> {
    return this.prisma.whatsappMessageInbox.findUnique({ where: { key } });
  }

  async updateStatus(
    id: string,
    status: WhatsappMessageInbox['status'],
  ): Promise<WhatsappMessageInbox> {
    return this.prisma.whatsappMessageInbox.update({
      where: { id },
      data: { status },
    });
  }

  async updateMediaStatus(
    id: string,
    mediaStatus: WhatsappMessageInbox['mediaStatus'],
  ): Promise<WhatsappMessageInbox> {
    return this.prisma.whatsappMessageInbox.update({
      where: { id },
      data: { mediaStatus },
    });
  }

  async exists(where: Prisma.WhatsappMessageInboxWhereInput): Promise<boolean> {
    const record = await this.prisma.whatsappMessageInbox.findFirst({
      where,
      select: { id: true },
    });
    return record !== null;
  }
}
