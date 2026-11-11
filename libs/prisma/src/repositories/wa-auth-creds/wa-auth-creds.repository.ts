import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, WaAuthCreds } from '@database/client.js';

import { PrismaService } from '../../../prisma.service.ts';
import type { IWaAuthCredsRepository } from './wa-auth-creds.repository.interface.ts';

@Injectable()
export class WaAuthCredsRepository implements IWaAuthCredsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  get findUnique(): IWaAuthCredsRepository['findUnique'] {
    const delegate = this.prisma.waAuthCreds;
    return delegate.findUnique.bind(delegate);
  }

  get findUniqueOrThrow(): IWaAuthCredsRepository['findUniqueOrThrow'] {
    const delegate = this.prisma.waAuthCreds;
    return delegate.findUniqueOrThrow.bind(delegate);
  }

  get findFirst(): IWaAuthCredsRepository['findFirst'] {
    const delegate = this.prisma.waAuthCreds;
    return delegate.findFirst.bind(delegate);
  }

  get findFirstOrThrow(): IWaAuthCredsRepository['findFirstOrThrow'] {
    const delegate = this.prisma.waAuthCreds;
    return delegate.findFirstOrThrow.bind(delegate);
  }

  get findMany(): IWaAuthCredsRepository['findMany'] {
    const delegate = this.prisma.waAuthCreds;
    return delegate.findMany.bind(delegate);
  }

  get create(): IWaAuthCredsRepository['create'] {
    const delegate = this.prisma.waAuthCreds;
    return delegate.create.bind(delegate);
  }

  get createMany(): IWaAuthCredsRepository['createMany'] {
    const delegate = this.prisma.waAuthCreds;
    return delegate.createMany.bind(delegate);
  }

  get update(): IWaAuthCredsRepository['update'] {
    const delegate = this.prisma.waAuthCreds;
    return delegate.update.bind(delegate);
  }

  get updateMany(): IWaAuthCredsRepository['updateMany'] {
    const delegate = this.prisma.waAuthCreds;
    return delegate.updateMany.bind(delegate);
  }

  get upsert(): IWaAuthCredsRepository['upsert'] {
    const delegate = this.prisma.waAuthCreds;
    return delegate.upsert.bind(delegate);
  }

  get delete(): IWaAuthCredsRepository['delete'] {
    const delegate = this.prisma.waAuthCreds;
    return delegate.delete.bind(delegate);
  }

  get deleteMany(): IWaAuthCredsRepository['deleteMany'] {
    const delegate = this.prisma.waAuthCreds;
    return delegate.deleteMany.bind(delegate);
  }

  get count(): IWaAuthCredsRepository['count'] {
    const delegate = this.prisma.waAuthCreds;
    return delegate.count.bind(delegate);
  }

  get aggregate(): IWaAuthCredsRepository['aggregate'] {
    const delegate = this.prisma.waAuthCreds;
    return delegate.aggregate.bind(delegate);
  }

  get groupBy(): IWaAuthCredsRepository['groupBy'] {
    const delegate = this.prisma.waAuthCreds;
    return delegate.groupBy.bind(delegate);
  }

  async findById(id: string): Promise<WaAuthCreds | null> {
    return this.prisma.waAuthCreds.findUnique({ where: { id } });
  }

  async exists(where: Prisma.WaAuthCredsWhereInput): Promise<boolean> {
    const record = await this.prisma.waAuthCreds.findFirst({
      where,
      select: { id: true },
    });
    return record !== null;
  }
}
