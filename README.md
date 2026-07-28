# حساب‌یار نسخه ۲ — نرم‌افزار حسابداری مغازه (Cloudflare Pages + D1)

این نسخه کاملاً بازنویسی شده است:

- **رابط کاربری از پایه بازطراحی شده** (سیستم طراحی مستقل، ریسپانسیو کامل، حالت تیره، دسترس‌پذیری).
- **داده‌ها روی سرور ذخیره می‌شوند** (Cloudflare D1) و از طریق API خوانده/نوشته می‌شوند.
- حافظه مرورگر فقط نقش **کش آفلاین** دارد؛ منبع اصلی داده سرور است. با ورود از هر گوشی یا مرورگر، همان داده‌ها نمایش داده می‌شود.

## ساختار پروژه

```
hesabyar2/
├─ public/                 ← فایل‌های ساکن (خروجی بیلد)
│  ├─ index.html           ← پوسته برنامه + صفحه ورود
│  ├─ manifest.webmanifest ← نصب روی گوشی (PWA)
│  ├─ sw.js                ← کش پوسته برای کار آفلاین
│  ├─ assets/app.css       ← سیستم طراحی (توکن‌ها، کامپوننت‌ها، ریسپانسیو، چاپ)
│  └─ js/
│     ├─ core.js           ← تقویم شمسی، قالب اعداد، منطق حسابداری
│     ├─ data.js           ← کلاینت API، مخزن داده، صف آفلاین، موتور سینک
│     ├─ ui.js             ← کامپوننت‌های مشترک (کارت، جدول، کشو، دیالوگ، اعلان)
│     ├─ views-sales.js    ← داشبورد، فاکتورها، کالاها، ورود گروهی
│     ├─ views-finance.js  ← درآمد/هزینه، حساب‌ها، طرف‌حساب‌ها، چک، بودجه، اسناد، گزارش، تنظیمات
│     └─ app.js            ← ورود، مسیریابی، منو، جستجو، تم، نشانگر سینک
├─ functions/api/[[route]].js ← API روی Cloudflare Pages Functions
├─ schema.sql              ← ساختار دیتابیس D1
└─ wrangler.toml
```

## راه‌اندازی (یک‌بار انجام می‌شود)

### ۱) ساخت دیتابیس

```bash
npm i -g wrangler
wrangler login
npx wrangler d1 create hesabyar
```

خروجی یک `database_id` می‌دهد؛ آن را در `wrangler.toml` جای `<DATABASE_ID>` بگذارید.

### ۲) ساخت جدول‌ها

```bash
npx wrangler d1 execute hesabyar --file=./schema.sql --remote
```

### ۳) اتصال پروژه به Cloudflare Pages

پروژه را در GitHub پوش کنید، سپس در داشبورد Cloudflare:

- **Workers & Pages → Create → Pages → Connect to Git**
- **Framework preset:** `None`
- **Build command:** خالی بگذارید
- **Build output directory:** `public`

### ۴) اتصال دیتابیس و رمزها

در تنظیمات پروژه Pages:

- **Settings → Functions → D1 database bindings:** نام متغیر `DB` → دیتابیس `hesabyar`
- **Settings → Environment variables → Secrets:**
  - `APP_PASSWORD` = رمزی که موقع ورود می‌زنید
  - `AUTH_SECRET` = یک رشته تصادفی بلند (مثلاً خروجی `openssl rand -hex 32`)

سپس یک بار **Retry deployment** بزنید.

### ۵) اجرای محلی (اختیاری)

```bash
npx wrangler pages dev public --d1 DB=hesabyar
```

## API

| متد | مسیر | کار |
|---|---|---|
| POST | `/api/auth/login` | ورود با رمز مشترک، دریافت توکن ۳۰ روزه |
| GET | `/api/auth/session` | بررسی اعتبار توکن |
| GET | `/api/state?since=` | دریافت تغییرات از یک زمان به بعد |
| POST | `/api/sync` | ارسال تغییرات + دریافت تغییرات سرور |
| GET | `/api/export` | خروجی کامل پشتیبان |
| POST | `/api/reset` | پاک کردن همه داده‌ها (`{"confirm":"DELETE"}`) |

هر رکورد: `{ id, type, data, updatedAt, deleted, rev }`.
حل تعارض: **آخرین نوشته برنده است** (بر اساس `updatedAt`).

## کار آفلاین

اگر اینترنت قطع شود، ثبت‌ها در صف محلی می‌مانند و نشانگر بالای صفحه «آفلاین — n در صف» را نشان می‌دهد. به محض اتصال، صف خودکار ارسال و داده‌ها سینک می‌شود (هنگام بازگشت به تب، هر ۴۵ ثانیه، و پس از رویداد online).

## نکات امنیتی

- رمز فقط در سرور نگهداری می‌شود (Secret) و مقایسه‌اش زمان‌ثابت است.
- توکن با HMAC-SHA256 امضا می‌شود و تاریخ انقضا دارد.
- ورودی‌ها محدود به انواع مجاز رکورد و حجم مشخص هستند.
- برای چند کاربر با دسترسی جدا، کافی است جدول `users` اضافه و `records` با `user_id` تفکیک شود (ساختار برای این کار آماده است).
