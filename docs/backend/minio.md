# راهنمای MinIO

ماژول `MinioModule` ابزار ذخیره و بازیابی فایل‌ها در MinIO را فراهم می‌کند. این راهنما تنظیمات، تزریق و تمام متدهای عمومی `IMinioStorage` را توضیح می‌دهد.

## مفاهیم مسیر

- **Bucket** محل نگهداری اشیا است؛ نام آن از تنظیمات ماژول می‌آید.
- **Object key** مسیر و نام شیء داخل باکت است؛ مثلاً `users/42/avatar.png`. علامت `/` بخشی از کلید است و لزوماً پوشهٔ واقعی روی دیسک نیست.
- **مسیر محلی** مانند `/tmp/avatar.png` مسیر فایل روی همان سروری است که برنامهٔ Node.js در آن اجرا می‌شود، نه مرورگر کاربر.

برای دریافت، بررسی یا حذف یک شیء، همان object key کامل را بدهید؛ نام باکت را به ابتدای آن اضافه نکنید. مسیرهایی که از کاربر دریافت می‌شوند باید متناسب با مجوزهای برنامه اعتبارسنجی شوند.

## تنظیمات محیطی

```env
MINIO_ENDPOINT=127.0.0.1
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=example-access-key
MINIO_SECRET_KEY=example-secret-key
MINIO_BUCKET=files
```

- `MINIO_ENDPOINT`: نام میزبان یا IP سرور، بدون پروتکل و پورت.
- `MINIO_PORT`: پورت اتصال، عددی بین ۱ تا ۶۵۵۳۵.
- `MINIO_USE_SSL`: اختیاری؛ `true` برای HTTPS و `false` برای HTTP. در صورت حذف، `false` است.
- `MINIO_ACCESS_KEY` و `MINIO_SECRET_KEY`: کلیدهای دسترسی MinIO با مجوز لازم برای عملیات باکت و اشیا.
- `MINIO_BUCKET`: نام باکت مورد استفادهٔ سرویس.

مقادیر بالا فقط نمونه‌اند؛ کلیدهای واقعی را از محیط امن دریافت کنید. `AppConfigModule` این متغیرها را می‌خواند و تنظیمات را با نام `minio` در `ConfigService` قرار می‌دهد.

## ثبت ماژول و اتصال

`AppModule` پروژه ماژول را هم‌اکنون به شکل زیر ثبت کرده است؛ نیازی به تکرار این ثبت در ماژول‌های دیگر نیست:

```ts
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MinioModule, type MinioConfig } from '@libs/common';

// این عبارت داخل imports ماژول اصلی قرار می‌گیرد.
MinioModule.forRootAsync({
  imports: [ConfigModule], // دسترسی factory به تنظیمات
  inject: [ConfigService], // تزریق ConfigService به factory
  useFactory: (config: ConfigService) =>
    config.getOrThrow<MinioConfig>('minio'), // دریافت تنظیمات اعتبارسنجی‌شده
});
```

برای تنظیم مستقیم، به‌جای `forRootAsync` می‌توان یک بار از `forRoot` استفاده کرد:

```ts
MinioModule.forRoot({
  endpoint: '127.0.0.1', // میزبان MinIO
  port: 9000,            // پورت API
  useSsl: false,         // استفاده از HTTP
  accessKey: 'example-access-key', // کلید دسترسی نمونه
  secretKey: 'example-secret-key', // کلید محرمانهٔ نمونه
  bucket: 'files',       // باکت پیش‌فرض
});
```

ماژول global است. `MINIO_STORAGE` با `useExisting` به یک نمونهٔ مشترک سرویس اشاره می‌کند؛ تزریق آن در چند سرویس باعث ساخت کلاینت یا راه‌اندازی مجدد نمی‌شود. ماژول را فقط یک بار در ریشهٔ هر برنامه ثبت کنید.

در شروع برنامه ابتدا مسیر `/minio/health/ready` بررسی می‌شود. حداکثر ۵ تلاش با فاصله‌های ۱، ۲، ۴ و ۸ ثانیه انجام می‌شود و هر درخواست حداکثر ۵ ثانیه فرصت دارد. پس از موفقیت، وجود باکت بررسی و در صورت نبودن با region برابر `us-east-1` ساخته می‌شود. خطای بررسی یا ساخت باکت تکرار نمی‌شود و راه‌اندازی را متوقف می‌کند. بررسی سلامت، کلیدهای دسترسی را تأیید نمی‌کند؛ آن‌ها هنگام عملیات MinIO بررسی می‌شوند. retry داخلی کلاینت غیرفعال است و خطای عملیات به فراخواننده منتقل می‌شود.

## تزریق سرویس

```ts
import { Inject, Injectable } from '@nestjs/common';
import { MINIO_STORAGE, type IMinioStorage } from '@libs/common';

@Injectable() // این کلاس می‌تواند provider یک ماژول Nest باشد.
export class FileService {
  constructor(
    @Inject(MINIO_STORAGE) // توکن runtime برای پیدا کردن provider
    private readonly storage: IMinioStorage, // قرارداد TypeScript متدها
  ) {}

  getBucket(): string {
    return this.storage.bucket; // نام باکت تنظیم‌شده
  }
}
```

`FileService` را در `providers` ماژول خودش ثبت کنید. مثال‌های بعدی فرض می‌کنند `storage` همین نمونهٔ تزریق‌شده است. اینترفیس TypeScript در زمان اجرا وجود ندارد؛ به همین دلیل `@Inject(MINIO_STORAGE)` لازم است.

## آپلود استریم: `uploadStream`

```ts
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

const filePath = '/tmp/avatar.png'; // مسیر فایل محلی
const key = 'users/42/avatar.png'; // کلید مقصد داخل باکت
const file = await stat(filePath); // اندازهٔ فایل را به بایت دریافت می‌کند.
const sha256 = 'your-precomputed-sha256'; // هش واقعی محتوای فایل را قبلاً محاسبه کنید.
const stream = createReadStream(filePath); // فایل را به‌صورت استریم باز می‌کند.
const stored = await storage.uploadStream(
  key,         // کلید شیء در باکت
  stream,      // استریم خواندنی
  file.size,   // اندازهٔ دقیق محتوا به بایت
  'image/png', // Content-Type
  sha256,      // مقدار متادیتای SHA-256
);
console.log(stored.objectKey, stored.etag, stored.url); // مشخصات و لینک موقت
```

این تابع هش را محاسبه یا صحت آن را بررسی نمی‌کند؛ مقدار ورودی را در متادیتا ذخیره می‌کند. با کلید یکسان ممکن است شیء موجود بازنویسی شود. خروجی از نوع `StoredMinioObject` است. اگر آپلود موفق شود اما تولید لینک موقت خطا دهد، فایل ممکن است در باکت ذخیره شده باشد و خطا همچنان به فراخواننده برسد.

## بررسی شیء مشابه: `getExistingObject`

```ts
const existing = await storage.getExistingObject(
  'users/42/avatar.png', // کلید دقیق شیء
  1024,                  // اندازهٔ مورد انتظار به بایت
  'expected-sha256',     // هش ثبت‌شدهٔ مورد انتظار
);
if (existing) {          // شیء وجود دارد و اندازه و متادیتای هش برابرند.
  console.log(existing.url); // لینک موقت جدید
} else {                 // شیء وجود ندارد یا یکی از دو مقدار برابر نیست.
  console.log('فایل منطبق پیدا نشد');
}
```

این مقایسه متادیتا را می‌خواند و محتوای فایل را دوباره هش نمی‌کند. خروجی در صورت تطابق `StoredMinioObject` و در غیر این صورت `null` است؛ خطاهای دیگر منتقل می‌شوند.

## اطلاعات شیء: `getObjectInfo`

```ts
const info = await storage.getObjectInfo('users/42/avatar.png'); // درخواست اطلاعات کلید
if (info) { // برای شیء موجود
  console.log(info.objectKey); // کلید داخل باکت
  console.log(info.size);      // اندازه به بایت
  console.log(info.etag);      // ETag بازگشتی از MinIO
  console.log(info.sha256);    // هش متادیتا، یا undefined اگر ثبت نشده باشد
} else {
  console.log('فایل وجود ندارد'); // برای خطای شناخته‌شدهٔ عدم وجود
}
```

خروجی `MinioObjectInfo | null` است. ETag را معادل SHA-256 فرض نکنید. خطاهای غیر از عدم وجود به فراخواننده منتقل می‌شوند.

## بررسی وجود: `objectExists`

```ts
const exists = await storage.objectExists('users/42/avatar.png'); // بررسی کلید
console.log(exists); // true برای شیء موجود، در غیر این صورت false
```

این متد از `getObjectInfo` استفاده می‌کند؛ خطاهای دسترسی یا شبکه را به `false` تبدیل نمی‌کند و آن‌ها را پرتاب می‌کند.

## ساخت لینک دانلود: `getStoredObject`

```ts
const info = await storage.getObjectInfo('users/42/avatar.png'); // دریافت ETag
if (info) { // فقط در صورت وجود شیء ادامه دهید.
  const stored = await storage.getStoredObject(info.objectKey, info.etag); // ساخت لینک امضاشده
  console.log(stored.bucket);       // نام باکت
  console.log(stored.objectKey);    // کلید شیء
  console.log(stored.etag);         // ETag داده‌شده به تابع
  console.log(stored.url);          // لینک دانلود موقت
  console.log(stored.urlExpiresAt); // زمان انقضا به صورت ISO 8601
}
```

تابع باکت و کلید و ETag داده‌شده را در خروجی قرار می‌دهد و URL امضاشده با اعتبار ۷ روز تولید می‌کند. خود این تابع وجود شیء یا درستی ETag ورودی را بررسی نمی‌کند. هرکس لینک معتبر را داشته باشد می‌تواند تا زمان انقضا از آن استفاده کند؛ آدرس امضاشده باید از شبکهٔ مصرف‌کننده قابل دسترسی باشد.

## دریافت به شکل استریم: `getObject`

```ts
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

const stream = await storage.getObject('users/42/avatar.png'); // استریم شیء از باکت
const output = createWriteStream('/tmp/avatar-stream.png');   // مقصد محلی قابل نوشتن
await pipeline(stream, output); // انتقال کامل داده و انتشار خطاهای استریم
```

خروجی `Readable` است؛ دریافت Promise به معنی پایان خواندن فایل نیست. برای ارسال HTTP نیز می‌توان استریم را به پاسخ مناسب متصل کرد و خطاهای استریم را مدیریت کرد.

## دانلود روی مسیر محلی: `downloadToFile`

```ts
const key = 'users/42/avatar.png'; // مسیر و نام شیء داخل باکت
const destination = '/tmp/downloads/avatar.png'; // مسیر فایل روی سرور برنامه
await storage.downloadToFile(key, destination); // تا تکمیل دانلود منتظر می‌ماند.
console.log(destination); // پس از موفقیت، فایل در این مسیر قرار دارد.
```

این تابع `Promise<void>` برمی‌گرداند و از `fGetObject` کلاینت MinIO استفاده می‌کند. کلاینت پوشه‌های مقصد را در صورت نیاز می‌سازد و ممکن است فایل موجود در مقصد را جایگزین کند. خطای شبکه، نبود شیء یا خطای فایل‌سیستم به فراخواننده منتقل می‌شود؛ فایل موقت دانلود ممکن است پس از خطا باقی بماند. مقصد را از ورودی غیرقابل اعتماد بدون اعتبارسنجی انتخاب نکنید.

## حذف با مسیر شیء: `removeObject`

```ts
const key = 'users/42/avatar.png'; // کلید کامل شیء داخل باکت
await storage.removeObject(key);   // حذف شیء در باکت تنظیم‌شده
console.log('درخواست حذف انجام شد'); // خروجی تابع مقدار ندارد.
```

این تابع `Promise<void>` برمی‌گرداند و مسیر **محلی** را حذف نمی‌کند. MinIO ممکن است برای حذف کلید ناموجود نیز پاسخ موفق بدهد؛ خروجی تابع مشخص نمی‌کند شیء قبلاً وجود داشته است یا نه. برای پاک کردن فایل محلی باید از API جداگانهٔ فایل‌سیستم استفاده کنید.

## مدیریت خطا

```ts
try {
  await storage.downloadToFile('users/42/avatar.png', '/tmp/avatar.png'); // عملیات ممکن است شکست بخورد.
} catch (error) {
  console.error('دانلود انجام نشد', error); // خطا را مطابق سیاست برنامه ثبت یا مدیریت کنید.
  throw error; // در این نمونه خطا به فراخواننده منتقل می‌شود.
}
```

دسترسی به شبکه و فایل‌سیستم، مجوز باکت و معتبر بودن کلیدها برای موفقیت عملیات لازم است. متدها را `await` کنید و خطاها را در سطح مناسب برنامه مدیریت کنید.
