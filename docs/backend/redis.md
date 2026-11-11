# راهنمای Redis

ماژول Redis در `libs/common/src/redis` از `ioredis` استفاده می‌کند. این راهنما نحوهٔ ثبت ماژول، تزریق سرویس و استفاده از تمام متدهای عمومی آن را نشان می‌دهد.

## پیش‌نیاز و متغیرهای محیطی

سرویس Redis باید در دسترس برنامه باشد. پکیج `ioredis` در وابستگی‌های پروژه ثبت شده است. در `.env`، مطابق نمونهٔ `.env.example`، مقادیر زیر را قرار دهید:

```env
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
```

- `REDIS_HOST`: آدرس سرور Redis؛ در محیط کانتینری معمولاً نام سرویس Redis است.
- `REDIS_PORT`: پورت سرور؛ در تنظیمات فعلی به عدد تبدیل می‌شود.
- `REDIS_PASSWORD`: رمز اتصال؛ اگر خالی باشد، در تنظیمات فعلی بدون رمز اتصال برقرار می‌شود.
- `REDIS_DB`: شمارهٔ پیش‌فرض دیتابیس؛ اختیاری است و در صورت حذف مقدار آن `0` خواهد بود.

تنظیمات در `libs/common/src/config/redis` خوانده و اعتبارسنجی می‌شوند و با نام `redis` در دسترس `ConfigService` قرار می‌گیرند؛ خود `RedisModule` تنظیمات را به صورت آبجکت دریافت می‌کند. سایر گزینه‌های اتصال `ioredis` مانند `username` و `tls` را نیز می‌توان در `redis` تنظیم کرد.

## ثبت در ماژول اصلی

`AppModule` فعلی ماژول را با `forRootAsync` ثبت کرده است. ماژول global است؛ آن را یک بار در ریشهٔ برنامه ثبت کنید.

```ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppConfigModule, RedisModule, type RedisConfig } from '@libs/common';

@Module({
  imports: [
    AppConfigModule,
    RedisModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: config.getOrThrow<RedisConfig>('redis'),
      }),
    }),
  ],
})
export class AppModule {}
```

پیکربندی پروژه host، پورت و شمارهٔ DB را اعتبارسنجی می‌کند. نمونهٔ بالا به بارگذاری `redisConfig` در `AppConfigModule` وابسته است. برای تنظیمات ثابت، می‌توان به جای روش بالا از `forRoot` استفاده کرد:

```ts
RedisModule.forRoot({
  redis: { host: '127.0.0.1', port: 6379, db: 0 },
});
```

`CLIENT_REDIS` از طریق `useExisting` به `ClientRedis` متصل شده است. با تزریق token، قرارداد `IClientRedis` برای type checking استفاده می‌شود.

## تزریق و پیشوند کلید

```ts
import { Inject, Injectable } from '@nestjs/common';
import { CLIENT_REDIS, type IClientRedis, type IRedis } from '@libs/common';

@Injectable()
export class UserService {
  private readonly redis: IRedis;

  constructor(@Inject(CLIENT_REDIS) redis: IClientRedis) {
    this.redis = redis.setPrefix('user');
  }

  async saveName(id: string, name: string): Promise<void> {
    await this.redis.set(`name:${id}`, name);
    // کلید واقعی در Redis: user:name:1، اگر id برابر 1 باشد.
  }
}
```

`UserService` باید در `providers` ماژول خودش ثبت شود. `ClientRedis` به‌صورت پیش‌فرض prefix ندارد. `setPrefix` یک نمای مستقل با prefix جدید برمی‌گرداند و نمونهٔ اصلی را تغییر نمی‌دهد؛ بنابراین مقدار بازگشتی را نگه دارید. اتصال‌های Redis بین نماها مشترک هستند.

```ts
const users = redis.setPrefix('user');
const admins = redis.setPrefix('admin');

await users.set('name', 'Sajjad');   // user:name
await admins.set('name', 'Sara');    // admin:name
console.log(users.getPrefix());     // user

const withoutPrefix = users.setPrefix('');
await withoutPrefix.set('name', 'Ali'); // name
```

## انتخاب DB و زمان انقضا

هر متد یک `options` اختیاری دارد. با `db` می‌توان DB همان عملیات را تعیین کرد:

```ts
await redis.set('name', 'sajjad');                 // DB پیش‌فرض
await redis.set('code', '256', { db: 1 });         // DB 1
await redis.hset('profile', 'name', 'sajjad', { db: 12 });
await redis.get('code', { db: 1 });
```

اولویت انتخاب DB به ترتیب `options.db`، پیش‌فرض کلاس و سپس `redis.db` در تنظیمات ماژول است؛ اگر هیچ‌کدام مشخص نشده باشد DB 0 استفاده می‌شود. برای هر DB در اولین استفاده یک اتصال جداگانه ساخته و بعداً استفادهٔ مجدد می‌شود. تعداد DBهای مجاز به تنظیمات سرور بستگی دارد؛ Redis Cluster فقط DB 0 دارد و این پیاده‌سازی برای اتصال standalone نوشته شده است.

گزینهٔ `ttlMs` فقط برای `set` است و واحد آن **میلی‌ثانیه** است:

```ts
await redis.set('token', 'abc', { ttlMs: 300_000 }); // پنج دقیقه
await redis.set('name', 'sajjad', { ttlMs: null });  // بدون انقضا
await redis.set('name', 'sajjad');                   // TTL پیش‌فرض کلاس
```

در `ClientRedis` پیش‌فرض TTL برابر `null` است. مقدار عددی باید عدد صحیح مثبت باشد؛ `0` و `-1` پذیرفته نمی‌شوند. `SET` بدون TTL، TTL قبلی کلید را نیز حذف می‌کند. برای Hash، List و Sorted Set این API فعلاً گزینهٔ TTL ارائه نمی‌کند.

در مثال‌های زیر فرض شده `redis` یک نمونهٔ تزریق‌شده از نوع `IClientRedis` یا `IRedis` است. مثال‌ها داده‌ها را تغییر می‌دهند؛ از کلیدهای آزمایشی استفاده کنید.

## String و عملیات عمومی کلید

```ts
// SET و GET: مقادیر این API رشته هستند.
await redis.set('name', 'sajjad');
const name = await redis.get('name'); // 'sajjad'؛ برای کلید ناموجود null

// EXISTS: برای هر نوع کلید، حتی رشتهٔ خالی
await redis.set('empty', '');
const exists = await redis.exists('empty'); // true

// DEL: حذف کلید از هر نوع؛ true یعنی کلید وجود داشته است.
const deleted = await redis.del('name');
const missing = await redis.exists('name'); // false
```

برای ذخیرهٔ object باید serialization را خودتان مدیریت کنید، برای مثال با `JSON.stringify` و `JSON.parse`.

## Hash

```ts
// HSET: افزودن یا تغییر یک فیلد
await redis.hset('profile:1', 'name', 'sajjad');
await redis.hset('profile:1', 'city', 'Tehran');

// HGET: رشته، یا null برای فیلد یا کلید ناموجود
const name = await redis.hget('profile:1', 'name'); // 'sajjad'

// HDEL: حذف یک فیلد؛ خروجی تعداد فیلدهای حذف‌شده است.
const removed = await redis.hdel('profile:1', 'city'); // 1

// DEL: حذف کل Hash، شامل همهٔ فیلدها
await redis.del('profile:1');
```

## List

```ts
// RPUSH: افزودن به انتهای لیست؛ خروجی طول جدید لیست است.
await redis.rpush('jobs', 'job-1');
await redis.rpush('jobs', 'job-2');
await redis.rpush('jobs', 'job-3');

// LRANGE: ابتدا و انتهای بازه شامل نتیجه‌اند؛ -1 آخرین عنصر است.
const jobs = await redis.lrange('jobs', 0, -1);
// ['job-1', 'job-2', 'job-3']

// LREM: حذف مقدار مشخص؛ عدد خروجی تعداد عناصر حذف‌شده است.
await redis.lrem('jobs', 1, 'job-2'); // 1؛ حذف یک مورد از ابتدا

// LTRIM: فقط بازهٔ انتخاب‌شده را نگه می‌دارد و بقیه را حذف می‌کند.
await redis.ltrim('jobs', 0, 0); // فقط اولین عنصر باقی می‌ماند

// حذف کل لیست
await redis.del('jobs');
```

در `lrem` مقدار `count` مثبت از ابتدای لیست، منفی از انتها و صفر همهٔ موارد مطابق را حذف می‌کند. `ltrim` خودِ بازهٔ انتخاب‌شده را حذف نمی‌کند.

## Sorted Set: امتیاز، مرتب‌سازی و حذف

```ts
// ZADD: افزودن عضو یا تغییر امتیاز آن
await redis.zadd('scores', 80, 'ali');
await redis.zadd('scores', 95, 'sara');
await redis.zadd('scores', 70, 'reza');

// ZRANGE BYSCORE: بازهٔ امتیاز به‌صورت پیش‌فرض شامل دو سر بازه است.
const selected = await redis.zrangeByScore('scores', 80, 100);
// ['ali', 'sara']

// ZRANGE: بازه بر اساس رتبهٔ صعودی؛ stop نیز شامل می‌شود.
const ascending = await redis.zrange('scores', 0, -1);
// ['reza', 'ali', 'sara']

// ZRANGE REV: بازه بر اساس رتبهٔ نزولی
const descending = await redis.zrevrange('scores', 0, -1);
// ['sara', 'ali', 'reza']

// ZREM: حذف یک عضو بر اساس مقدار آن
await redis.zrem('scores', 'ali');

// ZREMRANGEBYSCORE: حذف اعضای بازهٔ امتیاز
await redis.zremrangeByScore('scores', 0, 75); // reza

// ZREMRANGEBYRANK: حذف اعضای بازهٔ رتبهٔ صعودی
await redis.zremrangeByRank('scores', 0, 0); // sara

// حذف کامل کلید، اگر هنوز وجود داشته باشد
await redis.del('scores');
```

هر سه متد حذف عضو، تعداد اعضای حذف‌شده را برمی‌گردانند. `zremrangeByRank` همیشه رتبهٔ **صعودی** را می‌گیرد؛ رتبه‌های نتیجهٔ `zrevrange` را مستقیم به آن ندهید. برای محدودهٔ امتیاز می‌توان از `'-inf'`، `'+inf'` و حد انحصاری مانند `'(80'` هم استفاده کرد:

```ts
await redis.zrangeByScore('scores', '(80', '+inf'); // امتیاز بزرگ‌تر از 80
await redis.zremrangeByScore('scores', '-inf', '(50'); // امتیاز کمتر از 50
```

متدهای دریافت در این رابط فقط نام اعضا را برمی‌گردانند، نه امتیاز آن‌ها. پیاده‌سازی `zrangeByScore` و `zrevrange` به Redis نسخهٔ 6.2 یا بالاتر نیاز دارد.

## Query زمانی با Sorted Set

زمان را به صورت timestamp عددی در score ذخیره کنید؛ در این مثال همهٔ زمان‌ها بر حسب میلی‌ثانیه‌اند:

```ts
const now = Date.now();
await redis.zadd('events', now - 120_000, 'event-old');
await redis.zadd('events', now - 30_000, 'event-recent');

// رویدادهای یک دقیقهٔ اخیر
const recent = await redis.zrangeByScore('events', now - 60_000, now);
// ['event-recent']

// حذف رویدادهای قدیمی‌تر از یک دقیقه؛ حد بالا انحصاری است.
await redis.zremrangeByScore('events', '-inf', `(${now - 60_000}`);
```

هر عضو در یک Sorted Set یکتا است؛ `zadd` با همان نام عضو، score قبلی آن را به‌روزرسانی می‌کند. برای ثبت چند رویداد مستقل از شناسهٔ یکتا استفاده کنید.

## ساخت سرویس Redis اختصاصی

در صورت نیاز می‌توان یک کلاس با prefix، DB و TTL پیش‌فرض خودش ساخت. این نمونه یک provider جدید است و تنظیمات `ClientRedis` را تغییر نمی‌دهد:

```ts
import { Inject, Injectable, Module } from '@nestjs/common';
import {
  BaseRedis,
  REDIS_CONNECTIONS,
  type RedisConnections,
} from '@libs/common';

@Injectable()
export class ProductRedis extends BaseRedis {
  constructor(@Inject(REDIS_CONNECTIONS) connections: RedisConnections) {
    super(connections, {
      prefix: 'product',
      db: 1,
      ttlMs: 60_000,
    });
  }
}

@Module({
  providers: [ProductRedis],
  exports: [ProductRedis],
})
export class ProductModule {}
```

`ProductRedis` در ماژول‌هایی که `ProductModule` را import می‌کنند قابل تزریق است. در عملیات آن نیز می‌توان `db` و TTL را تغییر داد:

```ts
await productRedis.set('42', 'keyboard');                    // DB 1، یک دقیقه
await productRedis.set('42', 'keyboard', { db: 2, ttlMs: null }); // DB 2، بدون انقضا
```

`setPrefix` یک نمای عمومی از نوع `IRedis` برمی‌گرداند. اگر کلاس اختصاصی متدهای دیگری تعریف کند، آن متدها در نمای بازگشتی در دسترس نیستند؛ برای استفاده از آن‌ها از خود سرویس اختصاصی استفاده کنید.
