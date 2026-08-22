/**
 * ui.js — کامپوننت‌های مشترک رابط کاربری: کارت، جدول، کشوی فرم،
 * دیالوگ تأیید، اعلان و فیلدهای فرم.
 * تمام خروجی‌ها HTML رشته‌ای امن (escape شده) تولید می‌کنند.
 */

import { esc, isoToJalali, jalaliToIso, todayIso } from './core.js';

/* --------------------------- آیکون‌های خطی (SVG) ---------------------------
 * از فونت آیکون یا کاراکترهای یونیکد استفاده نمی‌کنیم تا روی همه
 * دستگاه‌ها (ویندوز، اندروید، iOS) دقیقاً یکسان دیده شوند. */
const PATHS = {
  /* نمای کلی — پنل‌های گزارش */
  dashboard: '<rect x="3" y="3" width="7.5" height="9" rx="2.2"/><rect x="13.5" y="3" width="7.5" height="5.5" rx="2.2"/><rect x="13.5" y="11.5" width="7.5" height="9.5" rx="2.2"/><rect x="3" y="15" width="7.5" height="6" rx="2.2"/>',
  /* گزارش — میله‌های مالی روی محور */
  report: '<path d="M3.5 20.5h17"/><rect x="5" y="11" width="3.6" height="6.2" rx="1.4"/><rect x="10.2" y="6.5" width="3.6" height="10.7" rx="1.4"/><rect x="15.4" y="9" width="3.6" height="8.2" rx="1.4"/>',
  /* فروشگاه — ساک خرید */
  cart: '<path d="M5 8h14l-1.1 11.2a2 2 0 0 1-2 1.8H8.1a2 2 0 0 1-2-1.8Z"/><path d="M9 10V6.8a3 3 0 0 1 6 0V10"/>',
  /* فاکتور — رسید دندانه‌دار */
  invoice: '<path d="M5.5 3.6h13v16.9l-2.2-1.4-2.1 1.4-2.2-1.4-2.2 1.4-2.1-1.4-2.2 1.4Z"/><path d="M9 8.4h6M9 12.2h6M9 15.6h3.5"/>',
  /* کالا — جعبهٔ انبار */
  box: '<path d="m12 3.2 8 4.3v9L12 20.8 4 16.5v-9Z"/><path d="m4 7.5 8 4.3 8-4.3M12 11.8v9M8 5.3l8 4.3"/>',
  /* ورود گروهی — بارگذاری در سینی */
  upload: '<path d="M12 15.5V4.2m0 0 3.8 3.8M12 4.2 8.2 8"/><path d="M4 15v3.2a2.3 2.3 0 0 0 2.3 2.3h11.4A2.3 2.3 0 0 0 20 18.2V15"/>',
  /* طرف حساب — مشتریان */
  users: '<circle cx="9.2" cy="8.2" r="3.3"/><path d="M3.2 20a6 6 0 0 1 12 0"/><path d="M16.2 5.6a3.1 3.1 0 0 1 0 5.9M17.4 14.4a5.6 5.6 0 0 1 3.4 5.6"/>',
  /* تراکنش — گردش درآمد و هزینه */
  swap: '<path d="M7 3.8v15m0 0 3.2-3.2M7 18.8 3.8 15.6"/><path d="M17 20.2v-15m0 0 3.2 3.2M17 5.2l-3.2 3.2"/>',
  /* صندوق و حساب — کیف پول */
  wallet: '<path d="M3.2 8.4A2.4 2.4 0 0 1 5.6 6h11.2a2.4 2.4 0 0 1 2.4 2.4v8.8a2.4 2.4 0 0 1-2.4 2.4H5.6a2.4 2.4 0 0 1-2.4-2.4Z"/><path d="M16 6V4.9a1.6 1.6 0 0 0-2-1.55L5.2 5.6"/><path d="M19.2 11.2h-3a1.9 1.9 0 0 0 0 3.8h3"/>',
  /* چک — برگهٔ بانکی با امضا */
  cheque: '<rect x="2.6" y="5.6" width="18.8" height="12.8" rx="2.6"/><path d="M2.6 9.6h18.8"/><path d="M6 14.4c1.2-1.4 2.2-1.4 3 0s1.7 1.4 2.8 0"/><path d="M15.6 14.4h3"/>',
  /* بودجه — سهم هزینه‌ها */
  budget: '<circle cx="12" cy="12" r="8.6"/><path d="M12 12V3.4a8.6 8.6 0 0 1 7.9 5.2Z" fill="currentColor" stroke="none" opacity=".3"/><path d="M12 12 6.4 17.8"/>',
  /* اسناد — دفتر حساب */
  doc: '<path d="M6 3.4h7.6L18.4 8v12.6H6Z"/><path d="M13.4 3.4V8h5"/><path d="M9 12.4h6M9 16h4"/>',
  /* تنظیمات — لغزنده‌ها */
  settings: '<path d="M4 7.2h9M17.4 7.2H20M4 16.8h3.6M12 16.8h8"/><circle cx="15.2" cy="7.2" r="2.4"/><circle cx="9.6" cy="16.8" r="2.4"/>',
  /* ویرایش — قلم */
  edit: '<path d="M4 20h4l10.2-10.2a2.9 2.9 0 0 0-4.1-4.1L4 16Z"/><path d="m13.6 6.4 4.1 4.1M4 20l1-4"/>',
  trash: '<path d="M4 6.8h16M9.4 6.8V4.9h5.2v1.9"/><path d="M6.4 6.8 7.5 20h9l1.1-13.2"/><path d="M10.4 10.6v5.6M13.6 10.6v5.6"/>',
  /* چاپ فاکتور */
  print: '<path d="M7 9.2V3.8h10v5.4"/><path d="M4 9.2h16a1.6 1.6 0 0 1 1.6 1.6v4.4A1.6 1.6 0 0 1 20 16.8h-3V20H7v-3.2H4a1.6 1.6 0 0 1-1.6-1.6v-4.4A1.6 1.6 0 0 1 4 9.2Z"/><path d="M7 13.2h10"/>',
  check: '<path d="m4.8 12.6 4.6 4.6L19.2 7.4"/>',
  alert: '<path d="M10.3 4.2 2.9 17.6A2 2 0 0 0 4.6 20.6h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/><path d="M12 10v4M12 17.4v.1"/>',
  info: '<circle cx="12" cy="12" r="8.6"/><path d="M12 11.2v5M12 7.8v.1"/>',
  up: '<path d="M12 20V4.6m0 0 5.6 5.6M12 4.6 6.4 10.2"/>',
  down: '<path d="M12 4v15.4m0 0 5.6-5.6M12 19.4l-5.6-5.6"/>',
  /* خالی — قفسهٔ بدون کالا */
  empty: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10.4h18M9.2 5v14"/>',
  search: '<circle cx="11" cy="11" r="6.6"/><path d="m15.9 15.9 4.6 4.6"/>',
  theme: '<circle cx="12" cy="12" r="8.6"/><path d="M12 3.4v17.2a8.6 8.6 0 0 0 0-17.2Z" fill="currentColor" stroke="none"/>',
  power: '<path d="M12 3.2v8.4"/><path d="M7.1 6.4a7.6 7.6 0 1 0 9.8 0"/>',
  close: '<path d="m6.2 6.2 11.6 11.6M17.8 6.2 6.2 17.8"/>',
  download: '<path d="M12 4v11.4m0 0 4-4m-4 4-4-4"/><path d="M4.4 19.4h15.2"/>',
  /* دستیار هوشمند */
  sparkle: '<path d="m11.6 3.4 1.9 4.7 4.7 1.9-4.7 1.9-1.9 4.7-1.9-4.7L5 10l4.7-1.9Z"/><path d="m18.2 15.4.9 2.2 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9 2.2-.9Z"/>',
  /* آیکون‌های تکمیلی حسابداری */
  coins: '<ellipse cx="9" cy="6.6" rx="5.4" ry="2.6"/><path d="M3.6 6.6v4.2c0 1.4 2.4 2.6 5.4 2.6s5.4-1.2 5.4-2.6V6.6"/><ellipse cx="15" cy="9.2" rx="5.4" ry="2.6"/><path d="M9.6 13.6c.5 1.2 2.7 2.1 5.4 2.1 3 0 5.4-1.2 5.4-2.6V9.2"/><path d="M9.6 17.4c.5 1.2 2.7 2.1 5.4 2.1 3 0 5.4-1.2 5.4-2.6"/>',
  calculator: '<rect x="4.4" y="2.8" width="15.2" height="18.4" rx="3"/><rect x="7.4" y="5.8" width="9.2" height="3.4" rx="1.2"/><path d="M8 13h.1M12 13h.1M16 13h.1M8 17h.1M12 17h.1M16 17h.1"/>',
  bank: '<path d="M3.4 9.4 12 4.2l8.6 5.2"/><path d="M5.6 9.8v8M10 9.8v8M14 9.8v8M18.4 9.8v8"/><path d="M3.2 20.4h17.6"/>',
  receipt: '<path d="M6 3.6h12v17l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3Z"/><path d="M9.4 8.4h5.2M9.4 12.4h5.2"/>',
  percent: '<circle cx="7.6" cy="7.6" r="2.8"/><circle cx="16.4" cy="16.4" r="2.8"/><path d="M18.6 5.4 5.4 18.6"/>',
  tag: '<path d="M11.4 3.4H20v8.6l-8.6 8.6a1.8 1.8 0 0 1-2.5 0l-6.1-6.1a1.8 1.8 0 0 1 0-2.5Z"/><circle cx="16.2" cy="7.8" r="1.4"/>',
  clock: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.2V12l3.2 2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  filter: '<path d="M3.6 5.4h16.8l-6.4 7.6v6.2l-4-2v-4.2Z"/>',
};

export const icon = (name, size = 18) =>
  `<svg class="i" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name] || PATHS.info}</svg>`;

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ------------------------------ قطعات HTML ------------------------------ */

export const card = ({ title = '', actions = '', body = '', tight = false, id = '' }) => `
  <section class="card"${id ? ` id="${id}"` : ''}>
    ${title || actions ? `<header class="card-head"><h3>${esc(title)}</h3><div class="push cluster">${actions}</div></header>` : ''}
    <div class="card-body${tight ? ' tight' : ''}">${body}</div>
  </section>`;

export const stat = ({ label, value, unit = '', hint = '', tone = '', icon = '' }) => `
  <article class="stat"${tone ? ` data-tone="${tone}"` : ''}>
    <div class="k">${icon ? `<span aria-hidden="true">${icon}</span>` : ''}<span>${esc(label)}</span></div>
    <div class="v">${value}${unit ? ` <span class="unit">${esc(unit)}</span>` : ''}</div>
    ${hint ? `<div class="h">${hint}</div>` : ''}
  </article>`;

export const chip = (text, tone = '') =>
  `<span class="chip"${tone ? ` data-tone="${tone}"` : ''}><span class="dot" aria-hidden="true"></span>${esc(text)}</span>`;

export const banner = (text, tone = 'blue', leading = icon('info'), actions = '') =>
  `<div class="banner" data-tone="${tone}"><span class="ico" aria-hidden="true">${leading}</span><div>${text}</div><div class="push cluster">${actions}</div></div>`;

export const empty = (title, hint = '', leading = icon('empty', 28), actions = '') =>
  `<div class="empty"><div class="ico" aria-hidden="true">${leading}</div><div class="t">${esc(title)}</div>${hint ? `<div class="small">${esc(hint)}</div>` : ''}${actions ? `<div class="cluster">${actions}</div>` : ''}</div>`;

export const tabs = (items, active, attr = 'data-tab') => `
  <div class="tabs" role="tablist">
    ${items.map((it) => `<button type="button" class="tab" role="tab" ${attr}="${esc(it.key)}" aria-selected="${it.key === active}">${esc(it.label)}</button>`).join('')}
  </div>`;

/**
 * جدول داده که در موبایل به کارت تبدیل می‌شود (بدون اسکرول افقی).
 * columns: [{ key, label, num?, cell?(row) }]
 */
export function table(columns, rows, { emptyState = empty('موردی ثبت نشده است') } = {}) {
  if (!rows.length) return emptyState;
  const head = columns.map((c) => `<th${c.num ? ' class="num"' : ''}${c.key === 'actions' ? ' class="actions"' : ''}>${esc(c.label)}</th>`).join('');
  const body = rows.map((row) => `<tr${row._id ? ` data-row="${esc(row._id)}"` : ''}>${columns.map((c) => {
    // مقادیر ردیف‌ها در خود view ساخته و escape می‌شوند؛ اینجا HTML محسوب می‌شوند.
    const value = c.cell ? c.cell(row) : (row[c.key] ?? '');
    const cls = c.key === 'actions' ? 'actions' : (c.num ? 'num' : '');
    // ستون بدون عنوان (مانند ستون دکمه‌ها) در موبایل برچسب خالی نمی‌گیرد
    return `<td${cls ? ` class="${cls}"` : ''}${c.label ? ` data-label="${esc(c.label)}"` : ''}>${value}</td>`;
  }).join('')}</tr>`).join('');
  return `<div class="table-wrap"><table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export const rowActions = (buttons) =>
  `<div class="cluster">${buttons.map((b) =>
    `<button type="button" class="btn btn-sm btn-icon${b.danger ? ' btn-danger' : ''}" ${b.attrs || ''} title="${esc(b.title)}" aria-label="${esc(b.title)}">${b.icon}</button>`).join('')}</div>`;

/* -------------------------------- فیلدها -------------------------------- */

const fieldWrap = (label, control, { hint = '', span = false } = {}) =>
  `<div class="field${span ? ' span-2' : ''}">${label ? `<label class="lbl">${esc(label)}</label>` : ''}${control}${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</div>`;

export const text = (name, label, value = '', o = {}) => fieldWrap(label,
  `<input name="${name}" value="${esc(value)}" placeholder="${esc(o.placeholder || '')}" ${o.attrs || ''} />`, o);

export const number = (name, label, value = '', o = {}) => fieldWrap(label,
  `<input name="${name}" class="nums" inputmode="decimal" value="${esc(value)}" placeholder="${esc(o.placeholder || '')}" ${o.attrs || ''} />`, o);

export const textarea = (name, label, value = '', o = {}) => fieldWrap(label,
  `<textarea name="${name}" placeholder="${esc(o.placeholder || '')}" ${o.attrs || ''}>${esc(value)}</textarea>`, { ...o, span: o.span ?? true });

export const select = (name, label, options, value = '', o = {}) => fieldWrap(label,
  `<div class="select-wrap"><select name="${name}" ${o.attrs || ''}>${(o.blank ? [{ v: '', t: o.blank }] : [])
    .concat(options.map((op) => (typeof op === 'string' ? { v: op, t: op } : op)))
    .map((op) => `<option value="${esc(op.v)}"${String(op.v) === String(value) ? ' selected' : ''}>${esc(op.t)}</option>`).join('')}</select></div>`, o);

/** تاریخ شمسی متنی: ۱۴۰۵/۰۵/۰۶ */
export const dateField = (name, label, iso = todayIso(), o = {}) => fieldWrap(label,
  `<input name="${name}" class="nums" data-jdate="1" inputmode="numeric" value="${esc(isoToJalali(iso))}" placeholder="۱۴۰۵/۰۵/۰۶" ${o.attrs || ''} />`, o);

export const checkbox = (name, label, checked = false, o = {}) =>
  `<div class="field${o.span ? ' span-2' : ''}"><label class="check"><input type="checkbox" name="${name}"${checked ? ' checked' : ''} /> <span>${esc(label)}</span></label>${o.hint ? `<span class="hint">${esc(o.hint)}</span>` : ''}</div>`;

/** خواندن مقادیر فرم به صورت شیء (تاریخ‌ها خودکار به ISO تبدیل می‌شوند) */
export function formValues(root) {
  const out = {};
  $$('input, select, textarea', root).forEach((el) => {
    if (!el.name) return;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.dataset.jdate) out[el.name] = jalaliToIso(el.value) || '';
    else out[el.name] = el.value.trim();
  });
  return out;
}

/* ------------------------------- کشوی فرم ------------------------------- */

let activeDrawer = null;

/**
 * نمایش فرم در کشوی کناری (در موبایل: شیت پایین).
 * onSubmit(values, api) — برگرداندن false یعنی پنجره باز بماند.
 */
export function openDrawer({ title, body, submitLabel = 'ذخیره', extraActions = '', onSubmit, onMount, wide = false }) {
  closeDrawer();
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  scrim.innerHTML = `
    <div class="drawer" role="dialog" aria-modal="true" aria-label="${esc(title)}"${wide ? ' style="width:min(900px,100%)"' : ''}>
      <header class="drawer-head">
        <h2 style="font-size:1.05rem">${esc(title)}</h2>
        <div class="push"><button type="button" class="btn btn-ghost btn-icon" data-close aria-label="بستن">${icon('close')}</button></div>
      </header>
      <form class="drawer-body" novalidate>${body}</form>
      <footer class="drawer-foot">
        ${extraActions}
        <div class="push cluster">
          <button type="button" class="btn" data-close>انصراف</button>
          ${onSubmit ? `<button type="button" class="btn btn-primary" data-submit>${esc(submitLabel)}</button>` : ''}
        </div>
      </footer>
    </div>`;
  document.body.appendChild(scrim);
  document.body.style.overflow = 'hidden';
  activeDrawer = scrim;
  // اگر پنجره دیگری باز بود، اسکرول آن حفظ می‌شود؛ کشوی جدید باید از بالا باز شود
  requestAnimationFrame(() => { scrim.scrollTop = 0; });

  const form = $('form', scrim);
  let submitLock = false;
  const submit = () => {
    if (submitLock) return; // جلوگیری از ثبت دوباره (دابل‌کلیک / Enter پشت سر هم)
    submitLock = true;
    try {
      const result = onSubmit?.(formValues(form), { form, close: closeDrawer });
      if (result !== false) closeDrawer();
    } finally {
      submitLock = false;
    }
  };

  scrim.addEventListener('click', (e) => {
    if (e.target === scrim || e.target.closest('[data-close]')) closeDrawer();
    if (e.target.closest('[data-submit]')) submit();
  });
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
      // Enter = رفتن به فیلد بعدی؛ در آخرین فیلد = ذخیره
      const fields = $$('input, select, textarea', form).filter((el) => !el.disabled && el.type !== 'hidden');
      const index = fields.indexOf(e.target);
      if (index > -1 && index < fields.length - 1) fields[index + 1].focus();
      else submit();
    }
  });
  scrim.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

  onMount?.(form, { close: closeDrawer, submit });
  setTimeout(() => $('input, select, textarea', form)?.focus(), 60);
  return { form, close: closeDrawer };
}

export function closeDrawer() {
  if (!activeDrawer) return;
  activeDrawer.remove();
  activeDrawer = null;
  document.body.style.overflow = '';
}

/* ------------------------------ تأیید و اعلان ------------------------------ */

export function confirmDialog({ title, message, confirmLabel = 'حذف', danger = true }) {
  return new Promise((resolve) => {
    const scrim = document.createElement('div');
    scrim.className = 'dialog-scrim';
    scrim.innerHTML = `
      <div class="dialog" role="alertdialog" aria-modal="true">
        <h3>${esc(title)}</h3>
        <p class="muted small">${esc(message)}</p>
        <div class="cluster">
          <button type="button" class="btn push" data-no>انصراف</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-yes>${esc(confirmLabel)}</button>
        </div>
      </div>`;
    const done = (value) => { scrim.remove(); resolve(value); };
    scrim.addEventListener('click', (e) => {
      if (e.target === scrim || e.target.closest('[data-no]')) done(false);
      if (e.target.closest('[data-yes]')) done(true);
    });
    scrim.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(false); });
    document.body.appendChild(scrim);
    $('[data-yes]', scrim).focus();
  });
}

let toaster;
export function toast(message, tone = '') {
  if (!toaster) {
    toaster = document.createElement('div');
    toaster.className = 'toaster';
    toaster.setAttribute('role', 'status');
    toaster.setAttribute('aria-live', 'polite');
    document.body.appendChild(toaster);
  }
  const el = document.createElement('div');
  el.className = 'toast';
  if (tone) el.dataset.tone = tone;
  el.textContent = message;
  toaster.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

/* -------------------------------- دانلود -------------------------------- */

export function download(filename, content, type = 'application/json;charset=utf-8') {
  const blob = new Blob(['\ufeff', content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
