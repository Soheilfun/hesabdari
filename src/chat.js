/**
 * chat.js — پروکسی امن مدل هوش مصنوعی
 *
 * از دو نوع سرویس پشتیبانی می‌کند:
 *   1) سرویس‌های سازگار با OpenAI (Mistral، 9Router، OpenRouter، AvalAI، GapGPT، لیارا …)
 *      متغیرها: AI_API_KEY (اجباری) ، AI_BASE_URL ، AI_MODEL
 *   2) Gemini با فرمت بومی خودش — متغیرها: GEMINI_API_KEY ، GEMINI_MODEL
 *
 * فرمت گفت‌وگوی سمت مرورگر در هر دو حالت یکسان است؛ ترجمه اینجا انجام می‌شود،
 * پس با عوض کردن فقط متغیرها می‌توان سرویس را عوض کرد.
 *
 * کلید API فقط روی Worker می‌ماند و هرگز به مرورگر نمی‌رود.
 */

const DEFAULT_OPENAI_BASE = 'https://api.mistral.ai/v1';
const DEFAULT_OPENAI_MODEL = 'mistral-medium-3-5';
const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

const MAX_PAYLOAD_CHARS = 600000;
const MAX_CONTENTS = 80;
const UPSTREAM_TIMEOUT_MS = 45000;
const RETRY_DELAYS_MS = [1200, 3500]; // برای خطاهای 429 و 5xx

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' },
});

const fail = (status, code, message) => json({ error: { code, message } }, status);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const textOfParts = (parts) => (parts || [])
  .filter((p) => typeof p.text === 'string')
  .map((p) => p.text)
  .join('\n')
  .trim();

/* ------------------- ترجمه فرمت Gemini به فرمت OpenAI ------------------- */

function toOpenAiMessages(contents, systemInstruction) {
  const messages = [];
  const systemText = textOfParts(systemInstruction?.parts);
  if (systemText) messages.push({ role: 'system', content: systemText });

  let pending = []; // فراخوانی‌های منتظر پاسخ: { id, name, used }
  let counter = 0;

  for (const item of contents) {
    const parts = item.parts || [];
    const calls = parts.filter((p) => p.functionCall);
    const results = parts.filter((p) => p.functionResponse);
    const text = textOfParts(parts);

    if (results.length) {
      for (const part of results) {
        const name = part.functionResponse.name;
        const match = pending.find((c) => c.name === name && !c.used);
        if (match) match.used = true;
        messages.push({
          role: 'tool',
          tool_call_id: match ? match.id : `call_${counter++}`,
          name,
          content: JSON.stringify(part.functionResponse.response ?? {}),
        });
      }
      continue;
    }

    if (item.role === 'model') {
      const message = { role: 'assistant', content: text || '' };
      if (calls.length) {
        pending = calls.map((part) => ({
          id: `call_${counter++}`,
          name: part.functionCall.name,
          used: false,
        }));
        message.tool_calls = calls.map((part, i) => ({
          id: pending[i].id,
          type: 'function',
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args || {}),
          },
        }));
        if (!message.content) message.content = '';
      }
      messages.push(message);
      continue;
    }

    messages.push({ role: 'user', content: text });
  }

  return messages;
}

const toOpenAiTools = (tools) => (tools || [])
  .flatMap((group) => group.functionDeclarations || [])
  .map((decl) => ({
    type: 'function',
    function: {
      name: decl.name,
      description: decl.description || '',
      parameters: decl.parameters || { type: 'object', properties: {} },
    },
  }));

function fromOpenAiResponse(data, model) {
  const choice = data?.choices?.[0];
  const message = choice?.message || {};
  const text = typeof message.content === 'string'
    ? message.content.trim()
    : Array.isArray(message.content)
      ? message.content.filter((c) => typeof c.text === 'string').map((c) => c.text).join('').trim()
      : '';

  const functionCalls = (message.tool_calls || [])
    .filter((call) => call?.function?.name)
    .map((call) => {
      let args = {};
      try {
        const raw = call.function.arguments;
        args = typeof raw === 'string' ? (raw ? JSON.parse(raw) : {}) : (raw || {});
      } catch {
        args = {};
      }
      return { name: call.function.name, args };
    });

  const usage = data?.usage || {};
  return {
    text,
    functionCalls,
    finishReason: choice?.finish_reason || '',
    usage: {
      prompt: usage.prompt_tokens || 0,
      output: usage.completion_tokens || 0,
      total: usage.total_tokens || 0,
    },
    model,
  };
}

function fromGeminiResponse(data, model) {
  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const text = parts.filter((p) => typeof p.text === 'string').map((p) => p.text).join('').trim();
  const functionCalls = parts
    .filter((p) => p.functionCall && p.functionCall.name)
    .map((p) => ({ name: p.functionCall.name, args: p.functionCall.args || {} }));
  const usage = data?.usageMetadata || {};
  return {
    text,
    functionCalls,
    finishReason: candidate?.finishReason || '',
    usage: {
      prompt: usage.promptTokenCount || 0,
      output: usage.candidatesTokenCount || 0,
      total: usage.totalTokenCount || 0,
    },
    model,
  };
}

/* ---------------------------- درخواست به سرویس ---------------------------- */

async function callUpstream(url, headers, body) {
  let last = { status: 0, data: null, networkError: '' };

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const res = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });
      clearTimeout(timer);
      const data = await res.json().catch(() => null);
      last = { status: res.status, data, networkError: '' };
      // شلوغی یا خطای موقت سرور ← دوباره تلاش کن
      if ((res.status === 429 || res.status >= 500) && attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      return last;
    } catch (err) {
      clearTimeout(timer);
      last = {
        status: 0,
        data: null,
        networkError: err && err.name === 'AbortError' ? 'timeout' : 'unreachable',
      };
      if (attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      return last;
    }
  }
  return last;
}

const upstreamMessage = (data) => data?.error?.message
  || data?.message
  || (typeof data?.error === 'string' ? data.error : '')
  || '';

/* --------------------------------- مسیر --------------------------------- */

export async function handleChat(request, env) {
  const openAiKey = env.AI_API_KEY || env.MISTRAL_API_KEY || '';
  const geminiKey = env.GEMINI_API_KEY || '';

  if (!openAiKey && !geminiKey) {
    return fail(503, 'chat_not_configured', 'کلید هوش مصنوعی تنطیم نشده است. در تنطیمات Worker یک Secret به نام AI_API_KEY بسازید.');
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, 'bad_request', 'بدنه درخواست معتبر نیست.');
  }

  const contents = Array.isArray(body?.contents) ? body.contents.slice(-MAX_CONTENTS) : null;
  if (!contents || !contents.length) {
    return fail(400, 'bad_request', 'پیامی برای ارسال وجود ندارد.');
  }

  const temperature = typeof body.temperature === 'number' ? body.temperature : 0.2;
  const useOpenAi = Boolean(openAiKey);

  let url;
  let headers;
  let payload;
  let model;

  if (useOpenAi) {
    const base = (env.AI_BASE_URL || DEFAULT_OPENAI_BASE).replace(/\/+$/, '');
    model = env.AI_MODEL || DEFAULT_OPENAI_MODEL;
    url = base + '/chat/completions';
    headers = {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: 'Bearer ' + openAiKey,
    };
    payload = {
      model,
      messages: toOpenAiMessages(contents, body.systemInstruction),
      temperature,
      max_tokens: 2048,
      stream: false,
    };
    const tools = toOpenAiTools(body.tools);
    if (tools.length) {
      payload.tools = tools;
      payload.tool_choice = 'auto';
    }
  } else {
    model = env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
    url = GEMINI_BASE + encodeURIComponent(model) + ':generateContent';
    headers = {
      'content-type': 'application/json',
      'x-goog-api-key': geminiKey,
    };
    payload = {
      contents,
      generationConfig: { temperature, maxOutputTokens: 2048 },
    };
    if (body.systemInstruction) payload.systemInstruction = body.systemInstruction;
    if (Array.isArray(body.tools) && body.tools.length) payload.tools = body.tools;
  }

  const serialized = JSON.stringify(payload);
  if (serialized.length > MAX_PAYLOAD_CHARS) {
    return fail(413, 'chat_too_large', 'گفت‌وگو خیلی طولانی شده است. گفت‌وگو را تازه کنید.');
  }

  const { status, data, networkError } = await callUpstream(url, headers, serialized);

  if (networkError === 'timeout') {
    return fail(504, 'chat_timeout', 'مدل در زمان مقرر پاسخ نداد. دوباره تلاش کنید.');
  }
  if (networkError) {
    return fail(504, 'chat_unreachable', 'اتصال به سرویس مدل برقرار نشد. آدرس AI_BASE_URL را بررسی کنید.');
  }

  if (status < 200 || status >= 300) {
    const detail = upstreamMessage(data) || ('خطای ' + status);
    if (status === 429) {
      return fail(429, 'chat_rate_limited', 'سهمیه یا ظرفیت مدل پر شده است. کمی بعد دوباره امتحان کنید.');
    }
    if (status === 401 || status === 403) {
      return fail(502, 'chat_key_invalid', 'کلید API پذیرفته نشد: ' + detail);
    }
    if (status === 404) {
      return fail(502, 'chat_model_missing', 'این مدل یا آدرس پیدا نشد. مقدار AI_MODEL و AI_BASE_URL را بررسی کنید: ' + detail);
    }
    if (status >= 500) {
      return fail(503, 'chat_overloaded', 'سرور مدل شلوغ است و دو بار تلاش مجدد هم جواب نداد. کمی بعد دوباره امتحان کنید.');
    }
    return fail(502, 'chat_upstream_error', 'پاسخ مدل با خطا مواجه شد: ' + detail);
  }

  const result = useOpenAi ? fromOpenAiResponse(data, model) : fromGeminiResponse(data, model);

  if (!result.text && !result.functionCalls.length) {
    const reason = result.finishReason || data?.promptFeedback?.blockReason || '';
    return fail(502, 'chat_empty', 'مدل پاسخی برنگرداند' + (reason ? ' (' + reason + ')' : '') + '.');
  }

  return json(result);
}
