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
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="11" width="7" height="10" rx="1.5"/><rect x="3" y="15" width="7" height="6" rx="1.5"/>',
  report: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  invoice: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z"/><path d="M9 8h6M9 12h6"/>',
  box: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
  upload: '<path d="M12 16V4m0 0 4 4m-4-4L8 8"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 5.5a3 3 0 0 1 0 5.8M17 14.4a5.5 5.5 0 0 1 4 5.6"/>',
  swap: '<path d="M7 4v14m0 0 3-3m-3 3-3-3M17 20V6m0 0 3 3m-3-3-3 3"/>',
  wallet: '<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18"/><circle cx="17" cy="14.5" r="1.2" fill="currentColor" stroke="none"/>',
  cheque: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 14h5M6 10h3"/><circle cx="17" cy="12" r="2"/>',
  budget: '<circle cx="12" cy="12" r="8.5"/><path d="M12 12V4a8 8 0 0 1 7.6 5.5Z" fill="currentColor" stroke="none" opacity=".35"/><path d="M12 12l5.5 4"/>',
  doc: '<path d="M6 3h8l4 4v14H6Z"/><path d="M14 3v4h4M9 12h6M9 16h4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3.3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3.3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1Z"/>',
  edit: '<path d="M4 20h4l10-10a2.8 2.8 0 1 0-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
  print: '<path d="M7 9V4h10v5"/><rect x="3.5" y="9" width="17" height="7" rx="2"/><path d="M7 14h10v6H7Z"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  alert: '<path d="M12 4 2.8 20h18.4Z"/><path d="M12 10v4M12 17.2v.1"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 7.8v.1"/>',
  up: '<path d="M12 20V5m0 0 6 6m-6-6-6 6"/>',
  down: '<path d="M12 4v15m0 0 6-6m-6 6-6-6"/>',
  empty: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 10h18M9 5v14"/>',
};

export const icon = (name, size = 18) =>
  `<svg class="i" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name] || PATHS.info}</svg>`;

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
    return `<td${cls ? ` class="${cls}"` : ''} data-label="${esc(c.label)}">${value}</td>`;
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
        <div class="push"><button type="button" class="btn btn-ghost btn-icon" data-close aria-label="بستن">✕</button></div>
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

  const form = $('form', scrim);
  const submit = () => {
    const result = onSubmit?.(formValues(form), { form, close: closeDrawer });
    if (result !== false) closeDrawer();
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
