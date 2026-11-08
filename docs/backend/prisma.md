# Prisma و الگوی Repository در بک‌اند

این راهنما برای Prisma ORM نسخهٔ `7.10.1` و ساختار فعلی همین پروژه نوشته شده است. دیتابیس با provider برابر `mysql` و آداپتر `@prisma/adapter-mariadb` استفاده می‌شود.

کدهای این صفحه نمونهٔ پیاده‌سازی هستند. در حال حاضر `PrismaService`، `PrismaModule` و اسکلت `RepositoriesModule` در پروژه وجود دارند، اما Repository مربوط به `Case` ساخته نشده و `RepositoriesModule` نیز در `AppModule` ثبت نشده است. برای اجرای این الگو باید نمونه‌ها در فایل‌های مشخص‌شده قرار بگیرند؛ اضافه‌شدن این مستند به‌تنهایی رفتار برنامه را تغییر نمی‌دهد.

## اتصال به دیتابیس و تولید کلاینت

تنظیمات اتصال در `libs/common/src/config/db/database.env.ts` خوانده می‌شوند:

| متغیر                 | کاربرد                                               |
| --------------------- | ---------------------------------------------------- |
| `DB_HOST`             | آدرس دیتابیس                                         |
| `DB_PORT`             | پورت دیتابیس                                         |
| `DB_USER`             | نام کاربری                                           |
| `DB_PASSWORD`         | رمز عبور؛ در تنظیمات فعلی مقدار خالی پذیرفته نمی‌شود |
| `DB_NAME`             | نام دیتابیس                                          |
| `DB_CONNECTION_LIMIT` | حداکثر اتصال‌های pool؛ پیش‌فرض `10`                  |

`prisma.config.ts` برای فرمان‌های Prisma از همین تنظیمات URL می‌سازد. هنگام اجرای برنامه، `AppConfigModule` تنظیمات را با کلید `database` ثبت می‌کند و `PrismaService` آن‌ها را به `PrismaMariaDb` می‌دهد. سرویس هنگام راه‌اندازی اتصال و یک کوئری ساده را بررسی می‌کند و هنگام پایان برنامه اتصال‌ها را می‌بندد. هر Repository همان `PrismaService` را دریافت می‌کند؛ داخل Repository کلاینت یا اتصال جدید نسازید.

فرمان‌های پروژه را از ریشه اجرا کنید:

```bash
pnpm run db:pull
pnpm run db:validate
```

`db:pull` ابتدا ساختار دیتابیس انتخاب‌شده را در `prisma/schema.prisma` می‌خواند و سپس `prisma generate` را اجرا می‌کند. بعد از آن تغییرات schema را بازبینی کنید. این فرمان ساختار دیتابیس را تغییر نمی‌دهد، اما فایل‌های schema، کلاینت تولیدشده و تعریف Viewها را به‌روزرسانی می‌کند. اگر فقط به تولید مجدد کلاینت از schema موجود نیاز دارید:

```bash
pnpm run db:generate
```

کلاینت در `prisma/generated/prisma` تولید می‌شود و alias آن در `tsconfig.json` برابر `@database/*` است. مطابق import فعلی `PrismaService`، در نمونه‌ها از `@database/client.js` استفاده می‌کنیم؛ TypeScript با تنظیم `NodeNext` آن را به سورس `client.ts` مرتبط می‌کند. importهای نسبی سورس مطابق قرارداد موجود پروژه پسوند `.ts` دارند. alias مربوط به `@generated` در این پروژه تعریف نشده است.

فایل‌های داخل `prisma/generated/prisma` را دستی ویرایش نکنید. `db:pull` و `generate` نیز interface یا Repository برنامه را تولید نمی‌کنند؛ این بخش‌ها دستی نوشته می‌شوند.

## ساختار Repositoryها

نام پوشه در پروژه `repositories` است. برای هر جدولی که برنامه به آن دسترسی دارد، یک فولدر جدا با نام kebab-case بسازید؛ مثلاً `Case` در `case` و `CaseAccountingRequest` در `case-accounting-request` قرار می‌گیرد.

ساختار هدف پس از اضافه‌کردن نمونهٔ `Case`:

```text
libs/prisma/src/
├── index.ts
├── prisma.module.ts
├── prisma.service.ts
└── repositories/
    ├── index.ts
    ├── repositories.module.ts
    └── case/
        ├── index.ts
        ├── case.repository.interface.ts
        └── case.repository.ts
```

| بخش                            | مسئولیت                                                   |
| ------------------------------ | --------------------------------------------------------- |
| `case.repository.interface.ts` | قرارداد متدها، نوع ورودی‌ها و توکن تزریق                  |
| `case.repository.ts`           | اجرای کوئری‌ها و عملیات اتمیک مرتبط با پرونده             |
| `case/index.ts`                | export عمومی Repository و قرارداد آن                      |
| `repositories.module.ts`       | اتصال توکن هر قرارداد به کلاس پیاده‌سازی و export توکن‌ها |
| سرویس دامنه                    | اعتبارسنجی ورودی، مجوزها و قواعد گردش کار                 |

سرویس دامنه از interface و توکن استفاده می‌کند و برای دسترسی به داده، Repository را صدا می‌زند. نام فیلدهای رابطه مانند `CaseParticipant` و `CaseMessage` از schema فعلی آمده‌اند و باید دقیقاً با کلاینت تولیدشده منطبق باشند.

## ۱. قرارداد و توکن `Case`

فایل هدف: `libs/prisma/src/repositories/case/case.repository.interface.ts`

```ts
import type { Case, Prisma } from '@database/client.js';

export const CASE_REPOSITORY = Symbol('CASE_REPOSITORY');

export interface ICaseFindManyOptions {
  where?: Prisma.CaseWhereInput;
  skip?: number;
  take?: number;
  orderBy?:
    Prisma.CaseOrderByWithRelationInput | Prisma.CaseOrderByWithRelationInput[];
}

export interface ICaseCreateAggregateInput {
  caseData: Prisma.CaseUncheckedCreateInput;
  participant: Prisma.CaseParticipantUncheckedCreateWithoutCaseInput;
  messages: Prisma.CaseMessageUncheckedCreateWithoutCaseInput[];
}

export interface ICaseApproveRevisionInput {
  caseId: bigint;
  revisionId: bigint;
  decidedBy: bigint;
  comment?: string;
}

export interface ICaseRepository {
  findById(id: bigint): Promise<Case | null>;
  findByCaseNumber(caseNumber: string): Promise<Case | null>;
  findMany(options?: ICaseFindManyOptions): Promise<Case[]>;
  create(data: Prisma.CaseUncheckedCreateInput): Promise<Case>;
  createAggregate(input: ICaseCreateAggregateInput): Promise<Case>;
  update(id: bigint, data: Prisma.CaseUncheckedUpdateInput): Promise<Case>;
  updateStatus(id: bigint, status: Case['status']): Promise<Case>;
  delete(id: bigint): Promise<Case>;
  approveRevision(input: ICaseApproveRevisionInput): Promise<Case>;
  count(where?: Prisma.CaseWhereInput): Promise<number>;
  exists(where: Prisma.CaseWhereInput): Promise<boolean>;
}
```

interface فقط در زمان بررسی نوع وجود دارد؛ NestJS برای تزریق در زمان اجرا به `CASE_REPOSITORY` نیاز دارد. توکن را فقط یک بار در همین فایل تعریف و در مصرف‌کننده‌ها import کنید؛ ساختن دوبارهٔ `Symbol('CASE_REPOSITORY')` توکن متفاوتی می‌سازد.

نوع `Case['status']` در قرارداد و پیاده‌سازی یکسان است و فقط مقدار وضعیت می‌پذیرد. `Prisma.CaseUpdateInput['status']` علاوه بر مقدار وضعیت، ساختار عملیات به‌روزرسانی را هم می‌پذیرد و برای قرارداد سادهٔ `updateStatus` لازم نیست.

نوع‌های `Unchecked` امکان مقداردهی مستقیم شناسه‌های خارجی را می‌دهند. این‌ها قرارداد داخلی لایهٔ داده هستند؛ بدنهٔ درخواست HTTP را بدون اعتبارسنجی، کنترل مجوز و انتخاب فیلدهای مجاز به `create` یا `update` ندهید.

## ۲. پیاده‌سازی `CaseRepository`

فایل هدف: `libs/prisma/src/repositories/case/case.repository.ts`

```ts
import { Injectable } from '@nestjs/common';
import type { Case, Prisma } from '@database/client.js';

import { PrismaService } from '../../prisma.service.ts';
import type {
  ICaseApproveRevisionInput,
  ICaseCreateAggregateInput,
  ICaseFindManyOptions,
  ICaseRepository,
} from './case.repository.interface.ts';

@Injectable()
export class CaseRepository implements ICaseRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: bigint): Promise<Case | null> {
    return this.prisma.case.findUnique({ where: { id } });
  }

  async findByCaseNumber(caseNumber: string): Promise<Case | null> {
    return this.prisma.case.findUnique({ where: { caseNumber } });
  }

  async findMany(options: ICaseFindManyOptions = {}): Promise<Case[]> {
    const { where, skip, take, orderBy } = options;
    return this.prisma.case.findMany({ where, skip, take, orderBy });
  }

  async create(data: Prisma.CaseUncheckedCreateInput): Promise<Case> {
    return this.prisma.case.create({ data });
  }

  async createAggregate(input: ICaseCreateAggregateInput): Promise<Case> {
    return this.prisma.case.create({
      data: {
        ...input.caseData,
        CaseParticipant: { create: input.participant },
        CaseMessage: { create: input.messages },
      },
    });
  }

  async update(
    id: bigint,
    data: Prisma.CaseUncheckedUpdateInput,
  ): Promise<Case> {
    return this.prisma.case.update({ where: { id }, data });
  }

  async updateStatus(id: bigint, status: Case['status']): Promise<Case> {
    return this.prisma.case.update({ where: { id }, data: { status } });
  }

  async delete(id: bigint): Promise<Case> {
    return this.prisma.case.delete({ where: { id } });
  }

  async approveRevision(input: ICaseApproveRevisionInput): Promise<Case> {
    return this.prisma.$transaction(async (tx) => {
      await tx.caseRevision.findUniqueOrThrow({
        where: {
          caseId_id: { caseId: input.caseId, id: input.revisionId },
        },
      });

      await tx.caseApproval.create({
        data: {
          caseId: input.caseId,
          revisionId: input.revisionId,
          decidedBy: input.decidedBy,
          decision: 'APPROVED',
          comment: input.comment,
        },
      });

      return tx.case.update({
        where: { id: input.caseId },
        data: { status: 'APPROVED', currentRevisionId: input.revisionId },
      });
    });
  }

  async count(where?: Prisma.CaseWhereInput): Promise<number> {
    return this.prisma.case.count({ where });
  }

  async exists(where: Prisma.CaseWhereInput): Promise<boolean> {
    const record = await this.prisma.case.findFirst({
      where,
      select: { id: true },
    });
    return record !== null;
  }
}
```

در این نمونه `Logger` استفاده‌نشده و import زمان اجرای `Prisma` حذف شده‌اند. تمام importهای صرفاً مربوط به نوع با `import type` نوشته شده‌اند. برای `exists` نیز فقط شناسهٔ اولین رکورد خوانده می‌شود.

`createAggregate` پرونده، مشارکت‌کننده و پیام‌ها را با nested write ایجاد می‌کند. این عملیات خودش اتمیک است و به `$transaction` اضافی دور یک `create` نیاز ندارد. در `caseData` این متد فیلدهای خود پرونده را بفرستید؛ رابطه‌های مشارکت‌کننده و پیام‌ها از ورودی‌های جدا ساخته می‌شوند.

`approveRevision` چند عملیات وابسته دارد؛ به همین دلیل از transaction استفاده می‌کند. ابتدا تعلق revision به پرونده با کلید ترکیبی موجود در schema بررسی می‌شود، سپس تأیید و وضعیت پرونده با هم ثبت می‌شوند. اگر یکی از عملیات خطا بدهد، تغییرات این transaction برگشت می‌خورند. داخل آن از `tx` استفاده کنید و عملیات شبکه یا AI انجام ندهید. [مرجع transaction و nested write](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions)

این متد نمونهٔ ثبت اتمیک داده است؛ مجوز تأییدکننده، وضعیت مجاز پرونده، جلوگیری از تأیید تکراری و سیاست رقابت درخواست‌ها باید مطابق نیاز دامنه طراحی شوند. `updateStatus` هم به‌تنهایی چرخهٔ وضعیت‌ها را اعتبارسنجی نمی‌کند.

رفتار متدها:

- `findById` و `findByCaseNumber` در صورت نبودن رکورد `null` می‌دهند؛ سرویس دامنه تصمیم می‌گیرد پاسخ مناسب چیست.
- `update` و `delete` در صورت نبودن رکورد خطا می‌دهند؛ حذف پرونده دارای وابستگی نیز ممکن است با محدودیت کلید خارجی مواجه شود.
- `create` و `createAggregate` فقط فیلدهای خود `Case` را برمی‌گردانند؛ برای خروجی شامل رابطه‌ها باید `include` و نوع خروجی مناسب تعریف شود.
- ورودی `skip` و `take` را در لایهٔ درخواست اعتبارسنجی کنید و برای صفحه‌بندی، `orderBy` مشخص بدهید.
- در schema فعلی `updatedAt` دارای `@default(now())` است و `@updatedAt` ندارد؛ به‌روزرسانی خودکار آن توسط Prisma را فرض نکنید.

## ۳. exportهای عمومی

فایل هدف: `libs/prisma/src/repositories/case/index.ts`

```ts
export * from './case.repository.interface.ts';
export * from './case.repository.ts';
```

فایل هدف: `libs/prisma/src/repositories/index.ts`

```ts
export * from './case/index.ts';
export * from './repositories.module.ts';
```

فایل موجود `libs/prisma/src/index.ts` همین حالا exportهای زیر را دارد و export پوشهٔ `repositories` را در اختیار `@libs/prisma` می‌گذارد:

```ts
export * from './prisma.module.ts';
export * from './prisma.service.ts';
export * from './repositories/index.ts';
```

بنابراین مصرف‌کننده می‌تواند توکن، نوع قرارداد و ماژول را از `@libs/prisma` بگیرد و نیازی به import از مسیر داخلی پوشهٔ `case` ندارد.

## ۴. اتصال interface به Repository در ماژول

فایل هدف: `libs/prisma/src/repositories/repositories.module.ts`

```ts
import { Global, Module } from '@nestjs/common';
import { CaseRepository } from './case/case.repository.ts';
import { CASE_REPOSITORY } from './case/case.repository.interface.ts';

@Global()
@Module({
  imports: [],
  providers: [
    CaseRepository,
    { provide: CASE_REPOSITORY, useExisting: CaseRepository },
  ],
  exports: [CASE_REPOSITORY],
})
export class RepositoriesModule {}
```

در `providers` ابتدا کلاس ثبت می‌شود. سپس `useExisting` توکن `CASE_REPOSITORY` را به همان نمونهٔ ساخته‌شده از `CaseRepository` وصل می‌کند؛ نمونهٔ دوم ساخته نمی‌شود. در `exports` توکن قرار می‌گیرد تا سرویس‌های دیگر بتوانند آن را inject کنند. [مرجع provider و alias در NestJS](https://docs.nestjs.com/fundamentals/custom-providers)

برای جدول بعدی، فولدر و قرارداد خودش را بسازید و همین سه مورد را اضافه کنید: کلاس در `providers`، اتصال توکن با `useExisting` و توکن در `exports`. سپس export فولدر را در `repositories/index.ts` اضافه کنید. فهرست Repositoryهای سایر جدول‌ها از نمونه حذف شده تا import مربوط به فایل‌های ساخته‌نشده وارد راهنما نشود.

## ۵. ثبت ماژول و استفاده در سرویس دامنه

`@Global()` فقط پس از import شدن ماژول اثر دارد. اسکلت فعلی برنامه صرفاً `PrismaModule` را import می‌کند؛ برای استفاده از این نمونه باید `RepositoriesModule` یک بار در ماژول ریشه ثبت شود. چون خودش `PrismaModule` را import می‌کند، ثبت جداگانهٔ `PrismaModule` در این نمونه لازم نیست.

نمونهٔ هدف برای `src/app.module.ts` با حفظ controller و service فعلی:

```ts
import { Module } from '@nestjs/common';
import { AppConfigModule } from '@libs/common';
import { PrismaModule } from '@libs/prisma';

import { AppController } from './app.controller.ts';
import { AppService } from './app.service.ts'; 

@Module({
  imports: [AppConfigModule, PrismaModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

نمونهٔ سرویس مصرف‌کننده در `src/case/case.service.ts`:

```ts
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CASE_REPOSITORY } from '@libs/prisma';
import type { ICaseRepository } from '@libs/prisma';

@Injectable()
export class CaseService {
  constructor(
    @Inject(CASE_REPOSITORY)
    private readonly cases: ICaseRepository,
  ) {}

  async getById(id: bigint) {
    const record = await this.cases.findById(id);
    if (!record) {
      throw new NotFoundException('Case not found');
    }

    return {
      id: record.id.toString(),
      caseNumber: record.caseNumber,
      status: record.status,
    };
  }

  async getRecentDrafts() {
    const records = await this.cases.findMany({
      where: { status: 'DRAFT' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 0,
      take: 20,
    });

    return records.map((record) => ({
      id: record.id.toString(),
      caseNumber: record.caseNumber,
      status: record.status,
    }));
  }

  async createDraft(caseNumber: string, createdBy: bigint) {
    const record = await this.cases.create({
      caseNumber,
      caseType: 'EXCHANGE',
      status: 'DRAFT',
      createdBy,
    });

    return {
      id: record.id.toString(),
      caseNumber: record.caseNumber,
      status: record.status,
    };
  }
}
```

برای ثبت سرویس، فایل هدف `src/case/case.module.ts`:

```ts
import { Module } from '@nestjs/common';

import { CaseService } from './case.service.ts';

@Module({
  providers: [CaseService],
  exports: [CaseService],
})
export class CaseModule {}
```

در این الگو `CaseModule` از provider سراسری استفاده می‌کند و Repository را دوباره ثبت نمی‌کند. درخواست‌ها پس از اعتبارسنجی و تعیین کاربر مجاز وارد متدهای سرویس می‌شوند؛ `createdBy` باید از هویت کاربر احراز‌شده بیاید. شناسه‌ها در دیتابیس و Repository از نوع `bigint` هستند؛ برای پاسخ JSON آن‌ها را مانند نمونه به رشته تبدیل کنید. پارامتر متنی شناسهٔ درخواست را هم پیش از تبدیل به `BigInt` اعتبارسنجی کنید.

مسیر دسترسی به داده:

```text
Controller → CaseService
           → @Inject(CASE_REPOSITORY) + ICaseRepository
           → CaseRepository → PrismaService → MariaDB / MySQL
```

در تست سرویس دامنه نیز می‌توان به‌جای دیتابیس، یک mock را با `{ provide: CASE_REPOSITORY, useValue: mockRepository }` ثبت کرد.

## View و Stored Procedure

در generator فعلی گزینهٔ `previewFeatures = ["views"]` فعال است؛ بنابراین `db:pull` می‌تواند Viewهای دیتابیس را به بلوک `view` تبدیل کند. برای View، قرارداد خواندن تعریف کنید؛ متدهای `create`، `update` و `delete` جدول را روی آن کپی نکنید. [مرجع Viewها](https://www.prisma.io/docs/orm/v7/prisma-schema/data-model/views)

Stored Procedure مانند `proc_last_case` در `schema.prisma` نمایش داده نمی‌شود و با `db:pull` یا `generate` متد Repository برای آن ساخته نمی‌شود. در Prisma 7 تنظیم مشابه `views` برای واردکردن پروسیژر وجود ندارد. در صورت نیاز، فراخوانی SQL آن را در Repository مربوط قرار دهید و قرارداد ورودی و خروجی را جدا تعریف کنید. نحوهٔ دریافت نتیجه باید با امضای واقعی پروسیژر و رفتار آداپتر بررسی شود. [محدودیت نمایش Stored Procedure در schema](https://docs.prisma.io/docs/orm/prisma-migrate/workflows/unsupported-database-features)

## بررسی پس از پیاده‌سازی در کد

وقتی این نمونه‌ها را در سورس پروژه پیاده کردید، ابتدا کلاینت را تولید و سازگاری نوع‌ها و importها را بررسی کنید:

```bash
pnpm run db:generate
pnpm run typecheck
pnpm run lint
```

برای عملیات چندجدولی مانند `createAggregate` و `approveRevision`، تست اتصال به دیتابیس آزمایشی باید موفقیت عملیات و برگشت تغییرات هنگام خطا را پوشش دهد. تست سرویس دامنه می‌تواند از mock توکن Repository استفاده کند.
