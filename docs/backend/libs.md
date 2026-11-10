# کتابخانه‌های مشترک (`libs`)

پوشهٔ `libs` کدهای عمومی و قابل استفادهٔ مجدد را از منطق اختصاصی سرویس جدا می‌کند. در حال حاضر سه library در پروژه وجود دارد:

```text
libs/
├── common/
├── interface/
└── prisma/
```

## `libs/common`

این library زیرساخت مشترک برنامه را نگه می‌دارد و از مسیر `@libs/common` قابل import است.

### پیکربندی برنامه

مسیر `libs/common/src/config` شامل موارد زیر است:

- `AppConfigModule`: ثبت سراسری `ConfigModule` در NestJS.
- `configuer`: ساخت تنظیمات برنامه با کلید `app`.
- `config.validation`: اعتبارسنجی متغیرهای محیطی.
- `config.interface`: نوع `IAppConfig`.
- `config.enum`: مقادیر محیط اجرای برنامه.
- `afra-logger-configuer`: تنظیمات APM logger از متغیرهای محیطی.

متغیرهای اصلی در `.env.example` مستند شده‌اند. مقدار پورت به‌ترتیب از `APP_PORT`، سپس `PORT` و در نهایت `3000` خوانده می‌شود. پیشوند API با `API_PREFIX` کنترل می‌شود.

نمونهٔ استفاده:

```ts
import { AppConfigModule } from '@libs/common';
import { configuer } from '@libs/common';

@Module({ imports: [AppConfigModule] })
export class AppModule {}

const config = app.get(configuer.KEY);
```

### Logger

مسیر `libs/common/src/logger` شامل `AfraLogger`، راه‌اندازی logger و exportهای مربوط به آن است. در `src/main.ts` قبل از ساخت Nest application، `InitAfraLogger()` اجرا می‌شود و سپس logger به Nest داده می‌شود.

تنظیمات اتصال APM و RabbitMQ باید با environment هر پروژه کنترل شوند. secretها نباید در Git commit شوند.

### RabbitMQ

ماژول مشترک ارسال و دریافت Simple و RPC، با topology ثابت در فایل JSON مشترک و راه‌اندازی خودکار هنگام شروع هر میکروسرویس، در `libs/common/src/rabbitmq` قرار دارد. [راهنمای ثبت ماژول، JSON و مثال‌ها](rabbitmq.md) را ببینید.

### helper و proxy

این مسیرها برای helperهای عمومی و proxyهای مشترک رزرو شده‌اند. کد اختصاصی domain را در این بخش قرار ندهید؛ اگر کدی فقط برای یک سرویس لازم است، آن را در `src` همان سرویس نگه دارید.

## `libs/interface`

این library محل قراردادهای TypeScript مشترک بین بخش‌های پروژه است؛ مانند typeها، interfaceها و قرارداد پیام‌ها. قراردادهای عمومی را اینجا قرار دهید تا مصرف‌کننده‌ها از یک تعریف واحد استفاده کنند.

## `libs/prisma`

این library از مسیر `@libs/prisma` قابل import است و اتصال مشترک دیتابیس را با `PrismaService` و `PrismaModule` فراهم می‌کند. پوشهٔ `repositories` برای قراردادها، توکن‌های تزریق و Repositoryهای هر جدول در نظر گرفته شده است؛ هر جدول فولدر مستقل خودش را دارد و اتصال توکن به پیاده‌سازی در `RepositoriesModule` ثبت می‌شود.

راهنمای [Prisma و الگوی Repository](prisma.md) تنظیمات اتصال، تولید کلاینت، نمونهٔ کامل `Case` و نحوهٔ استفاده در سرویس دامنه را توضیح می‌دهد. کدهای آن نمونه هستند؛ در وضعیت فعلی فقط اسکلت ماژول Repositoryها در سورس وجود دارد.

## قواعد توسعهٔ libraryها

هر library باید از `index.ts` export عمومی داشته باشد و import مستقیم از فایل‌های داخلی آن تا حد ممکن انجام نشود. بعد از تغییر library، این بررسی‌ها را اجرا کنید:

```bash
pnpm run lint
pnpm run typecheck
pnpm run build
pnpm test
```

تغییر عمومی در `libs` ابتدا در boilerplate commit و push می‌شود. پروژه‌های مشتق‌شده آن را از `upstream` دریافت می‌کنند؛ بنابراین تغییرات breaking باید همراه با توضیح مهاجرت و افزایش نسخهٔ boilerplate ارائه شوند.
