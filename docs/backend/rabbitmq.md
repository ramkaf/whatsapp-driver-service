<div dir="rtl">

# راهنمای ماژول RabbitMQ

این ماژول اتصال، کانال‌ها، ارسال و دریافت JSON، RPC و انتقال context ردگیری را مدیریت می‌کند. مثال اصلی: سرویس Users پیامی منتشر می‌کند و سرویس SMS آن را از صف `sms` می‌گیرد و در Inbox ذخیره می‌کند.

این راهنما مطابق API فعلی پروژه است. Inbox، Outbox، retry کسب‌وکار و ارسال واقعی پیامک متعلق به خود میکروسرویس هستند. Health check و ساخت topology در زمان اجرای کسب‌وکار نداریم.

## شروع کار و init

ماژول را فقط یک بار در ماژول اصلی هر میکروسرویس ثبت کنید. provider آن global است؛ در کلاس‌های دیگر فقط `RabbitMQService` را تزریق کنید. singleton بودن اتصال در محدوده هر نمونه برنامه است، نه میان تمام میکروسرویس‌ها.

```ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfigModule, RabbitMQModule } from '@libs/common';

@Module({
  imports: [
    AppConfigModule,
    RabbitMQModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        url: config.getOrThrow<string>('RABBITMQ_URL'),
        topologyPath: config.getOrThrow<string>('RABBITMQ_TOPOLOGY_PATH'),
        prefetch: 10,
        requeueDelayMs: 5000,
        rpcTimeoutMs: 5000,
      }),
    }),
  ],
})
export class AppModule {}
```

```dotenv
RABBITMQ_URL=amqp://localhost:5672?heartbeat=30
RABBITMQ_TOPOLOGY_PATH=config/rabbitmq.topology.json
```

آدرس بالا برای توسعه محلی است. در استقرار، host، نام کاربری، رمز و vhost خود را تنظیم کنید؛ بخش‌های مخصوص URL را encode کنید. در کانتینر، `localhost` همان کانتینر است.

در `main.ts`، پیش از `app.listen(...)`، متد `app.enableShutdownHooks()` را اجرا کنید.

Nest هنگام bootstrap خودکار `initialize()` را اجرا می‌کند: ابتدا JSON خوانده و اعتبارسنجی می‌شود، سپس اتصال و کانال‌ها ساخته می‌شوند و exchangeها، صف‌ها و bindingها به همین ترتیب معرفی می‌شوند. برای این کار لازم نیست Consumer داشته باشید. خطای init باعث ردشدن bootstrap می‌شود؛ صرف ساخته‌شدن provider به معنی آماده‌شدن اتصال نیست.

### روش‌های ثبت ماژول

| متد | کاربرد |
| --- | --- |
| `RabbitMQModule.forRoot(options)` | ثبت با تنظیمات آماده؛ مثلاً `forRoot({ url, topologyPath })` |
| `RabbitMQModule.forRootAsync({ imports?, inject?, useFactory })` | ساخت تنظیمات با وابستگی‌هایی مانند ConfigService؛ factory می‌تواند async باشد |

## تمام تنظیمات ماژول

زمان‌ها بر حسب میلی‌ثانیه‌اند. گزینه‌های عددی زیر در صورت ارائه باید عدد صحیح مثبت باشند.

| گزینه | پیش‌فرض | توضیح و مثال |
| --- | --- | --- |
| `url` | ندارد؛ الزامی | آدرس AMQP؛ مثل `amqp://localhost:5672?heartbeat=30` |
| `topologyPath` | ندارد؛ الزامی | مسیر JSON؛ مثل `config/rabbitmq.topology.json` |
| `connectTimeoutMs` | `10000` | مهلت برقراری اتصال |
| `operationTimeoutMs` | `10000` | مهلت عملیات کانال و انتشار، مگر override شود |
| `reconnect.initialDelayMs` | `1000` | پایه تأخیر بازیابی اتصال |
| `reconnect.maxDelayMs` | `30000` | سقف پایه تأخیر افزایشی؛ jitter بین نصف و کل تأخیر اعمال می‌شود |
| `prefetch` | `10` | حداکثر پیام تأییدنشده برای هر consumer |
| `requeueDelayMs` | `5000` | فاصله قبل از بازگرداندن پیام شکست‌خورده به صف |
| `shutdownTimeoutMs` | `10000` | مهلت مراحل shutdown؛ مهلت کل shutdown لزوماً برابر این عدد نیست |
| `maxPendingPublishes` | `1000` | سقف انتشارهای هم‌زمان در حال انتظار |
| `maxPendingRequests` | `1000` | سقف درخواست‌های RPC معلق |
| `rpcTimeoutMs` | `5000` | مهلت پیش‌فرض RPC، شامل آماده‌سازی و انتشار |
| `trace` | `ElasticTraceAdapter` | adapter سفارشی با قرارداد `TraceAdapter` |

## فایل topology

### نمونه فعلی پیامک

این JSON کامل و قابل استفاده است:

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

انتشار `publish('users', 'user.registered', payload)` به صف `sms` می‌رسد. `users` نام exchange است؛ `sms` نام صف. ارسال مستقیم با `send('sms', payload)` نیز ممکن است.

### فیلدهای ریشه

| گزینه | پیش‌فرض | کاربرد |
| --- | --- | --- |
| `exchanges` | `[]` | آرایه تعریف exchangeها |
| `queues` | `[]` | آرایه تعریف صف‌ها |
| `bindings` | `[]` | آرایه اتصال exchange به صف |

هر سه اختیاری‌اند؛ حتی `{}` معتبر است. فیلد اضافی در ریشه یا تعریف منابع رد می‌شود. JSON باید معتبر و بدون comment باشد.

### تمام گزینه‌های exchange

| گزینه | پیش‌فرض / الزام | توضیح و مثال |
| --- | --- | --- |
| `name` | الزامی | نام، مثل `users` |
| `type` | الزامی | یکی از `direct`، `topic`، `fanout`، `headers` |
| `durable` | `true` | تعریف exchange پس از restart خود RabbitMQ باقی می‌ماند |
| `autoDelete` | `false` | حذف خودکار پس از حذف آخرین binding، برای exchangeای که قبلاً binding داشته است |
| `internal` | `false` | با `true` انتشار مستقیم client روی exchange مجاز نیست؛ برای مسیرهایی مثل `publish` معمولی روی آن فعال نکنید |
| `arguments` | `{}` | تنظیمات اضافی broker به شکل object؛ مثل `{"alternate-exchange":"unrouted"}` |

مثال کامل یک تعریف exchange؛ این قطعه را داخل آرایه `exchanges` قرار دهید:

```json
{
  "name": "users",
  "type": "direct",
  "durable": true,
  "autoDelete": false,
  "internal": false,
  "arguments": {}
}
```

### تمام گزینه‌های queue

| گزینه | پیش‌فرض / الزام | توضیح و مثال |
| --- | --- | --- |
| `name` | الزامی | نام، مثل `sms` |
| `durable` | `true` | تعریف صف پس از restart broker باقی می‌ماند |
| `autoDelete` | `false` | پس از آنکه صف مصرف‌کننده داشته، با رفتن آخرین مصرف‌کننده حذف می‌شود |
| `arguments` | `{}` | تنظیمات اختیاری broker؛ نمونه‌ها در ادامه |

مثال کامل یک تعریف صف:

```json
{
  "name": "sms",
  "durable": true,
  "autoDelete": false,
  "arguments": {}
}
```

در topology مشترک، `exclusive` قابل تنظیم نیست و ماژول آن را `false` می‌گذارد. صف پاسخ RPC جداگانه و خودکار با `exclusive: true` ساخته می‌شود. `durable` به‌تنهایی تضمین نگهداری پیام نیست؛ انتشار ماژول به صورت پیش‌فرض `persistent: true` است. توضیحات ویژگی‌های صف در [مستندات RabbitMQ](https://www.rabbitmq.com/docs/queues) آمده است.

### تمام گزینه‌های binding

| گزینه | پیش‌فرض / الزام | توضیح و مثال |
| --- | --- | --- |
| `queue` | الزامی | نام صف مقصد؛ مثل `sms` |
| `exchange` | الزامی | نام exchange مبدأ؛ مثل `users` |
| `routingKey` | الزامی | رشته؛ می‌تواند خالی باشد. مثل `user.registered` |
| `arguments` | `{}` | تنظیمات binding؛ مثلاً شرط‌های exchange از نوع headers |

```json
{
  "queue": "sms",
  "exchange": "users",
  "routingKey": "user.registered",
  "arguments": {}
}
```

صف و exchange ارجاع‌شده باید در همین JSON تعریف شده باشند. binding بین دو exchange در این ماژول تعریف نشده است.

### مثال چهار نوع exchange

این JSON مستقل چهار نوع مسیریابی را نشان می‌دهد؛ جایگزین اجباری فایل فعلی نیست:

```json
{
  "exchanges": [
    { "name": "sms.direct", "type": "direct" },
    { "name": "sms.topic", "type": "topic" },
    { "name": "sms.fanout", "type": "fanout" },
    { "name": "sms.headers", "type": "headers" }
  ],
  "queues": [
    { "name": "sms.direct.queue" },
    { "name": "sms.topic.queue" },
    { "name": "sms.fanout.queue" },
    { "name": "sms.headers.queue" }
  ],
  "bindings": [
    { "queue": "sms.direct.queue", "exchange": "sms.direct", "routingKey": "sms.send" },
    { "queue": "sms.topic.queue", "exchange": "sms.topic", "routingKey": "sms.*" },
    { "queue": "sms.fanout.queue", "exchange": "sms.fanout", "routingKey": "" },
    {
      "queue": "sms.headers.queue",
      "exchange": "sms.headers",
      "routingKey": "",
      "arguments": { "x-match": "all", "channel": "sms", "language": "fa" }
    }
  ]
}
```

- `direct`: کلید باید دقیقاً برابر `sms.send` باشد.
- `topic`: الگوی `sms.*` یک بخش بعد از نقطه را می‌پذیرد؛ `sms.#` صفر یا چند بخش را می‌پذیرد.
- `fanout`: به تمام صف‌های متصل می‌فرستد و routingKey را برای مسیریابی نادیده می‌گیرد.
- `headers`: بر اساس headerها مسیریابی می‌کند؛ `all` یعنی همه شرط‌ها و `any` یعنی حداقل یکی. نمونه ارسال: `publish('sms.headers', '', payload, { headers: { channel: 'sms', language: 'fa' } })`.

جزئیات رفتار مسیریابی در [مستندات exchange](https://www.rabbitmq.com/docs/exchanges) آمده است. انواع افزونه‌ای مثل `x-delayed-message` در validator فعلی مجاز نیستند.

### گزینه‌های arguments

`arguments` یک object باز است؛ ماژول برای کلیدهای داخل آن فهرست بسته‌ای ندارد و معنای آن‌ها را اعتبارسنجی نمی‌کند. پشتیبانی و محدودیت هر گزینه به نسخه RabbitMQ و نوع صف بستگی دارد. جدول زیر مثال‌های رایج است، نه ادعای پشتیبانی از تمام گزینه‌های broker یا افزونه‌ها.

| محل | مثال arguments | کاربرد |
| --- | --- | --- |
| Queue | `{"x-message-ttl":60000}` | انقضای پیام‌های منتظر در صف پس از ۶۰ ثانیه |
| Queue | `{"x-expires":300000}` | انقضای خود صف پس از مدت بی‌استفاده‌ماندن؛ مناسب صف موقت، نه صف اصلی SMS |
| Queue | `{"x-dead-letter-exchange":"sms.dlx","x-dead-letter-routing-key":"sms.failed"}` | تعیین مسیر dead letter |
| Queue | `{"x-max-length":10000}` | محدودکردن تعداد پیام‌های آماده |
| Queue | `{"x-max-length-bytes":10485760}` | محدودکردن حجم بدنه پیام‌های آماده |
| Queue | `{"x-overflow":"reject-publish"}` | رفتار هنگام پرشدن صف؛ سازگاری با نوع صف را بررسی کنید |
| Queue | `{"x-queue-type":"quorum"}` | انتخاب نوع صف در زمان ایجاد؛ برای quorum از durable و بدون autoDelete استفاده کنید |
| Queue | `{"x-single-active-consumer":true}` | فقط یک consumer فعال برای صف |
| Exchange | `{"alternate-exchange":"unrouted"}` | مسیر جایگزین پیام‌های بدون مقصد؛ exchange جایگزین را جدا تعریف کنید |
| Binding | `{"x-match":"all","channel":"sms"}` | شرط header برای exchange از نوع headers |

TTL صف با `expiration` هر پیام فرق دارد. هر دو زمان هستند، نه زمان‌بندی اجرای handler. جزئیات در [مستندات TTL](https://www.rabbitmq.com/docs/ttl) آمده است. گزینه‌های broker که امکان policy دارند را می‌توان بیرون از این فایل با policy مدیریت کرد؛ ماژول متد مدیریت policy ندارد.

مثال مستقل برای TTL و صف پیام‌های منقضی‌شده:

```json
{
  "exchanges": [
    { "name": "users", "type": "direct" },
    { "name": "sms.dlx", "type": "direct" }
  ],
  "queues": [
    {
      "name": "sms",
      "arguments": {
        "x-message-ttl": 60000,
        "x-dead-letter-exchange": "sms.dlx",
        "x-dead-letter-routing-key": "sms.failed"
      }
    },
    { "name": "sms.failed" }
  ],
  "bindings": [
    { "queue": "sms", "exchange": "users", "routingKey": "user.registered" },
    { "queue": "sms.failed", "exchange": "sms.dlx", "routingKey": "sms.failed" }
  ]
}
```

این نمونه به معنی retry محدودشده نیست. handler معمولی در خطا با `requeue: true` پیام را برمی‌گرداند؛ صرف تعریف DLX آن خطا را مستقیماً به صف failed نمی‌فرستد. انقضا، رد بدون requeue و برخی محدودیت‌های broker می‌توانند dead letter ایجاد کنند؛ [مستندات DLX](https://www.rabbitmq.com/docs/dlx).

### قوانین اعتبارسنجی و تغییر فایل

- نام صف و exchange غیرخالی، حداکثر ۲۵۵ بایت و بدون پیشوند `amq.` است. routingKey رشته‌ای حداکثر ۲۵۵ بایتی است.
- booleanها باید `true` یا `false` باشند، نه رشته. arguments باید object باشد.
- نام تکراری با تنظیمات یکسان ادغام می‌شود؛ همان نام با تنظیمات متفاوت خطای `TOPOLOGY_CONFLICT` می‌دهد.
- هویت binding شامل queue، exchange، routingKey و arguments است. ترتیب کلیدهای arguments مهم نیست؛ arguments متفاوت یعنی binding متفاوت.
- منابع موجود با تنظیمات ناسازگار ممکن است از طرف RabbitMQ رد شوند؛ ماژول آن‌ها را حذف و دوباره ایجاد نمی‌کند.
- فایل یک بار برای هر نمونه برنامه خوانده می‌شود؛ reconnect همان snapshot را استفاده می‌کند. تغییر فایل نیازمند restart/deploy هماهنگ است.
- همه سرویس‌ها باید نسخه یکسان فایل و broker/vhost موردنظر را استفاده کنند. هر کدام کل topology را معرفی می‌کنند؛ مصرف فقط از صف‌هایی است که handler برایشان ثبت می‌کنند.
- حذف یک تعریف از JSON، منبع موجود در broker را حذف نمی‌کند.
- مسیر نسبی نسبت به working directory است. build فایل خارجی JSON را خودکار بسته‌بندی نمی‌کند؛ آن را در deploy کپی یا mount کنید.
- `arguments` که به exchange دیگری اشاره می‌کند، مثل DLX، توسط validator از نظر وجود مقصد بررسی نمی‌شود؛ خودتان مقصد و binding لازم را تعریف کنید.

## متدهای RabbitMQService

در مثال‌ها `rabbit` سرویس تزریق‌شده است:

```ts
constructor(private readonly rabbit: RabbitMQService) {}
```

### initialize(): Promise<void>

اتصال و topology را آماده می‌کند. در Nest خودکار اجرا می‌شود؛ فراخوانی‌های هم‌زمان اتصال جدا نمی‌سازند. فراخوانی مجدد فایل JSON را reload نمی‌کند.

```ts
await rabbit.initialize();
```

### send(queue, data, options?): Promise<void>

ارسال مستقیم JSON به نام صف از طریق default exchange. صف جدید نمی‌سازد. موفقیت یعنی تأیید انتشار از broker، نه پایان پردازش SMS.

```ts
await rabbit.send('sms', { phone: '09120000000', text: 'خوش آمدید' }, {
  messageId: 'outbox-123',
});
```

### publish(exchange, routingKey, data, options?): Promise<void>

ارسال JSON از مسیر exchange و binding.

```ts
await rabbit.publish('users', 'user.registered', {
  phone: '09120000000', text: 'خوش آمدید',
}, { messageId: 'outbox-123' });
```

### consume<T>(queue, handler, options?): Promise<string>

ثبت مصرف‌کننده و برگرداندن شناسه آن؛ خود Promise منتظر رسیدن پیام نمی‌ماند. برای دریافت در طول اجرای برنامه، آن را یک بار در hook شروع provider خود صدا بزنید و provider را در Nest ثبت کنید. هر consumer کانال خودش را دارد.

```ts
const consumerId = await rabbit.consume<{ phone: string; text: string }>(
  'sms',
  async (payload, context) => {
    await inbox.saveOnce(context.messageId, payload, context.headers);
  },
  { id: 'sms-inbox', prefetch: 10, requeueDelayMs: 5000 },
);
```

`inbox.saveOnce` کد خود میکروسرویس است؛ ثبت قطعی و جلوگیری از تکرار باید در دیتابیس انجام شود. پس از موفقیت handler، ماژول ack می‌کند. در خطا، پیام بعد از فاصله تنظیم‌شده requeue می‌شود. خطا را نبلعید؛ برگشت موفق یعنی اجازه ack. دریافت JSON خراب یا بدون messageId نیز وارد مسیر خطا می‌شود. نوع generic جای اعتبارسنجی داده در runtime را نمی‌گیرد.

### stopConsumer(id): Promise<void>

دریافت جدید را متوقف می‌کند، برای کارهای جاری تا مهلت تعیین‌شده صبر می‌کند و کانال را می‌بندد. شناسه ناموجود بی‌اثر است؛ صف حذف نمی‌شود. consumer متوقف‌شده در reconnect برنمی‌گردد.

```ts
await rabbit.stopConsumer(consumerId);
```

### request<T>(destination, data, options?): Promise<T>

درخواست RPC و انتظار برای پاسخ. مقصد نام صف یا `{ exchange, routingKey }` است و باید به یک صف پاسخ‌دهنده برسد. صف پاسخ خصوصی به‌صورت خودکار ساخته می‌شود.

```ts
const result = await rabbit.request<{ status: string }>(
  'sms.status', { smsId: 'sms-123' }, { timeoutMs: 5000 },
);
```

برای این مثال ابتدا `{ "name": "sms.status" }` را به queues فایل مشترک اضافه کنید؛ این صف در topology فعلی نیست. timeout کار سمت مقابل را لغو نمی‌کند. درخواست خودکار تکرار نمی‌شود. پاسخ‌های دیررس یا تکراری نادیده گرفته می‌شوند.

### handleRequest<T, R>(queue, handler, options?): Promise<string>

ثبت پاسخ‌دهنده RPC؛ مقدار برگشتی handler به caller ارسال می‌شود. شناسه خروجی را می‌توان به stopConsumer داد.

```ts
await rabbit.handleRequest<{ smsId: string }, { status: string }>(
  'sms.status',
  async ({ smsId }) => ({ status: await smsRepository.getStatus(smsId) }),
  { id: 'sms-status' },
);
```

`smsRepository` کد سرویس خودتان است. خطای handler به پاسخ عمومی `Remote handler failed` تبدیل می‌شود. برای خطای قابل نمایش، `throw new RpcPublicError('شناسه پیامک معتبر نیست')` استفاده کنید. caller خطای `RpcRemoteError` دریافت می‌کند. شکست ارسال پاسخ ممکن است باعث بازتحویل درخواست شود؛ عملیات تغییردهنده باید idempotent باشند. اگر صف پاسخ حذف شده باشد و انتشار UNROUTABLE شود، ماژول درخواست را صرفاً برای ارسال دوباره پاسخ تکرار نمی‌کند.

### close(): Promise<void>

کار جدید را متوقف می‌کند، consumerها و انتشارهای جاری را تا مهلت‌های تعیین‌شده جمع می‌کند، RPCهای معلق را رد می‌کند و اتصال را می‌بندد. چند بار صدا زدن امن است؛ پس از close همان instance قابل راه‌اندازی مجدد نیست. صف‌های پایدار حذف نمی‌شوند.

### hookهای Nest

`onApplicationBootstrap()` متد initialize را اجرا می‌کند. `onApplicationShutdown()` متد close را اجرا می‌کند. نیازی به فراخوانی دستی hookها نیست.

## تمام گزینه‌های انتشار و RPC

| گزینه PublishOptions | پیش‌فرض | کاربرد |
| --- | --- | --- |
| `messageId` | UUID جدید | شناسه پایدار؛ برای retry همان شناسه Outbox را بدهید |
| `headers` | `{}` به‌علاوه context ردگیری | metadata؛ مانند `{ language: 'fa' }` |
| `timeoutMs` | operationTimeoutMs؛ برای RPC برابر rpcTimeoutMs | مهلت کل فراخوانی |
| `mandatory` | `true` | اگر به هیچ صف نرسید، خطای UNROUTABLE؛ با false پیام بدون مقصد می‌تواند حذف شود |
| `persistent` | `true` | درخواست ماندگاری پیام؛ همراه صف پایدار استفاده شود |
| `correlationId` | ندارد | ارتباط پیام‌ها؛ در request خودکار تولید و جایگزین می‌شود |
| `replyTo` | ندارد | مقصد پاسخ؛ در request خودکار تعیین و جایگزین می‌شود |
| `expiration` | ندارد | TTL پیام به صورت رشته میلی‌ثانیه، مثل `'60000'`؛ در request از زمان باقی‌مانده محاسبه و جایگزین می‌شود |

بدنه باید JSON-serializable باشد. contentType برابر `application/json` و timestamp خودکار است. header داخلی `x-module-publication-id` توسط ماژول تولید می‌شود و برای تشخیص پیام‌های برگشتی است. API فعلی گزینه `priority` یا ارسال Buffer خام ندارد.

## تمام گزینه‌های دریافت و context

| ConsumerOptions | پیش‌فرض | کاربرد |
| --- | --- | --- |
| `id` | UUID | شناسه محلی مصرف‌کننده؛ در یک instance تکراری نباشد |
| `prefetch` | مقدار ماژول | سقف پیام تأییدنشده؛ تعداد workerهای Inbox نیست |
| `requeueDelayMs` | مقدار ماژول | تأخیر بازگرداندن پیام شکست‌خورده |

handler آرگومان دوم از نوع MessageContext دارد:

| فیلد | معنی |
| --- | --- |
| `messageId` | شناسه پیام، الزامی برای دریافت |
| `headers` | headerهای ورودی |
| `correlationId` | شناسه ارتباط، در صورت وجود |
| `replyTo` | مقصد پاسخ، در صورت وجود |
| `redelivered` | نشانه بازتحویل broker؛ جایگزین deduplication با messageId نیست |

## Inbox، Outbox و retry

روند ارسال: تراکنش کسب‌وکار و ذخیره Outbox، انتشار با messageId ثابت، سپس علامت‌گذاری ارسال پس از تأیید broker. شکست یا timeout می‌تواند نتیجه نامعلوم داشته باشد؛ Outbox دوباره تلاش می‌کند و Inbox تکرار را تشخیص می‌دهد.

روند دریافت: consume، ذخیره قطعی Inbox، پایان موفق handler و ack، سپس پردازش مستقل Inbox و ارسال پیامک. retry سرویس پیامک در worker خودتان انجام می‌شود. این ماژول سقف دفعات retry، صف poison یا زمان‌بندی retry کسب‌وکار ندارد.

reconnect فقط اتصال، topology و consumerهای فعال را بازیابی می‌کند؛ انتشارهای قبلی را دوباره ارسال نمی‌کند. پیام تأییدنشده ممکن است بازتحویل شود؛ تضمین exactly-once نداریم.

## APM و TraceAdapter

adapter پیش‌فرض agent جدید start نمی‌کند. در inject، traceparent معتبر صریح اولویت دارد؛ سپس context جاری APM، context به‌ارث‌رسیده و در نهایت شناسه جدید. trace.id از traceparent استخراج می‌شود. headerهای داده‌شده مانند tracestate، baggage و metadata سفارشی حفظ می‌شوند؛ کل اطلاعات داخلی agent خودکار جمع‌آوری نمی‌شود.

برای Outbox، context را هنگام ایجاد رکورد ذخیره کنید تا worker بعداً همان را ارسال کند:

```ts
import { ElasticTraceAdapter } from '@libs/common';
const trace = new ElasticTraceAdapter();
const headers = trace.inject();
// Store headers with the Outbox row in your own transaction.
// Later: rabbit.send('sms', row.payload, { messageId: row.id, headers: row.headers });
```

| متد adapter | مسئولیت |
| --- | --- |
| `inject(headers?)` | برگرداندن headerهای همراه context معتبر |
| `run(name, headers, handler)` | اجرای handler در context مستقل؛ adapter پیش‌فرض با agent فعال transaction می‌سازد و در پایان می‌بندد |
| `captureError(error)` | ثبت خطا؛ در قرارداد سفارشی اختیاری است |

## خطاها و عیب‌یابی

`RabbitMQError` دارای code است. خطاهای معمول: `INVALID_CONFIG`، `TOPOLOGY_READ_FAILED`، `INVALID_TOPOLOGY`، `TOPOLOGY_CONFLICT`، `CONNECT_TIMEOUT`، `OPERATION_TIMEOUT`، `CONNECTION_LOST`، `UNROUTABLE`، `CONFIRM_TIMEOUT`، `PUBLISH_NACK`، `PUBLISH_LIMIT`، `BROKER_BLOCKED`، `RPC_LIMIT`، `RPC_TIMEOUT`، `RPC_REMOTE_ERROR`، `DUPLICATE_CONSUMER` و `CLOSED`. خطاهای broker، فایل و serialization هم ممکن است با cause یا نوع اصلی برسند؛ همه خطاها الزاماً RabbitMQError نیستند.

اگر exchange را نمی‌بینید:

1. در نمونه فعلی در بخش Exchanges دنبال `users` بگردید؛ `sms` در بخش Queues است.
2. host/port و vhost برنامه را با پنل مقایسه کنید؛ آدرس پیش‌فرض نمونه از vhost `/` استفاده می‌کند.
3. مطمئن شوید اجرای برنامه به bootstrap رسیده و خطای اتصال، مجوز یا topology نداده است.
4. مسیر JSON نسبت به working directory را بررسی کنید. تغییر JSON را با restart همراه کنید.
5. در این پروژه `pnpm up` طبق docker-compose فعلی فقط سرویس مستندات را بالا می‌آورد؛ برای برنامه از فرمان‌های start پروژه استفاده کنید. اجرای نسخه build قدیمی تغییرات جدید کد را اعمال نمی‌کند.

## فایل‌های داخلی و مسئولیت‌ها

مصرف‌کننده ماژول از API عمومی بالا استفاده می‌کند؛ managerها export عمومی نیستند.

| فایل/پوشه | متدها و مسئولیت |
| --- | --- |
| `rabbitmq.service.ts` | API عمومی و هماهنگی lifecycle |
| `rabbitmq.module.ts` | forRoot و forRootAsync |
| `connection/` | connected: اتصال مشترک؛ observe: ثبت واکنش به اتصال/قطع؛ assertOpen: کنترل shutdown؛ beginShutdown و close؛ invalidate: نامعتبرکردن session و زمان‌بندی بازیابی |
| `channel/` | createSession: کانال کنترل و confirm؛ create: کانال مصرف و واکنش به بسته‌شدن غیرمنتظره |
| `messaging/rabbitmq.publisher.ts` | publish: انتشار با confirm و کنترل فشار؛ flush: انتظار تأییدها |
| `messaging/rabbitmq-consumer.manager.ts` | consume، stopConsumer و close؛ اجرای handler و ack/requeue |
| `rpc/` | request، handleRequest و close؛ مدیریت صف پاسخ و درخواست‌های معلق |
| `topology/topology.loader.ts` | readTopology: خواندن و اعتبارسنجی فایل |
| `topology/topology.validation.ts` | normalize: قواعد topology؛ canonical: نمایش ثابت JSON؛ bindingId: هویت binding |
| `tracing/` | adapter ردگیری |
| `common/interface/` | قراردادها، هر interface در فایل مستقل |
| `common/type/` | Headers و MessageHandler |
| `common/error/` | RabbitMQError، RpcRemoteError و RpcPublicError |
| `common/helper/` | within: مهلت Promise؛ positive: اعتبارسنجی عدد صحیح مثبت |
| `test/` | تست‌های واحد و integration؛ از build اصلی کنار گذاشته شده‌اند |

## اجرای بررسی‌ها

از ریشه پروژه boilerplate:

```bash
pnpm test
pnpm run typecheck
pnpm run lint
pnpm run build
```

تست واقعی broker فقط با RabbitMQ مخصوص آزمون:

```bash
TEST_RABBITMQ_URL='amqp://test:test@127.0.0.1:5679' pnpm run test:integration
```

بدون متغیر بالا تست integration skip می‌شود. اگر `TEST_RABBITMQ_CONTAINER` را تعیین کنید، آزمون آن کانتینر را restart می‌کند؛ فقط کانتینر آزمایشی بدهید و پورت host ثابت داشته باشید.

</div>
