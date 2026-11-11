import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, WaAuthKey } from '@database/client.js';

import { PrismaService } from '../../../prisma.service.ts';
import type { IWaAuthKeyRepository } from './wa-auth-key.repository.interface.ts';

@Injectable()
export class WaAuthKeyRepository implements IWaAuthKeyRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  get findUnique(): IWaAuthKeyRepository['findUnique'] {
    const delegate = this.prisma.waAuthKey;
    return delegate.findUnique.bind(delegate);
  }

  get findUniqueOrThrow(): IWaAuthKeyRepository['findUniqueOrThrow'] {
    const delegate = this.prisma.waAuthKey;
    return delegate.findUniqueOrThrow.bind(delegate);
  }

  get findFirst(): IWaAuthKeyRepository['findFirst'] {
    const delegate = this.prisma.waAuthKey;
    return delegate.findFirst.bind(delegate);
  }

  get findFirstOrThrow(): IWaAuthKeyRepository['findFirstOrThrow'] {
    const delegate = this.prisma.waAuthKey;
    return delegate.findFirstOrThrow.bind(delegate);
  }

  get findMany(): IWaAuthKeyRepository['findMany'] {
    const delegate = this.prisma.waAuthKey;
    return delegate.findMany.bind(delegate);
  }

  get create(): IWaAuthKeyRepository['create'] {
    const delegate = this.prisma.waAuthKey;
    return delegate.create.bind(delegate);
  }

  get createMany(): IWaAuthKeyRepository['createMany'] {
    const delegate = this.prisma.waAuthKey;
    return delegate.createMany.bind(delegate);
  }

  get update(): IWaAuthKeyRepository['update'] {
    const delegate = this.prisma.waAuthKey;
    return delegate.update.bind(delegate);
  }

  get updateMany(): IWaAuthKeyRepository['updateMany'] {
    const delegate = this.prisma.waAuthKey;
    return delegate.updateMany.bind(delegate);
  }

  get upsert(): IWaAuthKeyRepository['upsert'] {
    const delegate = this.prisma.waAuthKey;
    return delegate.upsert.bind(delegate);
  }

  get delete(): IWaAuthKeyRepository['delete'] {
    const delegate = this.prisma.waAuthKey;
    return delegate.delete.bind(delegate);
  }

  get deleteMany(): IWaAuthKeyRepository['deleteMany'] {
    const delegate = this.prisma.waAuthKey;
    return delegate.deleteMany.bind(delegate);
  }

  get count(): IWaAuthKeyRepository['count'] {
    const delegate = this.prisma.waAuthKey;
    return delegate.count.bind(delegate);
  }

  get aggregate(): IWaAuthKeyRepository['aggregate'] {
    const delegate = this.prisma.waAuthKey;
    return delegate.aggregate.bind(delegate);
  }

  get groupBy(): IWaAuthKeyRepository['groupBy'] {
    const delegate = this.prisma.waAuthKey;
    return delegate.groupBy.bind(delegate);
  }

  async findById(id: string): Promise<WaAuthKey | null> {
    return this.prisma.waAuthKey.findUnique({ where: { id } });
  }

  async exists(where: Prisma.WaAuthKeyWhereInput): Promise<boolean> {
    const record = await this.prisma.waAuthKey.findFirst({
      where,
      select: { id: true },
    });
    return record !== null;
  }
}
