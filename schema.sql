-- =============================================================
--  حساب‌یار | ساختار دیتابیس Cloudflare D1
--  اجرا:  npx wrangler d1 execute hesabyar --file=./schema.sql --remote
-- =============================================================

-- جدول اصلی: هر رکورد دامنه (کالا، فاکتور، تراکنش، چک …) یک سطر است.
-- این مدل «document store» باعث می‌شود افزودن فیلد یا ماژول جدید
-- بدون migration و بدون تغییر قرارداد API انجام شود، در حالی که
-- همگام‌سازی دوطرفه (LWW) با یک ایندکس زمانی ساده می‌ماند.
CREATE TABLE IF NOT EXISTS records (
  id          TEXT    PRIMARY KEY,          -- شناسه سراسری (در کلاینت ساخته می‌شود)
  type        TEXT    NOT NULL,             -- product | contact | account | invoice | txn | cheque | budget | doc | settings
  data        TEXT    NOT NULL,             -- محتوای JSON رکورد
  updated_at  INTEGER NOT NULL,             -- epoch ms — مبنای همگام‌سازی
  deleted     INTEGER NOT NULL DEFAULT 0,   -- حذف نرم (tombstone) تا حذف هم سینک شود
  rev         INTEGER NOT NULL DEFAULT 1    -- شمارنده ویرایش
);

CREATE INDEX IF NOT EXISTS idx_records_updated ON records (updated_at);
CREATE INDEX IF NOT EXISTS idx_records_type    ON records (type, updated_at);

-- جدول کمکی برای متادیتای سرور (نسخه اسکیما، زمان آخرین پشتیبان …)
CREATE TABLE IF NOT EXISTS meta (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- دفترچه رویدادها: برای ردیابی تغییرات حساس و عیب‌یابی
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         INTEGER NOT NULL,
  action     TEXT    NOT NULL,   -- upsert | delete | login | login_failed
  entity     TEXT,
  entity_id  TEXT,
  device     TEXT,
  ip         TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log (at);

INSERT OR IGNORE INTO meta (key, value, updated_at)
VALUES ('schema_version', '1', 0);
