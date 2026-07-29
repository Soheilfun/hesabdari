/**
 * chat.js — پروکسی امن مدل Gemini
 *
 * کلید API فقط روی Worker می‌ماند و هرگز به مرورگر نمی‌رود.
 * این مسیر در src/api.js فقط برای کاربر واردشده (توکن معتبر) فعال است.
 */

const DEFAULT_MODEL = 'gemini-2.5-flash';
const MAX_PAYLOAD_CHARS = 600000;
const MAX_CONTENTS = 80;
const UPSTREAM_TIMEOUT_MS = 45000;
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models/';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' },
});

const fail = (status, code, message) => json({ error: { code, message } }, status);

export async function handleChat(request, env) {
  if (!env.GEMINI_API_KEY) {
    return fail(503, 'chat_not_configured', 'کلید Gemini تنطیم نشده است. در تنظیمات Worker یک Secret به نام GEMINI_API_KEY بسازید.');
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, 'bad_request', 'بدنه درخواست معتبر نیست.');
  }

  const contents = Array.isArray(body?.contents) ? body.contents : null;
  if (!contents || !contents.length) {
    return fail(400, 'bad_request', 'پیامی برای ارسال وجود ندارد.');
  }

  const payload = {
    contents: contents.slice(-MAX_CONTENTS),
    generationConfig: {
      temperature: typeof body.temperature === 'number' ? body.temperature : 0.2,
      maxOutputTokens: 2048,
    },
  };
  if (body.systemInstruction) payload.systemInstruction = body.systemInstruction;
  if (Array.isArray(body.tools) && body.tools.length) payload.tools = body.tools;

  const serialized = JSON.stringify(payload);
  if (serialized.length > MAX_PAYLOAD_CHARS) {
    return fail(413, 'chat_too_large', 'گفت‌وگو خیلی طولانی شده است. گفت‌وگو را تازه کنید.');
  }

  const model = env.GEMINI_MODEL || DEFAULT_MODEL;
  const url = BASE_URL + encodeURIComponent(model) + ':generateContent';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  let upstream;
  try {
    upstream = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY,
      },
      body: serialized,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err && err.name === 'AbortError') {
      return fail(504, 'chat_timeout', 'مدل در زمان مقرر پاسخ نداد. دوباره تلاش کنید.');
    }
    return fail(504, 'chat_unreachable', 'اتصال به سرویس مدل برقرار نشد.');
  }
  clearTimeout(timer);

  const data = await upstream.json().catch(() => null);

  if (!upstream.ok) {
    const detail = data?.error?.message || ('خطای ' + upstream.status);
    if (upstream.status === 429) {
      return fail(429, 'chat_rate_limited', 'سهمیه درخواست‌های مدل پر شده است. کمی بعد دوباره امتحان کنید.');
    }
    if (upstream.status === 400 || upstream.status === 403) {
      return fail(502, 'chat_key_invalid', 'کلید Gemini پذیرفته نشد: ' + detail);
    }
    return fail(502, 'chat_upstream_error', 'پاسخ مدل با خطا مواجه شد: ' + detail);
  }

  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const text = parts.filter((p) => typeof p.text === 'string').map((p) => p.text).join('').trim();
  const functionCalls = parts
    .filter((p) => p.functionCall && p.functionCall.name)
    .map((p) => ({ name: p.functionCall.name, args: p.functionCall.args || {} }));

  if (!text && !functionCalls.length) {
    const reason = candidate?.finishReason || data?.promptFeedback?.blockReason || '';
    return fail(502, 'chat_empty', 'مدل پاسخی برنگرداند' + (reason ? ' (' + reason + ')' : '') + '.');
  }

  const usage = data?.usageMetadata || {};
  return json({
    text,
    functionCalls,
    finishReason: candidate?.finishReason || '',
    usage: {
      prompt: usage.promptTokenCount || 0,
      output: usage.candidatesTokenCount || 0,
      total: usage.totalTokenCount || 0,
    },
    model,
  });
}
