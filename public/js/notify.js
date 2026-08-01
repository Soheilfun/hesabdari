/**
 * notify.js — یادآور چک: بنر داخل برنامه و نوتیفیکیشن مرورگر.
 * نوتیفیکیشن روزی یک‌بار و فقط با اجازه کاربر فرستاده می‌شود.
 */

import { chequesDueSoon, faNum, isoToJalali, money, num, todayIso } from './core.js';

const SEEN_KEY = 'hesabyar.chequeNotified';

/** آیا مرورگر از نوتیفیکیشن پشتیبانی می‌کند؟ */
export const notifySupported = () => typeof window !== 'undefined' && 'Notification' in window;

/** وضعیت اجازه: granted | denied | default | unsupported */
export const notifyPermission = () => (notifySupported() ? Notification.permission : 'unsupported');

/** درخواست اجازه از کاربر (باید در پاسخ به کلیک صدا زده شود). */
export async function requestNotifyPermission() {
  if (!notifySupported()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

/** تعداد روز پنجره یادآوری از تنظیمات. */
export const notifyDays = (state) => Math.max(1, num(state?.settings?.chequeNotifyDays) || 7);

/**
 * چک‌های سررسیدگذشته و نزدیک را جدا برمی‌گرداند.
 */
export function chequeAlerts(state, days) {
  const span = days || notifyDays(state);
  const today = todayIso();
  const list = chequesDueSoon(state, span);
  const overdue = list.filter((c) => c.due && c.due < today);
  const upcoming = list.filter((c) => !c.due || c.due >= today);
  const sum = (arr) => arr.reduce((t, c) => t + num(c.amount), 0);
  return { overdue, upcoming, days: span, overdueSum: sum(overdue), upcomingSum: sum(upcoming) };
}

/** متن کوتاه برای بنر یا نوتیفیکیشن. */
export function chequeAlertText(alerts) {
  const parts = [];
  if (alerts.overdue.length) {
    parts.push(`${faNum(alerts.overdue.length)} چک سررسیدگذشته (${money(alerts.overdueSum)})`);
  }
  if (alerts.upcoming.length) {
    parts.push(`${faNum(alerts.upcoming.length)} چک تا ${faNum(alerts.days)} روز آینده (${money(alerts.upcomingSum)})`);
  }
  return parts.join(' • ');
}

/** نزدیک‌ترین سررسیدها برای متن نوتیفیکیشن. */
const nearestLine = (alerts) => [...alerts.overdue, ...alerts.upcoming]
  .filter((c) => c.due)
  .sort((a, b) => a.due.localeCompare(b.due))
  .slice(0, 3)
  .map((c) => `${isoToJalali(c.due)} — ${money(c.amount)}`)
  .join('\n');

function showNotification(title, body) {
  const note = new Notification(title, {
    body,
    tag: 'hesabyar-cheque',
    lang: 'fa',
    dir: 'rtl',
  });
  note.onclick = () => {
    try {
      window.focus();
      location.hash = '/cheques';
    } catch { /* بی‌اهمیت */ }
    note.close();
  };
  return note;
}

/**
 * اجرای یادآور. با force = true محدودیت «روزی یک‌بار» نادیده گرفته می‌شود.
 */
export function runChequeReminder(state, { force = false } = {}) {
  const alerts = chequeAlerts(state);
  if (!notifySupported()) return { sent: false, reason: 'unsupported', alerts };
  if (!force && state?.settings?.chequeNotify === false) return { sent: false, reason: 'off', alerts };
  if (Notification.permission !== 'granted') return { sent: false, reason: 'permission', alerts };

  const today = todayIso();
  let seen = '';
  try { seen = localStorage.getItem(SEEN_KEY) || ''; } catch { /* حالت خصوصی مرورگر */ }
  if (!force && seen === today) return { sent: false, reason: 'already', alerts };

  if (!alerts.overdue.length && !alerts.upcoming.length) {
    if (force) showNotification('یادآور چک — حساب‌یار', 'چکی در بازه یادآوری ندارید.');
    try { localStorage.setItem(SEEN_KEY, today); } catch { /* بی‌اهمیت */ }
    return { sent: force, reason: 'empty', alerts };
  }

  const body = [chequeAlertText(alerts), nearestLine(alerts)].filter(Boolean).join('\n');
  showNotification('یادآور چک — حساب‌یار', body);
  try { localStorage.setItem(SEEN_KEY, today); } catch { /* بی‌اهمیت */ }
  return { sent: true, alerts };
}
