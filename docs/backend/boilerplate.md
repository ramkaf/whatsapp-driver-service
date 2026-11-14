# راهنمای استفاده از Boilerplate

این پروژه به‌عنوان نقطهٔ شروع سرویس‌های NestJS استفاده می‌شود. پروژهٔ جدید باید تاریخچهٔ Git boilerplate را حفظ کند تا تغییرات پایه بعداً از remote با نام `upstream` دریافت شوند.

## راه‌اندازی پروژهٔ جدید

برای پروژه‌ای که مخزن مقصد آن خالی است:

```bash
git clone https://git.afralab.ir/whatsapp/boilerplate.git finance
cd finance
git remote rename origin upstream
git remote add origin https://git.afralab.ir/YOUR_GROUP/finance.git
git branch -M main
git push --set-upstream origin main
```

در این مدل، `origin` مخزن اختصاصی پروژه و `upstream` مخزن boilerplate است:

| remote | مقصد | کاربرد |
| --- | --- | --- |
| `origin` | مخزن پروژه | push و pull روزمرهٔ پروژه |
| `upstream` | boilerplate | دریافت تغییرات پایه |

اگر از SSH استفاده می‌کنید، فقط آدرس‌ها را با قالب SSH جایگزین کنید:

```bash
git remote add origin git@git.afralab.ir:YOUR_GROUP/finance.git
git remote add upstream git@git.afralab.ir:whatsapp/boilerplate.git
```

## راه‌اندازی وابستگی‌ها

نسخهٔ Node پروژه در `.nvmrc` برابر `24.22.0` است و `package.json` نیز Node سری `24.x` را الزام می‌کند.

```bash
nvm use
pnpm install --frozen-lockfile
pnpm run prepare
```

`--frozen-lockfile` باعث می‌شود نصب دقیقاً مطابق `pnpm-lock.yaml` انجام شود. اسکریپت `prepare` ابزارهای Git hook را فعال و پروژه را build می‌کند.

## دریافت آپدیت boilerplate

در پروژهٔ مشتق‌شده، ابتدا وضعیت کاری را بررسی کنید و تغییرات محلی خود را commit یا موقتاً stash کنید:

```bash
git status
git switch main
git fetch upstream
git merge upstream/main
pnpm install --frozen-lockfile
pnpm run prepare
pnpm run build
pnpm test
git push origin main
```

برای دریافت یک نسخهٔ مشخص، به‌جای `upstream/main` می‌توان یک tag یا commit مشخص را merge کرد. بهتر است آپدیت‌های بزرگ در شاخهٔ جدا انجام شوند و بعد از build و test به `main` merge شوند:

```bash
git switch -c chore/update-boilerplate
git fetch upstream
git merge upstream/main
pnpm install --frozen-lockfile
pnpm run build
pnpm test
```
## خطا `fatal: a branch named 'chore/update-boilerplate' already exists`
```bash 
git switch main
git branch -D chore/update-boilerplate
git switch -c chore/update-boilerplate
```
## mearge in main
```bash
git switch main
git merge chore/update-boilerplate
```
## mearge in dev
```bash
git switch dev
git merge chore/update-boilerplate
```

اگر merge conflict ایجاد شد، فایل‌های علامت‌گذاری‌شده را بررسی و اصلاح کنید، سپس ادامه دهید:

```bash
git add <resolved-files>
git commit
pnpm install --frozen-lockfile
pnpm run build
pnpm test
```

## تغییرات پروژه و تغییرات پایه

فایل‌های مخصوص پروژه، مانند ماژول‌های دامنهٔ مالی، باید در commitهای جدا از آپدیت boilerplate نگهداری شوند. تغییرات عمومی که قرار است به همهٔ پروژه‌ها برسند باید ابتدا در boilerplate اعمال و منتشر شوند؛ سپس هر پروژه با `git fetch upstream` و merge آن را دریافت می‌کند.

کلون یا fork به‌تنهایی آپدیت خودکار ایجاد نمی‌کند. دریافت آپدیت یک مرحلهٔ کنترل‌شده است و ممکن است برای تغییرات ناسازگار به اصلاح کد پروژه نیاز داشته باشد.
