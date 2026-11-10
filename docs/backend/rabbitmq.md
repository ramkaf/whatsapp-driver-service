# ماژول RabbitMQ با topology مشترک JSON

ماژول از `@libs/common` در دسترس است. هر میکروسرویس یک بار `RabbitMQModule` را ثبت می‌کند و یک نسخه یکسان از فایل مشترک `config/rabbitmq.topology.json` را در اختیار دارد. MySQL، ORM، جدول topology و مالکیت منابع در این طراحی وجود ندارند.

## شروع خودکار

در `src/app.module.ts`، ماژول با `forRootAsync` ثبت شده است. هنگام شروع برنامه، NestJS متد `onApplicationBootstrap` سرویس را اجرا می‌کند و آن متد `initialize()` را صدا می‌زند. این کار پیش از پذیرش درخواست‌ها توسط برنامه انجام می‌شود؛ فراخوانی دستی در `main.ts` لازم نیست. `app.enableShutdownHooks()` نیز برای آزادسازی منابع هنگام خاموش‌شدن فعال است.

```ts
RabbitMQModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    url: config.get('RABBITMQ_URL', 'amqp://localhost:5672?heartbeat=30'),
    topologyPath: config.get('RABBITMQ_TOPOLOGY_PATH', 'config/rabbitmq.topology.json'),
  }),
});
```

ابتدا کل JSON خوانده و اعتبارسنجی می‌شود. سپس اتصال و کانال‌ها ساخته می‌شوند و به‌ترتیب exchangeها، صف‌ها و bindingها آماده می‌شوند. موجودبودن ساختار با تنظیمات یکسان مشکلی ایجاد نمی‌کند؛ اجرای هم‌زمان چند میکروسرویس منابع تکراری نمی‌سازد. تنظیمات ناسازگار خطا می‌دهند و باعث حذف یا جایگزینی صف موجود نمی‌شوند. فقط مصرف‌کننده‌هایی که خود سرویس ثبت می‌کند فعال می‌شوند، نه مصرف‌کننده تمام صف‌های فایل.

## فایل مشترک

```json
{
  "exchanges": [
    { "name": "users", "type": "direct", "durable": true }
  ],
  "queues": [
    { "name": "sms", "durable": true }
  ],
  "bindings": [
    { "queue": "sms", "exchange": "users", "routingKey": "user.registered" }
  ]
}
```

در این مرحله پروژه برای صف `sms` آماده شده است: انتشار در exchange به نام `users` با routingKey برابر `user.registered` به این صف می‌رسد. ارسال مستقیم با `send('sms', ...)` نیز ممکن است. مصرف‌کننده در مرحله بعد ثبت می‌شود.

این نام‌ها نمونه‌اند؛ فایل را بر اساس صف‌ها و exchangeهای واقعی تنظیم کنید. هر binding باید به صف و exchange موجود در همین فایل اشاره کند. تعریف‌های تکراری یکسان ادغام می‌شوند؛ یک نام با دو تنظیم متفاوت رد می‌شود. هویت binding شامل صف، exchange، routingKey و arguments است و ترتیب کلیدهای arguments اثری بر آن ندارد. فیلدهای ناشناخته و نوع نامعتبر تنظیمات هم رد می‌شوند.

مسیر نسبی فایل نسبت به working directory برنامه محاسبه می‌شود. هنگام deploy فایل را همراه برنامه در مسیر `config/` کپی کنید یا یک فایل مشترک فقط‌خواندنی mount و مسیر مطلق آن را در `RABBITMQ_TOPOLOGY_PATH` تنظیم کنید. build به‌تنهایی فایل خارجی را داخل bundle قرار نمی‌دهد.

هر نمونه برنامه فایل را یک بار می‌خواند و هنگام reconnect همان snapshot را اعمال می‌کند. تغییر JSON با restart/deploy هماهنگ سرویس‌ها فعال می‌شود؛ hot reload و نوشتن runtime روی فایل نداریم. حذف یک تعریف از JSON، منابع یا پیام‌های موجود در RabbitMQ را خودکار حذف نمی‌کند؛ حذف منابع قدیمی باید جدا و برنامه‌ریزی‌شده انجام شود.

## فایل‌ها و متدها

| فایل | مسئولیت و متدها |
| --- | --- |
| `config/rabbitmq.topology.json` | تعریف مشترک exchangeها، صف‌ها و bindingها |
| `rabbitmq.module.ts` | ثبت provider مشترک NestJS: `forRoot` و `forRootAsync` |
| `rabbitmq.service.ts` | `initialize`، `send`، `publish`، `consume`، `stopConsumer`، `request`، `handleRequest` و `close`؛ hookهای خودکار شروع و خاموش‌شدن |
| `connection/rabbitmq-connection.manager.ts` | اتصال مشترک، اجرای topology و بازیابی اتصال؛ `connected`، `beginShutdown` و `close` |
| `channel/rabbitmq-channel.manager.ts` | ساخت کانال‌های کنترل، انتشار و دریافت؛ `createSession` و `create` |
| `messaging/rabbitmq.publisher.ts` | ارسال پیام، تأیید RabbitMQ و کنترل فشار ارسال؛ `publish` و `flush` |
| `messaging/rabbitmq-consumer.manager.ts` | ثبت و بازیابی مصرف‌کننده، ack و requeue؛ `consume`، `stopConsumer` و `close` |
| `rpc/rabbitmq-rpc.manager.ts` | صف پاسخ موقت، تطبیق پاسخ با درخواست و timeout؛ `request`، `handleRequest` و `close` |
| `topology/topology.loader.ts` | خواندن فایل JSON با `readTopology` |
| `topology/topology.validation.ts` | اعتبارسنجی با `normalize` و محاسبه هویت تعریف‌ها |
| `tracing/elastic-trace.adapter.ts` | `ElasticTraceAdapter`: متدهای `inject`، `run` و `captureError` |
| `common/interface/` | هر interface در فایل مستقل با پسوند `.interface.ts`؛ قراردادهای عمومی از `index.ts` صادر می‌شوند و interfaceهای داخلی اتصال و درخواست‌های معلق فقط داخل ماژول استفاده می‌شوند |
| `common/type/` | فقط type aliasهای `Headers` و `MessageHandler`، هرکدام در یک فایل مستقل |
| `common/error/rabbitmq.error.ts` | خطاهای `RabbitMQError`، `RpcRemoteError` و `RpcPublicError` |
| `common/helper/async.helper.ts` | کنترل مهلت عملیات با `within` و اعتبارسنجی عدد مثبت با `positive` |
| `index.ts` | exportهای عمومی ماژول |

کلاس‌های manager داخلی هستند؛ میکروسرویس‌ها همچنان فقط از `RabbitMQService` استفاده می‌کنند. سرویس اصلی متدهای عمومی و ترتیب شروع و خاموش‌شدن را هماهنگ می‌کند.

متدهای ساخت runtime یعنی `ensureQueue`، `ensureExchange`، `bindQueue`، `unbindQueue` و `provisionQueue` حذف شده‌اند؛ تغییر ساختار از طریق فایل انجام می‌شود. صف پاسخ خصوصی RPC همچنان موقت است و خودکار ساخته می‌شود؛ در فایل مشترک تعریف نمی‌شود.

## ارسال و دریافت

```ts
await rabbit.publish('users', 'user.registered', outboxRow.payload, {
  messageId: outboxRow.id,
  headers: outboxRow.headers,
});

await rabbit.consume('sms', async (payload, context) => {
  await inbox.saveOnce(context.messageId, payload, context.headers);
}, { id: 'sms-inbox', prefetch: 10, requeueDelayMs: 5000 });
```

Inbox و Outbox متعلق به خود میکروسرویس‌اند. انتشار فقط پس از تأیید broker موفق می‌شود؛ پیام خودکار دوباره منتشر نمی‌شود. خطا یا timeout ممکن است نتیجه انتشار را نامشخص کند و retry آن با Outbox است. `messageId` موجود حفظ می‌شود و فقط در نبود آن شناسه ساخته می‌شود.

موفقیت handler دریافت باعث ack می‌شود؛ بنابراین ثبت قطعی Inbox باید پیش از بازگشت handler انجام شود. در خطای handler، JSON خراب یا نبود `messageId`، پیام بعد از فاصله تنظیم‌شده requeue می‌شود. رسیدگی به پیام نامعتبر و retry کسب‌وکار مسئولیت سرویس است.

انتشار پیش‌فرض `mandatory: true` است و مقصد ناموجود خطای `UNROUTABLE` می‌دهد. برای رویدادی که ممکن است شنونده‌ای نداشته باشد می‌توانید `mandatory: false` بدهید. ارسال و دریافت، صف ناشناخته نمی‌سازند.

## RPC

مثال زیر مستقل از topology فعلی پیامک است؛ برای اجرای آن باید صف `inventory.check` را به JSON مشترک اضافه کنید.

```ts
await rabbit.handleRequest<{ productId: string }, { available: number }>(
  'inventory.check',
  async data => ({ available: await inventory.getStock(data.productId) }),
);
const result = await rabbit.request<{ available: number }>(
  'inventory.check', { productId: '123' }, { timeoutMs: 5000 },
);
```

مقصد درخواست می‌تواند نام صف یا `{ exchange, routingKey }` باشد. ماژول correlationId، صف پاسخ خصوصی و پاک‌سازی درخواست‌های معلق را مدیریت می‌کند. پاسخ دیررس یا تکراری نادیده گرفته می‌شود. مهلت درخواست شامل آماده‌سازی و انتشار است؛ تمام‌شدن آن کار در حال اجرای سرویس مقابل را لغو نمی‌کند. مسیر RPC باید به یک صف پاسخ‌دهنده برسد.

خطای handler به پاسخ عمومی تبدیل می‌شود؛ فقط پیام `RpcPublicError` برای فراخواننده قابل نمایش است. قطع ارتباط می‌تواند بازتحویل درخواست ایجاد کند؛ عملیات تغییردهنده به idempotency سرویس نیاز دارند.

## APM، اتصال و محدودیت‌ها

اتصال در هر نمونه برنامه مشترک است. انتشار از کانال confirm و هر consumer از کانال خودش استفاده می‌کند. reconnect با تأخیر افزایشی و jitter انجام می‌شود و topology و مصرف‌کننده‌های ثبت‌شده را بازیابی می‌کند.

agent موجود Elastic APM دوباره start نمی‌شود. `traceparent`، `tracestate`، `baggage` و headerهای سفارشی منتقل می‌شوند. در نبود context شناسه معتبر ساخته می‌شود و context پیام‌های هم‌زمان جداست. برای Outbox، headerهای ردگیری را در زمان ایجاد پیام ذخیره کنید. `TraceAdapter` قابل جایگزینی است.

پیش‌فرض‌ها: اتصال و عملیات ۱۰ ثانیه، مهلت RPC پنج ثانیه، prefetch برابر ۱۰، فاصله requeue پنج ثانیه، حداکثر ۱۰۰۰ انتشار یا RPC معلق و مهلت هر مرحله shutdown ده ثانیه. فشار انتشار با `drain` کنترل می‌شود. Health check جزو این ماژول نیست.

## تست

تست‌های این ماژول در پوشه جداگانه `libs/common/src/rabbitmq/test/` قرار دارند: `rabbitmq.service.spec.ts`، `topology.spec.ts`، `tracing.spec.ts` و `rabbitmq.integration.ts`. این پوشه از build اصلی کنار گذاشته شده است.

```bash
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run test:e2e
pnpm run build
```

آزمون‌های integration فقط به RabbitMQ آزمایشی نیاز دارند:

```bash
TEST_RABBITMQ_URL='amqp://test:test@127.0.0.1:5679' pnpm run test:integration
```

با تعیین `TEST_RABBITMQ_CONTAINER`، آزمون همان کانتینر آزمایشی را restart می‌کند تا بازیابی واقعی بررسی شود. پورت host باید ثابت باشد. منابع با نام تصادفی و فایل موقت ساخته و پس از آزمون پاک می‌شوند. بدون متغیر اتصال، integration skip می‌شود.
