/**
 * views-chat.js — صفحه دستیار هوشمند
 *
 * گفت‌وگو در حافظه ماندگار است (تا زمانی که صفحه رفرش نشود)، پس جابجایی
 * بین منوها گفت‌وگو را پاک نمی‌کند.
 */

import { ChatSession, SAMPLE_PROMPTS, TOOLS } from './agent.js';
import { $, banner, card, icon, toast } from './ui.js';
import { esc } from './core.js';

const session = new ChatSession();

/** تاریخچه قابل نمایش: { kind: 'user'|'bot'|'tool'|'error'|'done', text, lines? } */
const log = [];
let busy = false;

const TOOL_LABELS = {
  find_products: 'جست‌وجوی کالا',
  find_contacts: 'جست‌وجوی طرف حساب',
  find_invoices: 'بررسی فاکتورها',
  get_invoice: 'خواندن فاکتور',
  find_transactions: 'بررسی تراکنش‌ها',
  find_cheques: 'بررسی چک‌ها',
  list_accounts: 'موجودی حساب‌ها',
  financial_summary: 'خلاصه مالی',
  compare_months: 'مقایسه ماه‌ها',
  top_products: 'پرفروش‌ها',
  list_budgets: 'بودجه',
  find_docs: 'جست‌وجوی اسناد',
  get_settings: 'خواندن تنطیمات',
  save_product: 'ثبت کالا',
  bulk_add_products: 'ثبت گروهی کالا',
  bump_prices: 'تغییر قیمت‌ها',
  adjust_stock: 'اصلاح موجودی',
  save_contact: 'ثبت طرف حساب',
  save_account: 'ثبت حساب',
  create_invoice: 'صدور فاکتور',
  record_payment: 'ثبت پرداخت',
  record_transaction: 'ثبت تراکنش',
  save_cheque: 'ثبت چک',
  set_cheque_status: 'تغییر وضعیت چک',
  set_budget: 'تعیین بودجه',
  save_doc: 'ثبت سند',
  update_settings: 'تغییر تنطیمات',
  delete_item: 'حذف رکورد',
};

const toolLabel = (name) => TOOL_LABELS[name] || TOOLS[name]?.desc || name;

const nl2br = (text) => esc(String(text || '')).replace(/\n/g, '<br>');

/* ------------------------------- رندر پیام‌ها ------------------------------- */

function bubbleHtml(entry) {
  if (entry.kind === 'user') {
    return `<div class="msg me"><div class="bubble">${nl2br(entry.text)}</div></div>`;
  }
  if (entry.kind === 'tool') {
    return `<div class="msg trace"><span class="ico" aria-hidden="true">${icon(entry.write ? 'check' : 'search', 14)}</span><span>${esc(entry.text)}</span></div>`;
  }
  if (entry.kind === 'error') {
    return `<div class="msg bot">${banner(nl2br(entry.text), 'red', icon('alert'))}</div>`;
  }
  return `<div class="msg bot"><div class="bubble">${nl2br(entry.text)}</div></div>`;
}

function logHtml() {
  if (!log.length) {
    return `<div class="chat-intro">
      <div class="ico" aria-hidden="true">${icon('info', 28)}</div>
      <div class="t">چطور کمک کنم؟</div>
      <p class="small">می‌توانید مثل حرف زدن با شاگرد مغازه بنویسید: فاکتور بزن، قیمت را زیاد کن، حساب ماه را بده. پیش از هر تغییری در داده‌ها، از شما تأیید می‌گیرم.</p>
      <div class="chat-samples">
        ${SAMPLE_PROMPTS.map((p) => `<button type="button" class="btn btn-sm" data-sample="${esc(p)}">${esc(p)}</button>`).join('')}
      </div>
    </div>`;
  }
  return log.map(bubbleHtml).join('');
}

function repaint(root) {
  const box = $('#chat-log', root);
  if (!box) return;
  box.innerHTML = logHtml();
  box.scrollTop = box.scrollHeight;
  bindSamples(root);
}

function bindSamples(root) {
  const box = $('#chat-log', root);
  if (!box) return;
  box.querySelectorAll('[data-sample]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = $('#chat-input', root);
      input.value = btn.getAttribute('data-sample');
      input.focus();
    });
  });
}

/* ------------------------------- کارت تأیید ------------------------------- */

/** کارت تأیید را درون گفت‌وگو نشان می‌دهد و منتطر تصمیم کاربر می‌ماند. */
function askConfirm(root, { name, preview, danger }) {
  return new Promise((resolve) => {
    const box = $('#chat-log', root);
    const wrap = document.createElement('div');
    wrap.className = 'msg bot';
    wrap.innerHTML = `
      <div class="confirm-card"${danger ? ' data-danger="1"' : ''}>
        <div class="cc-head">
          <span class="ico" aria-hidden="true">${icon(danger ? 'alert' : 'check', 16)}</span>
          <strong>${esc(preview?.title || toolLabel(name))}</strong>
          <span class="chip" data-tone="${danger ? 'red' : 'blue'}"><span class="dot"></span>${esc(toolLabel(name))}</span>
        </div>
        ${(preview?.lines || []).length ? `<ul class="cc-lines">${preview.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
        <div class="cluster cc-actions">
          <button type="button" class="btn btn-sm" data-no>انصراف</button>
          <button type="button" class="btn btn-sm ${danger ? 'btn-danger' : 'btn-primary'}" data-yes>${danger ? 'متوجهم، انجام بده' : 'تأیید و ثبت'}</button>
        </div>
      </div>`;
    box.appendChild(wrap);
    box.scrollTop = box.scrollHeight;

    const finish = (ok) => {
      wrap.querySelector('.cc-actions').innerHTML =
        `<span class="small">${ok ? 'تأیید شد' : 'لغو شد'}</span>`;
      resolve(ok);
    };
    wrap.querySelector('[data-yes]').addEventListener('click', () => finish(true));
    wrap.querySelector('[data-no]').addEventListener('click', () => finish(false));
    wrap.querySelector('[data-yes]').focus();
  });
}

/* --------------------------------- ارسال --------------------------------- */

async function sendMessage(root, ctx, text) {
  if (busy) return;
  const message = String(text || '').trim();
  if (!message) return;

  busy = true;
  log.push({ kind: 'user', text: message });
  repaint(root);

  const input = $('#chat-input', root);
  const sendBtn = $('#chat-send', root);
  input.value = '';
  input.disabled = true;
  sendBtn.disabled = true;
  const thinking = document.createElement('div');
  thinking.className = 'msg trace';
  thinking.innerHTML = '<span class="typing" aria-hidden="true"><i></i><i></i><i></i></span><span>دارم فکر می‌کنم…</span>';
  $('#chat-log', root).appendChild(thinking);

  let changed = false;
  try {
    const res = await session.send(message, {
      confirm: (req) => askConfirm(root, req),
      onToolStart: ({ name, write }) => {
        thinking.querySelector('span:last-child').textContent = `${toolLabel(name)}…`;
        if (write) changed = true;
      },
      onToolDone: ({ name, write, result }) => {
        if (result && result.error) {
          log.push({ kind: 'tool', write: false, text: `${toolLabel(name)}: ${result.error}` });
        } else if (result && result.cancelled) {
          log.push({ kind: 'tool', write: false, text: `${toolLabel(name)}: لغو شد` });
        } else {
          log.push({ kind: 'tool', write: !!write, text: write ? `${toolLabel(name)}: انجام شد` : toolLabel(name) });
        }
      },
    });
    thinking.remove();
    log.push({ kind: 'bot', text: res.text });
    if (changed) toast('تغییرات دستیار ثبت و همگام شد.', 'green');
  } catch (err) {
    thinking.remove();
    const code = err?.code || '';
    const map = {
      chat_not_configured: 'دستیار هنوز فعال نشده است. در تنطیمات Worker کلید GEMINI_API_KEY را بسازید.',
      chat_rate_limited: 'سهمیه درخواست مدل پر شده. چند دقیقه بعد دوباره امتحان کنید.',
      chat_key_invalid: 'کلید Gemini پذیرفته نشد. درستی کلید را در تنطیمات Worker بررسی کنید.',
      chat_too_large: 'گفت‌وگو طولانی شد. دکمه «گفت‌وگوی تازه» را بزنید.',
      chat_timeout: 'پاسخ طول کشید. دوباره امتحان کنید.',
      offline: 'دستیار برای کار کردن به اینترنت نیاز دارد. بقیه برنامه آفلاین کار می‌کند.',
      unauthorized: 'نشست منقضی شده است. دوباره وارد شوید.',
    };
    log.push({ kind: 'error', text: map[code] || err?.message || 'خطای ناشناخته در دستیار.' });
  } finally {
    busy = false;
    input.disabled = false;
    sendBtn.disabled = false;
    repaint(root);
    if (changed) ctx.refresh();
    else input.focus();
  }
}

/* --------------------------------- صفحه ---------------------------------- */

export const chat = {
  title: 'دستیار هوشمند',
  subtitle: () => 'فارسی بنویسید؛ دستیار داده‌های مغازه را می‌خواند و با تأیید شما ثبت می‌کند',
  actions: () => '<button class="btn" data-new-chat>گفت‌وگوی تازه</button>',

  render() {
    return `
      ${card({
        tight: true,
        body: `<div class="chat-wrap">
            <div class="chat-log" id="chat-log" role="log" aria-live="polite" aria-label="گفت‌وگو با دستیار">${logHtml()}</div>
            <form class="chat-composer" id="chat-form" autocomplete="off">
              <label class="sr-only" for="chat-input">پیام شما</label>
              <textarea id="chat-input" rows="1" placeholder="مثلاً: ۵ تا پیچ ۴۰ به رضایی فروختم، فاکتور بزن"></textarea>
              <button type="submit" class="btn btn-primary" id="chat-send">${icon('check', 16)}<span>ارسال</span></button>
            </form>
            <p class="chat-foot small">Enter برای ارسال — Shift+Enter برای خط جدید. تغییر داده‌ها فقط با تأیید شما انجام می‌شود.</p>
          </div>`,
      })}`;
  },

  mount(root, ctx) {
    const input = $('#chat-input', root);
    const form = $('#chat-form', root);

    bindSamples(root);
    $('#chat-log', root).scrollTop = $('#chat-log', root).scrollHeight;

    const autoGrow = () => {
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
    };
    input.addEventListener('input', autoGrow);

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        form.requestSubmit();
      }
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value;
      input.style.height = 'auto';
      void sendMessage(root, ctx, text);
    });

    root.querySelectorAll('[data-new-chat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (busy) return;
        session.reset();
        log.length = 0;
        repaint(root);
        input.focus();
      });
    });

    if (!busy) input.focus();
  },
};
