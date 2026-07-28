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

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // ۳۰ روز
const MAX_OPS_PER_SYNC = 500;
const ALLOWED_TYPES = new Set([
  'settings', 'account', 'contact', 'product',
  'invoice', 'txn', 'cheque', 'budget', 'doc',
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
    const body = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
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
    .prepare('SELECT * FROM records WHERE updated_at > ? ORDER BY updated_at ASC LIMIT 5000')
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
  return json({ exportedAt: Date.now(), version: 2, data: grouped }, 200, {
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

    // از اینجا به بعد همه مسیرها نیاز به توکن معتبر دارند
    const session = await verifyToken(env, bearer(request));
    if (!session) return fail(401, 'unauthorized', 'نشست معتبر نیست. دوباره وارد شوید.');

    if (path === 'auth/session' && method === 'GET') return json({ ok: true, expiresAt: session.exp });
    if (path === 'state' && method === 'GET') return await handleState(request, env, url);
    if (path === 'sync' && method === 'POST') return await handleSync(request, env);
    if (path === 'export' && method === 'GET') return await handleExport(env);
    if (path === 'reset' && method === 'POST') return await handleReset(request, env);

    return fail(404, 'not_found', 'مسیر یافت نشد.');
  } catch (err) {
    return fail(500, 'server_error', String(err && err.message ? err.message : err));
  }
}
