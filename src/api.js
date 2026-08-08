/**
 * =============================================================================
 *  حساب‌یار | API سمت سرور — Cloudflare Pages Functions + D1
 * =============================================================================
 *  مسیرها:
 *    POST /api/auth/login    { password }            -> { token, expiresAt }
 *    GET  /api/auth/session                          -> { ok, expiresAt }
 *    GET  /api/state?since=<ms>                      -> { serverTime, records[] }
 *    POST /api/sync          { since, ops[] }        -> { serverTime, records[], applied }
 *    GET  /api/export                                -> خروجی کامل JSON
 *    POST /api/reset         { confirm: "DELETE" }   -> خالی کردن دیتابیس
 *
 *  امنیت:
 *    - رمز مشترک در متغیر محیطی APP_PASSWORD (Secret) نگهداری می‌شود
 *    - پس از ورود، توکن HMAC-SHA256 صادر می‌شود (بدون state سمت سرور)
 *    - مقایسه رمز در زمان ثابت انجام می‌شود
 *    - تمام کوئری‌ها prepared statement هستند (بدون امکان SQL Injection)
 * =============================================================================
 */

import { handleChat } from './chat.js';

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // ۳۰ روز
const MAX_OPS_PER_SYNC = 500;
const ALLOWED_TYPES = new Set([
  'settings', 'account', 'contact', 'product',
  'invoice', 'txn', 'cheque', 'budget', 'doc', 'order',
]);

/* ------------------------------ helpers ---------------------------------- */

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extra,
    },
  });

const fail = (status, code, message) => json({ error: { code, message } }, status);

const enc = new TextEncoder();

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** بازگرداندن padding به base64url تا atob همیشه کار کند */
const b64urlDecode = (str) => {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  return b64 + '='.repeat((4 - (b64.length % 4)) % 4);
};

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

/** مقایسه امن دو رشته (جلوگیری از timing attack) */
function safeEqual(a = '', b = '') {
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

async function issueToken(env) {
  const payload = b64url(enc.encode(JSON.stringify({
    sub: 'shop',
    iat: Date.now(),
    exp: Date.now() + TOKEN_TTL_MS,
  })));
  const sig = await hmac(env.AUTH_SECRET, payload);
  return { token: `${payload}.${sig}`, expiresAt: Date.now() + TOKEN_TTL_MS };
}

async function verifyToken(env, token) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = await hmac(env.AUTH_SECRET, payload);
  if (!safeEqual(sig, expected)) return null;
  try {
    const body = JSON.parse(atob(b64urlDecode(payload)));
    if (!body.exp || body.exp < Date.now()) return null;
    return body;
  } catch {
    return null;
  }
}

function bearer(request) {
  const h = request.headers.get('authorization') || '';
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : '';
}

async function audit(env, action, entity, entityId, request) {
  try {
    await env.DB.prepare(
      'INSERT INTO audit_log (at, action, entity, entity_id, device, ip) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(
      Date.now(), action, entity || null, entityId || null,
      (request.headers.get('user-agent') || '').slice(0, 180),
      request.headers.get('cf-connecting-ip') || null,
    ).run();
  } catch { /* دفترچه رویداد نباید درخواست را زمین بزند */ }
}

const rowToRecord = (r) => ({
  id: r.id,
  type: r.type,
  data: r.deleted ? null : JSON.parse(r.data),
  updatedAt: r.updated_at,
  deleted: !!r.deleted,
  rev: r.rev,
});

async function changesSince(env, since) {
  const { results } = await env.DB
    .prepare('SELECT * FROM records WHERE updated_at > ? ORDER BY updated_at ASC LIMIT 50000')
    .bind(Number(since) || 0)
    .all();
  return (results || []).map(rowToRecord);
}

/* ------------------------------- routes ----------------------------------- */

async function handleLogin(request, env) {
  if (!env.APP_PASSWORD || !env.AUTH_SECRET) {
    return fail(500, 'not_configured', 'APP_PASSWORD یا AUTH_SECRET تنظیم نشده است.');
  }
  const body = await request.json().catch(() => ({}));
  if (!safeEqual(String(body.password || ''), String(env.APP_PASSWORD))) {
    await audit(env, 'login_failed', null, null, request);
    // تأخیر کوتاه برای کند کردن حمله بروت‌فورس
    await new Promise((r) => setTimeout(r, 600));
    return fail(401, 'bad_password', 'رمز عبور نادرست است.');
  }
  await audit(env, 'login', null, null, request);
  return json(await issueToken(env));
}

async function handleState(request, env, url) {
  const since = Number(url.searchParams.get('since') || 0);
  return json({ serverTime: Date.now(), records: await changesSince(env, since) });
}

/**
 * همگام‌سازی دوطرفه.
 * استراتژی حل تعارض: Last-Write-Wins بر اساس updatedAt هر رکورد.
 * عملیات کلاینت که قدیمی‌تر از نسخه سرور باشد نادیده گرفته می‌شود
 * و نسخه سرور در پاسخ برمی‌گردد تا کلاینت خود را اصلاح کند.
 */
async function handleSync(request, env) {
  const body = await request.json().catch(() => ({}));
  const ops = Array.isArray(body.ops) ? body.ops : [];
  if (ops.length > MAX_OPS_PER_SYNC) {
    return fail(413, 'too_many_ops', `حداکثر ${MAX_OPS_PER_SYNC} تغییر در هر درخواست.`);
  }

  const now = Date.now();
  const statements = [];
  let applied = 0;

  for (const op of ops) {
    if (!op || typeof op.id !== 'string' || !ALLOWED_TYPES.has(op.type)) continue;
    const updatedAt = Number(op.updatedAt) || now;

    if (op.deleted) {
      statements.push(env.DB.prepare(
        `INSERT INTO records (id, type, data, updated_at, deleted, rev)
         VALUES (?1, ?2, '{}', ?3, 1, 1)
         ON CONFLICT(id) DO UPDATE SET
           data = '{}', deleted = 1, updated_at = ?3, rev = rev + 1
         WHERE records.updated_at <= ?3`,
      ).bind(op.id, op.type, updatedAt));
    } else {
      const payload = JSON.stringify(op.data ?? {});
      if (payload.length > 200_000) continue; // محافظت از رکوردهای غیرعادی
      statements.push(env.DB.prepare(
        `INSERT INTO records (id, type, data, updated_at, deleted, rev)
         VALUES (?1, ?2, ?3, ?4, 0, 1)
         ON CONFLICT(id) DO UPDATE SET
           type = ?2, data = ?3, deleted = 0, updated_at = ?4, rev = rev + 1
         WHERE records.updated_at <= ?4`,
      ).bind(op.id, op.type, payload, updatedAt));
    }
    applied++;
  }

  if (statements.length) await env.DB.batch(statements);

  return json({
    serverTime: Date.now(),
    applied,
    records: await changesSince(env, Number(body.since) || 0),
  });
}

async function handleExport(env) {
  const { results } = await env.DB
    .prepare('SELECT * FROM records WHERE deleted = 0 ORDER BY type, updated_at')
    .all();
  const grouped = {};
  for (const row of results || []) {
    (grouped[row.type] ||= []).push(JSON.parse(row.data));
  }
  return json({ exportedAt: Date.now(), version: 2, appVersion: '1.8.0-beta', data: grouped }, 200, {
    'content-disposition': 'attachment; filename="hesabyar-server-backup.json"',
  });
}

async function handleReset(request, env) {
  const body = await request.json().catch(() => ({}));
  if (body.confirm !== 'DELETE') return fail(400, 'confirm_required', 'تأیید لازم است.');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM records'),
    env.DB.prepare('DELETE FROM audit_log'),
  ]);
  await audit(env, 'reset', null, null, request);
  return json({ ok: true });
}

/* ---------------------------- shop (public) ------------------------------- */

const onlyDigits = (v) => String(v ?? '').replace(/[^\d+]/g, '');

/** فهرست عمومی کالاها برای صفحهٔ ویترین (بدون قیمت خرید و بدون دادهٔ مالی) */
async function handleShopCatalog(env) {
  const { results } = await env.DB
    .prepare("SELECT type, data FROM records WHERE type IN ('product', 'settings') AND deleted = 0")
    .all();

  let shop = { name: 'فروشگاه', phone: '', address: '' };
  const products = [];

  for (const row of results || []) {
    let data;
    try { data = JSON.parse(row.data); } catch { continue; }
    if (row.type === 'settings') {
      shop = {
        name: String(data.shop || shop.name),
        phone: String(data.phone || ''),
        address: String(data.address || ''),
      };
      continue;
    }
    if (data.shopHidden) continue;
    products.push({
      id: String(data.id || ''),
      name: String(data.name || ''),
      sku: String(data.sku || ''),
      unit: String(data.unit || ''),
      price: Number(data.sell) || 0,
      stock: Number(data.stock) || 0,
    });
  }

  products.sort((a, b) => a.name.localeCompare(b.name, 'fa'));
  return json({ shop, products }, 200, { 'cache-control': 'no-store' });
}

/** ثبت سفارش مشتری از ویترین؛ قیمت‌ها همیشه از سرور خوانده می‌شوند */
async function handleShopOrder(request, env) {
  const body = await request.json().catch(() => ({}));
  const name = String(body.name || '').trim().slice(0, 80);
  const phone = onlyDigits(body.phone).slice(0, 20);
  const items = Array.isArray(body.items) ? body.items.slice(0, 50) : [];

  if (name.length < 2) return fail(400, 'bad_name', 'نام را کامل وارد کنید.');
  if (phone.replace(/\D/g, '').length < 8) return fail(400, 'bad_phone', 'شمارهٔ تماس معتبر نیست.');

  const ids = [...new Set(items.map((it) => String(it && it.id ? it.id : '')).filter(Boolean))];
  if (!ids.length) return fail(400, 'empty_cart', 'سبد سفارش خالی است.');

  const placeholders = ids.map((_, i) => `?${i + 1}`).join(', ');
  const { results } = await env.DB
    .prepare(`SELECT type, data FROM records WHERE deleted = 0
      AND (type = 'settings' OR (type = 'product' AND id IN (${placeholders})))`)
    .bind(...ids)
    .all();

  const catalog = new Map();
  let shopSettings = {};
  for (const row of results || []) {
    try {
      const parsed = JSON.parse(row.data);
      if (row.type === 'settings') shopSettings = parsed;
      else catalog.set(String(parsed.id), parsed);
    } catch { /* رکورد خراب */ }
  }

  // پیش‌فرض: موجودی همان لحظهٔ ثبت سفارش کم می‌شود
  const reserve = shopSettings.shopReserveStock !== false;

  const lines = [];
  for (const it of items) {
    const product = catalog.get(String(it && it.id ? it.id : ''));
    const qty = Math.min(9999, Math.max(0, Math.round(Number(it && it.qty) || 0)));
    if (!product || qty <= 0) continue;
    lines.push({
      productId: String(product.id),
      desc: String(product.name || ''),
      unit: String(product.unit || ''),
      qty,
      price: Number(product.sell) || 0,
    });
  }
  if (!lines.length) return fail(400, 'empty_cart', 'کالاهای انتخابی معتبر نیستند.');

  const now = Date.now();
  const id = `order_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const record = {
    id,
    no: `S-${String(now).slice(-6)}`,
    name,
    phone,
    address: String(body.address || '').slice(0, 400),
    note: String(body.note || '').slice(0, 400),
    payMethod: String(body.payMethod || 'هماهنگی تلفنی').slice(0, 40),
    items: lines,
    total: lines.reduce((sum, l) => sum + l.qty * l.price, 0),
    status: 'جدید',
    createdAt: now,
    source: 'سایت',
    stockTaken: reserve,
  };

  const statements = [
    env.DB.prepare(
      `INSERT INTO records (id, type, data, updated_at, deleted, rev)
       VALUES (?1, 'order', ?2, ?3, 0, 1)`,
    ).bind(id, JSON.stringify(record), now),
  ];

  // کسر فوری موجودی تا لیست کالاها در برنامه و ویترین بلافاصله تازه شود
  if (reserve) {
    for (const line of lines) {
      const product = catalog.get(line.productId);
      if (!product) continue;
      const updated = { ...product, stock: (Number(product.stock) || 0) - line.qty };
      statements.push(env.DB.prepare(
        `UPDATE records SET data = ?2, updated_at = ?3, rev = rev + 1
         WHERE id = ?1 AND type = 'product' AND deleted = 0`,
      ).bind(String(product.id), JSON.stringify(updated), now));
    }
  }

  await env.DB.batch(statements);

  await audit(env, 'shop_order', 'order', id, request);

  return json({ ok: true, no: record.no, total: record.total, stockTaken: reserve });
}

/* ------------------------------ entrypoint -------------------------------- */

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') return new Response(null, { status: 204 });
  if (!env.DB) return fail(500, 'no_database', 'اتصال D1 (بایندینگ DB) تنظیم نشده است.');

  try {
    if (path === 'auth/login' && method === 'POST') return await handleLogin(request, env);

    // مسیرهای عمومی ویترین فروشگاه (بدون نیاز به ورود)
    if (path === 'shop/catalog' && method === 'GET') return await handleShopCatalog(env);
    if (path === 'shop/order' && method === 'POST') return await handleShopOrder(request, env);

    // از اینجا به بعد همه مسیرها نیاز به توکن معتبر دارند
    const session = await verifyToken(env, bearer(request));
    if (!session) return fail(401, 'unauthorized', 'نشست معتبر نیست. دوباره وارد شوید.');

    if (path === 'auth/session' && method === 'GET') return json({ ok: true, expiresAt: session.exp });
    if (path === 'state' && method === 'GET') return await handleState(request, env, url);
    if (path === 'sync' && method === 'POST') return await handleSync(request, env);
    if (path === 'export' && method === 'GET') return await handleExport(env);
    if (path === 'reset' && method === 'POST') return await handleReset(request, env);
    if (path === 'chat' && method === 'POST') return await handleChat(request, env);

    return fail(404, 'not_found', 'مسیر یافت نشد.');
  } catch (err) {
    return fail(500, 'server_error', String(err && err.message ? err.message : err));
  }
}
