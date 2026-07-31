/**
 * agent.js — دستیار هوشمند حساب‌یار
 *
 * معماری:
 *   مدل (Gemini) فقط تصمیم می‌گیرد کدام ابزار با چه ورودی اجرا شود؛
 *   اجرای ابزارها کاملاً سمت مرورگر و روی همان store و توابع core.js
 *   انجام می‌شود. محاسبه را به مدل نمی‌سپاریم تا عددِ اشتباه نسازد.
 *
 * قاعده ایمنی:
 *   هر ابزاری که داده را تغییر می‌دهد `write: true` است و فقط پس از
 *   تأیید صریح کاربر اجرا می‌شود (تابع confirm در ChatSession.send).
 */

import { auth, store } from './data.js';
import {
  ACCOUNT_TYPES, CHEQUE_KINDS, CHEQUE_STATUS, CONTACT_ROLES, DOC_TYPES,
  EXPENSE_CATS, INCOME_CATS, INVOICE_KINDS, PAY_METHODS, UNITS,
  accountBalance, cashTotal, chequesDueSoon, currentMonthKey, invoiceBalance,
  invoicePaid, invoiceProfit, invoiceStatus, invoiceSubtotal, invoiceTax,
  invoiceTotal, isoPlusDays, isoToJalali, jalaliToIso, lastMonthKeys, lowStock,
  monthExpense, monthIncome, monthKey, monthKeyLabel, monthSalesProfit, normText,
  num, openCheques, payable, receivable, roundTo, stockValue, todayIso,
} from './core.js';

/* ========================== ابزارهای کمکی ========================== */

const state = () => store.state;

const clean = (obj) => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== '') out[k] = v;
  return out;
};

/** تاریخ ورودی مدل را به ISO تبدیل می‌کند (شمسی، میلادی، یا واژه‌های نسبی) */
function toIso(value, fallback = todayIso()) {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  const t = normText(raw);
  if (t === 'today' || t === 'امروز') return todayIso();
  if (t === 'دیروز') return isoPlusDays(-1);
  if (t === 'فردا') return isoPlusDays(1);
  const digits = t.replace(/[^0-9]/g, '');
  // ISO میلادی: 2026-07-29
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(t) && Number(t.slice(0, 4)) > 1900) return t.slice(0, 10);
  if (digits.length >= 6) {
    const iso = jalaliToIso(t);
    if (iso) return iso;
  }
  return fallback;
}

/** کلید ماه شمسی از ورودی مدل */
function toMonthKey(value) {
  const raw = normText(value);
  if (!raw || raw === 'جاری' || raw === 'این ماه' || raw === 'current') return currentMonthKey();
  if (raw === 'ماه گذشته' || raw === 'قبل' || raw === 'last') return lastMonthKeys(2)[0];
  const m = raw.match(/^(\d{3,4})[^0-9](\d{1,2})$/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}`;
  const iso = toIso(raw, '');
  return iso ? monthKey(iso) : currentMonthKey();
}

const score = (needle, haystack) => {
  const n = normText(needle);
  const h = normText(haystack);
  if (!n || !h) return 0;
  if (h === n) return 100;
  if (h.startsWith(n)) return 80;
  if (h.includes(n)) return 60;
  const words = n.split(' ').filter((w) => w.length > 1);
  const hits = words.filter((w) => h.includes(w)).length;
  return words.length ? Math.round((hits / words.length) * 40) : 0;
};

/** یافتن کالا با نام یا کد (مدل معمولاً نام تقریبی می‌دهد) */
function findProduct(term) {
  const list = state().products;
  if (!term) return null;
  const t = normText(term);
  const exact = list.find((p) => normText(p.sku) && normText(p.sku) === t);
  if (exact) return exact;
  const ranked = list
    .map((p) => ({ p, s: Math.max(score(term, p.name), score(term, p.sku)) }))
    .filter((x) => x.s >= 60)
    .sort((a, b) => b.s - a.s);
  return ranked.length ? ranked[0].p : null;
}

function findContact(term) {
  if (!term) return null;
  const ranked = state().contacts
    .map((c) => ({ c, s: Math.max(score(term, c.name), score(term, c.phone)) }))
    .filter((x) => x.s >= 60)
    .sort((a, b) => b.s - a.s);
  return ranked.length ? ranked[0].c : null;
}

function findAccount(term) {
  const list = state().accounts;
  if (!term) return list[0] || null;
  const ranked = list
    .map((a) => ({ a, s: score(term, a.name) }))
    .filter((x) => x.s >= 60)
    .sort((a, b) => b.s - a.s);
  return ranked.length ? ranked[0].a : (list[0] || null);
}

function findInvoice(term) {
  const list = state().invoices;
  const t = normText(term).replace(/^#/, '');
  if (!t) return null;
  return list.find((i) => normText(i.no) === t)
    || list.find((i) => normText(i.no).includes(t))
    || null;
}

const nextInvoiceNo = () => {
  const nums = state().invoices
    .map((i) => Number(String(i.no).replace(/[^0-9]/g, '')))
    .filter((n) => Number.isFinite(n));
  return String((nums.length ? Math.max(...nums) : 1000) + 1);
};

/** کد کالا خودکار است؛ مدل نباید کد بسازد */
const nextSku = () => {
  const nums = state().products
    .map((p) => Number(String(p.sku || '').replace(/[^0-9]/g, '')))
    .filter((n) => Number.isFinite(n) && n > 0);
  return `K-${(nums.length ? Math.max(...nums) : 1000) + 1}`;
};

/** درصد سود از قیمت فروش کم می‌شود تا قیمت خرید به دست بیاید */
const buyFromSell = (sell, margin) => roundTo(num(sell) * (1 - num(margin) / 100));

/** خروجی خوانا برای مدل: عدد لاتین (تا محاسبات را درست روایت کند) */
const productBrief = (p) => clean({
  name: p.name, sku: p.sku, unit: p.unit,
  buy: num(p.buy), sell: num(p.sell), stock: num(p.stock), min: num(p.min),
  loc: p.loc,
});

const contactName = (id) => state().contacts.find((c) => c.id === id)?.name || '';
const accountName = (id) => state().accounts.find((a) => a.id === id)?.name || '';

const invoiceBrief = (inv) => {
  const s = state();
  return clean({
    no: inv.no, kind: inv.kind, date: isoToJalali(inv.date), due: isoToJalali(inv.due),
    contact: contactName(inv.contactId) || 'متفرقه',
    itemCount: (inv.items || []).length,
    subtotal: invoiceSubtotal(inv), discount: num(inv.discount), tax: invoiceTax(inv),
    total: invoiceTotal(inv), paid: invoicePaid(inv, s.txns), balance: invoiceBalance(inv, s.txns),
    status: invoiceStatus(inv, s.txns), note: inv.note,
  });
};

const txnBrief = (t) => clean({
  date: isoToJalali(t.date), type: t.type, cat: t.cat, amount: num(t.amount),
  account: accountName(t.accountId), toAccount: accountName(t.toAccountId),
  contact: contactName(t.contactId), method: t.method, note: t.note,
});

const chequeBrief = (c) => clean({
  no: c.no, kind: c.kind, bank: c.bank, amount: num(c.amount),
  due: isoToJalali(c.due), status: c.status, contact: contactName(c.contactId), note: c.note,
});

/* ============================== ابزارها ============================== */
/* هر ابزار: { desc, params, write?, danger?, preview?, run } */

const S = {
  str: (description) => ({ type: 'string', description }),
  numb: (description) => ({ type: 'number', description }),
  bool: (description) => ({ type: 'boolean', description }),
  enumr: (values, description) => ({ type: 'string', enum: values, description }),
};

export const TOOLS = {
  /* ------------------------------- خواندن ------------------------------- */

  find_products: {
    desc: 'جست‌وجوی کالاها در انبار. برای دیدن قیمت، موجودی و کد کالا.',
    params: {
      query: S.str('نام یا بخشی از نام کالا یا کد'),
      lowStockOnly: S.bool('فقط کالاهایی که موجودی‌شان به حداقل رسیده'),
      limit: S.numb('حداکثر تعداد نتیجه (پیش‌فرض ۲۵)'),
    },
    run: ({ query, lowStockOnly, limit }) => {
      let list = lowStockOnly ? lowStock(state()) : state().products;
      if (query) {
        list = list
          .map((p) => ({ p, s: Math.max(score(query, p.name), score(query, p.sku)) }))
          .filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.p);
      }
      const total = list.length;
      return { total, products: list.slice(0, Math.min(num(limit) || 25, 60)).map(productBrief) };
    },
  },

  find_contacts: {
    desc: 'جست‌وجوی مشتری‌ها و تأمین‌کنندگان به همراه مانده طلب یا بدهی.',
    params: {
      query: S.str('نام یا شماره تماس'),
      role: S.enumr(CONTACT_ROLES, 'نقش'),
      limit: S.numb('حداکثر تعداد نتیجه'),
    },
    run: ({ query, role, limit }) => {
      const s = state();
      let list = s.contacts;
      if (role) list = list.filter((c) => c.role === role);
      if (query) {
        list = list.map((c) => ({ c, s: Math.max(score(query, c.name), score(query, c.phone)) }))
          .filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.c);
      }
      const balanceOf = (id) => {
        const invs = s.invoices.filter((i) => i.contactId === id);
        let owes = 0;
        for (const inv of invs) {
          const bal = invoiceBalance(inv, s.txns);
          if (inv.kind === 'فروش') owes += bal;
          else if (inv.kind === 'خرید') owes -= bal;
          else if (inv.kind === 'مرجوعی فروش') owes -= bal;
          else owes += bal;
        }
        return owes;
      };
      return {
        total: list.length,
        contacts: list.slice(0, Math.min(num(limit) || 25, 60)).map((c) => clean({
          name: c.name, role: c.role, phone: c.phone, address: c.address,
          netOwesUs: balanceOf(c.id), note: c.note,
        })),
      };
    },
  },

  find_invoices: {
    desc: 'جست‌وجوی فاکتورهای فروش، خرید و مرجوعی با وضعیت پرداخت.',
    params: {
      query: S.str('شماره فاکتور، نام طرف حساب یا نام کالا'),
      kind: S.enumr(INVOICE_KINDS, 'نوع فاکتور'),
      month: S.str('ماه شمسی مانند 1405-05'),
      unpaidOnly: S.bool('فقط فاکتورهایی که مانده دارند'),
      limit: S.numb('حداکثر تعداد نتیجه'),
    },
    run: ({ query, kind, month, unpaidOnly, limit }) => {
      const s = state();
      let list = [...s.invoices];
      if (kind) list = list.filter((i) => i.kind === kind);
      if (month) { const key = toMonthKey(month); list = list.filter((i) => monthKey(i.date) === key); }
      if (unpaidOnly) list = list.filter((i) => invoiceBalance(i, s.txns) > 0);
      if (query) {
        list = list.filter((i) => {
          const items = (i.items || []).map((it) => it.desc).join(' ');
          return score(query, `${i.no} ${contactName(i.contactId)} ${items} ${i.note || ''}`) > 0;
        });
      }
      list.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      return { total: list.length, invoices: list.slice(0, Math.min(num(limit) || 20, 50)).map(invoiceBrief) };
    },
  },

  get_invoice: {
    desc: 'جزئیات کامل یک فاکتور شامل ردیف‌های کالا و پرداخت‌ها.',
    params: { no: S.str('شماره فاکتور') },
    run: ({ no }) => {
      const inv = findInvoice(no);
      if (!inv) return { error: 'فاکتوری با این شماره پیدا نشد.' };
      const s = state();
      return {
        ...invoiceBrief(inv),
        taxRate: num(inv.taxRate),
        profit: inv.kind === 'فروش' ? invoiceProfit(inv, s.products) : undefined,
        items: (inv.items || []).map((it) => clean({
          name: it.desc, qty: num(it.qty), price: num(it.price), discount: num(it.discount),
          lineTotal: Math.max(0, num(it.qty) * num(it.price) - num(it.discount)),
        })),
        payments: s.txns.filter((t) => t.invoiceId === inv.id).map(txnBrief),
      };
    },
  },

  find_transactions: {
    desc: 'فهرست درآمد، هزینه و انتقال‌های بین حساب‌ها.',
    params: {
      month: S.str('ماه شمسی مانند 1405-05 (خالی = همه ماه‌ها)'),
      type: S.enumr(['درآمد', 'هزینه', 'انتقال'], 'نوع تراکنش'),
      cat: S.str('دسته'),
      query: S.str('جست‌وجو در توضیح و طرف حساب'),
      limit: S.numb('حداکثر تعداد نتیجه'),
    },
    run: ({ month, type, cat, query, limit }) => {
      let list = [...state().txns];
      if (month) { const key = toMonthKey(month); list = list.filter((t) => monthKey(t.date) === key); }
      if (type) list = list.filter((t) => t.type === type);
      if (cat) list = list.filter((t) => score(cat, t.cat) >= 60);
      if (query) list = list.filter((t) => score(query, `${t.note || ''} ${t.cat || ''} ${contactName(t.contactId)}`) > 0);
      list.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      const sumBy = (kind) => list.filter((t) => t.type === kind).reduce((a, t) => a + num(t.amount), 0);
      return {
        total: list.length,
        incomeSum: sumBy('درآمد'),
        expenseSum: sumBy('هزینه'),
        transactions: list.slice(0, Math.min(num(limit) || 25, 60)).map(txnBrief),
      };
    },
  },

  find_cheques: {
    desc: 'فهرست چک‌های دریافتی و پرداختی.',
    params: {
      status: S.enumr([...CHEQUE_STATUS, 'همه'], 'وضعیت چک'),
      kind: S.enumr(CHEQUE_KINDS, 'نوع چک'),
      dueWithinDays: S.numb('فقط چک‌هایی که تا این تعداد روز سررسید می‌شوند'),
    },
    run: ({ status, kind, dueWithinDays }) => {
      let list = [...state().cheques];
      if (status && status !== 'همه') list = list.filter((c) => c.status === status);
      if (kind) list = list.filter((c) => c.kind === kind);
      if (num(dueWithinDays)) {
        const soon = new Set(chequesDueSoon(state(), num(dueWithinDays)).map((c) => c.id));
        list = list.filter((c) => soon.has(c.id));
      }
      list.sort((a, b) => String(a.due).localeCompare(String(b.due)));
      return {
        total: list.length,
        incomingOpenSum: openCheques(state(), CHEQUE_KINDS[0]).reduce((a, c) => a + num(c.amount), 0),
        outgoingOpenSum: openCheques(state(), CHEQUE_KINDS[1]).reduce((a, c) => a + num(c.amount), 0),
        cheques: list.slice(0, 60).map(chequeBrief),
      };
    },
  },

  list_accounts: {
    desc: 'موجودی صندوق و حساب‌های بانکی.',
    params: {},
    run: () => ({
      accounts: state().accounts.map((a) => clean({
        name: a.name, type: a.type, opening: num(a.opening), balance: accountBalance(a.id, state()), note: a.note,
      })),
      cashTotal: cashTotal(state()),
    }),
  },

  financial_summary: {
    desc: 'خلاصه مالی یک ماه: درآمد، هزینه، سود فروش، طلب و بدهی، ارزش انبار.',
    params: { month: S.str('ماه شمسی مانند 1405-05؛ خالی = ماه جاری') },
    run: ({ month }) => {
      const key = toMonthKey(month);
      const s = state();
      const income = monthIncome(s, key);
      const expense = monthExpense(s, key);
      return {
        month: key,
        monthLabel: monthKeyLabel(key),
        income,
        expense,
        netCashFlow: income - expense,
        salesProfit: monthSalesProfit(s, key),
        invoiceCount: s.invoices.filter((i) => monthKey(i.date) === key).length,
        cashTotal: cashTotal(s),
        receivable: receivable(s),
        payable: payable(s),
        stockValue: stockValue(s),
        lowStockCount: lowStock(s).length,
        openChequesDueIn7Days: chequesDueSoon(s, 7).length,
        taxRate: num(s.settings.taxRate),
      };
    },
  },

  compare_months: {
    desc: 'مقایسه درآمد، هزینه و سود چند ماه اخیر.',
    params: { count: S.numb('تعداد ماه (پیش‌فرض ۶)') },
    run: ({ count }) => {
      const s = state();
      const keys = lastMonthKeys(Math.min(Math.max(num(count) || 6, 2), 24));
      return {
        months: keys.map((key) => ({
          month: key, label: monthKeyLabel(key),
          income: monthIncome(s, key), expense: monthExpense(s, key), salesProfit: monthSalesProfit(s, key),
        })),
      };
    },
  },

  top_products: {
    desc: 'پرفروش‌ترین یا سوداورترین کالاها بر اساس فاکتورهای فروش.',
    params: {
      month: S.str('ماه شمسی؛ خالی = همه دوره‌ها'),
      by: S.enumr(['مبلغ', 'تعداد', 'سود'], 'معیار مرتب‌سازی'),
      limit: S.numb('تعداد (پیش‌فرض ۱۰)'),
    },
    run: ({ month, by, limit }) => {
      const s = state();
      const key = month ? toMonthKey(month) : '';
      const rows = new Map();
      for (const inv of s.invoices) {
        if (inv.kind !== 'فروش') continue;
        if (key && monthKey(inv.date) !== key) continue;
        for (const it of inv.items || []) {
          const name = it.desc || 'بدون نام';
          const row = rows.get(name) || { name, qty: 0, amount: 0, profit: 0 };
          const line = Math.max(0, num(it.qty) * num(it.price) - num(it.discount));
          const cost = num(it.cost || s.products.find((p) => p.id === it.productId)?.buy) * num(it.qty);
          row.qty += num(it.qty);
          row.amount += line;
          row.profit += line - cost;
          rows.set(name, row);
        }
      }
      const sortKey = by === 'تعداد' ? 'qty' : by === 'سود' ? 'profit' : 'amount';
      return {
        month: key || 'همه دوره‌ها',
        products: [...rows.values()].sort((a, b) => b[sortKey] - a[sortKey]).slice(0, Math.min(num(limit) || 10, 30)),
      };
    },
  },

  list_budgets: {
    desc: 'بودجه ماه و میزان مصرف واقعی هر دسته.',
    params: { month: S.str('ماه شمسی؛ خالی = ماه جاری') },
    run: ({ month }) => {
      const key = toMonthKey(month);
      const s = state();
      const spentOf = (cat) => s.txns
        .filter((t) => t.type === 'هزینه' && t.cat === cat && monthKey(t.date) === key)
        .reduce((a, t) => a + num(t.amount), 0);
      return {
        month: key,
        monthLabel: monthKeyLabel(key),
        budgets: s.budgets.filter((b) => b.month === key).map((b) => ({
          cat: b.cat, amount: num(b.amount), spent: spentOf(b.cat), remaining: num(b.amount) - spentOf(b.cat),
        })),
      };
    },
  },

  find_docs: {
    desc: 'جست‌وجوی اسناد و مدارک مالیاتی.',
    params: { query: S.str('عنوان یا شماره سند'), limit: S.numb('حداکثر تعداد') },
    run: ({ query, limit }) => {
      let list = [...state().docs];
      if (query) list = list.filter((d) => score(query, `${d.title} ${d.no || ''} ${d.type}`) > 0);
      list.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      return {
        total: list.length,
        docs: list.slice(0, Math.min(num(limit) || 20, 50)).map((d) => clean({
          title: d.title, type: d.type, date: isoToJalali(d.date), amount: num(d.amount),
          tax: num(d.tax), no: d.no, note: d.note,
        })),
      };
    },
  },

  get_settings: {
    desc: 'تنظیمات مغازه: نام، نرخ مالیات، درصد سود خرید و فروش.',
    params: {},
    run: () => ({ settings: clean({ ...state().settings, id: undefined }) }),
  },

  /* ------------------------------- نوشتن -------------------------------- */

  save_product: {
    desc: 'افزودن کالای جدید یا ویرایش کالای موجود (تشخیص با نام یا کد).',
    write: true,
    params: {
      name: S.str('نام کالا (الزامی)'),
      unit: S.enumr(UNITS, 'واحد'),
      sell: S.numb('قیمت فروش (تومان)'),
      buy: S.numb('قیمت خرید (تومان)؛ خالی = درصد سود از قیمت فروش کم می‌شود'),
      stock: S.numb('موجودی'),
      min: S.numb('حداقل موجودی برای هشدار'),
      loc: S.str('محل نگهداری'),
    },
    preview: (a) => {
      const existing = findProduct(a.name);
      const margin = num(state().settings.autoMargin || 20);
      const lines = [
        `نام: ${a.name || existing?.name || '—'}`,
        a.sell !== undefined ? `قیمت فروش: ${num(a.sell)}` : '',
        a.buy !== undefined
          ? `قیمت خرید: ${num(a.buy)}`
          : (a.sell !== undefined ? `قیمت خرید (خودکار ${margin}٪ کمتر): ${buyFromSell(a.sell, margin)}` : ''),
        a.stock !== undefined ? `موجودی: ${num(a.stock)}` : '',
        existing ? '' : `کد خودکار: ${nextSku()}`,
      ].filter(Boolean);
      return { title: existing ? `ویرایش کالا: ${existing.name}` : 'افزودن کالای جدید', lines };
    },
    run: (a) => {
      if (!a.name) return { error: 'نام کالا لازم است.' };
      const settings = state().settings;
      const existing = findProduct(a.name);
      const margin = num(settings.autoMargin || 20);
      const sell = a.sell !== undefined ? num(a.sell) : num(existing?.sell);
      const buy = a.buy !== undefined
        ? num(a.buy)
        : (num(existing?.buy) || buyFromSell(sell, margin));
      const record = {
        ...(existing || {}),
        name: a.name || existing?.name,
        sku: existing?.sku || nextSku(),
        unit: a.unit || existing?.unit || UNITS[0],
        loc: a.loc ?? existing?.loc ?? '',
        buy,
        sell,
        stock: a.stock !== undefined ? num(a.stock) : num(existing?.stock),
        min: a.min !== undefined ? num(a.min) : (existing ? num(existing.min) : 1),
      };
      const saved = store.put('product', record);
      return { ok: true, action: existing ? 'updated' : 'created', product: productBrief(saved) };
    },
  },

  bulk_add_products: {
    desc: 'افزودن یا به‌روزرسانی گروهی کالاها در یک مرحله.',
    write: true,
    params: {
      items: {
        type: 'array',
        description: 'فهرست کالاها',
        items: {
          type: 'object',
          properties: {
            name: S.str('نام کالا'),
            unit: S.str('واحد'),
            sell: S.numb('قیمت فروش'),
            buy: S.numb('قیمت خرید؛ خالی = خودکار از قیمت فروش'),
            stock: S.numb('موجودی'),
            min: S.numb('حداقل'),
          },
          required: ['name'],
        },
      },
    },
    preview: (a) => ({
      title: `ثبت گروهی ${(a.items || []).length} کالا`,
      lines: (a.items || []).slice(0, 12).map((it) => `${it.name} — فروش ${num(it.sell)} / خرید ${it.buy !== undefined ? num(it.buy) : 'خودکار'} / موجودی ${num(it.stock)}`)
        .concat((a.items || []).length > 12 ? ['…'] : []),
    }),
    run: (a) => {
      const items = Array.isArray(a.items) ? a.items : [];
      if (!items.length) return { error: 'فهرست کالا خالی است.' };
      if (items.length > 300) return { error: 'حداکثر ۳۰۰ کالا در هر بار.' };
      let created = 0; let updated = 0;
      for (const it of items) {
        if (!it || !it.name) continue;
        const res = TOOLS.save_product.run(it);
        if (res.action === 'created') created += 1;
        else if (res.action === 'updated') updated += 1;
      }
      return { ok: true, created, updated };
    },
  },

  bump_prices: {
    desc: 'افزایش یا کاهش درصدی قیمت کالاها (همه یا چند کالای مشخص).',
    write: true,
    danger: true,
    params: {
      percent: S.numb('درصد تغییر؛ منفی برای کاهش (الزامی)'),
      target: S.enumr(['فروش', 'خرید', 'هر دو'], 'روی کدام قیمت اعمال شود'),
      productNames: { type: 'array', description: 'فقط این کالاهای مشخص', items: { type: 'string' } },
      roundStep: S.numb('گرد کردن به مضرب (پیش‌فرض ۱۰۰۰)'),
    },
    preview: (a) => {
      const targets = pickProductsForBump(a);
      return {
        title: `تغییر ${num(a.percent)} درصدی قیمت ${a.target || 'فروش'} روی ${targets.length} کالا`,
        lines: targets.slice(0, 10).map((p) => {
          const step = num(a.roundStep) || 1000;
          const next = roundTo(num(p.sell) * (1 + num(a.percent) / 100), step);
          return `${p.name}: ${num(p.sell)} → ${next}`;
        }).concat(targets.length > 10 ? [`و ${targets.length - 10} کالای دیگر`] : []),
      };
    },
    run: (a) => {
      const percent = num(a.percent);
      if (!percent) return { error: 'درصد تغییر لازم است.' };
      const step = num(a.roundStep) || 1000;
      const target = a.target || 'فروش';
      const targets = pickProductsForBump(a);
      for (const p of targets) {
        const patch = { ...p };
        if (target === 'فروش' || target === 'هر دو') patch.sell = roundTo(num(p.sell) * (1 + percent / 100), step);
        if (target === 'خرید' || target === 'هر دو') patch.buy = roundTo(num(p.buy) * (1 + percent / 100), step);
        store.put('product', patch);
      }
      return { ok: true, changed: targets.length, percent, target };
    },
  },

  adjust_stock: {
    desc: 'اصلاح موجودی یک کالا (انبارگردانی یا ضایعات).',
    write: true,
    params: {
      product: S.str('نام یا کد کالا'),
      delta: S.numb('مقدار تغییر (منفی برای کاستن)'),
      setTo: S.numb('تعیین موجودی دقیق'),
      note: S.str('دلیل تغییر'),
    },
    preview: (a) => {
      const p = findProduct(a.product);
      const next = a.setTo !== undefined ? num(a.setTo) : num(p?.stock) + num(a.delta);
      return {
        title: `تغییر موجودی: ${p?.name || a.product}`,
        lines: [`موجودی فعلی: ${num(p?.stock)}`, `موجودی جدید: ${next}`, a.note ? `دلیل: ${a.note}` : ''].filter(Boolean),
      };
    },
    run: (a) => {
      const p = findProduct(a.product);
      if (!p) return { error: `کالایی به نام «${a.product}» پیدا نشد.` };
      const next = a.setTo !== undefined ? num(a.setTo) : num(p.stock) + num(a.delta);
      const saved = store.put('product', { ...p, stock: next });
      return { ok: true, product: productBrief(saved) };
    },
  },

  save_contact: {
    desc: 'افزودن یا ویرایش مشتری / تأمین‌کننده.',
    write: true,
    params: {
      name: S.str('نام (الزامی)'),
      role: S.enumr(CONTACT_ROLES, 'نقش'),
      phone: S.str('شماره تماس'),
      nid: S.str('کد ملی / شناسه ملی'),
      address: S.str('نشانی'),
      note: S.str('توضیح'),
    },
    preview: (a) => ({
      title: findContact(a.name) ? `ویرایش طرف حساب: ${a.name}` : `طرف حساب جدید: ${a.name}`,
      lines: [a.role ? `نقش: ${a.role}` : '', a.phone ? `��ماس: ${a.phone}` : '', a.address ? `نشانی: ${a.address}` : ''].filter(Boolean),
    }),
    run: (a) => {
      if (!a.name) return { error: 'نام طرف حساب لازم است.' };
      const existing = findContact(a.name);
      const saved = store.put('contact', {
        ...(existing || {}),
        name: a.name,
        role: a.role || existing?.role || CONTACT_ROLES[0],
        phone: a.phone ?? existing?.phone ?? '',
        nid: a.nid ?? existing?.nid ?? '',
        address: a.address ?? existing?.address ?? '',
        note: a.note ?? existing?.note ?? '',
      });
      return { ok: true, action: existing ? 'updated' : 'created', contact: clean({ name: saved.name, role: saved.role, phone: saved.phone }) };
    },
  },

  save_account: {
    desc: 'افزودن یا ویرایش صندوق یا حساب بانکی.',
    write: true,
    params: {
      name: S.str('نام حساب (الزامی)'),
      type: S.enumr(ACCOUNT_TYPES, 'نوع حساب'),
      opening: S.numb('موجودی اولیه (تومان)'),
      note: S.str('توضیح'),
    },
    preview: (a) => ({ title: `حساب: ${a.name}`, lines: [a.type ? `نوع: ${a.type}` : '', a.opening !== undefined ? `موجودی اولیه: ${num(a.opening)}` : ''].filter(Boolean) }),
    run: (a) => {
      if (!a.name) return { error: 'نام حساب لازم است.' };
      const existing = state().accounts.find((x) => normText(x.name) === normText(a.name));
      const saved = store.put('account', {
        ...(existing || {}),
        name: a.name,
        type: a.type || existing?.type || ACCOUNT_TYPES[0],
        opening: a.opening !== undefined ? num(a.opening) : num(existing?.opening),
        note: a.note ?? existing?.note ?? '',
        active: true,
      });
      return { ok: true, action: existing ? 'updated' : 'created', account: clean({ name: saved.name, type: saved.type }) };
    },
  },

  create_invoice: {
    desc: 'صدور فاکتور فروش، خرید یا مرجوعی. موجودی انبار و تراکنش پرداخت خودکار ثبت می‌شود.',
    write: true,
    params: {
      kind: S.enumr(INVOICE_KINDS, 'نوع فاکتور (پیش‌فرض فروش)'),
      contactName: S.str('نام مشتری یا تأمین‌کننده؛ خالی = متفرقه'),
      date: S.str('تاریخ شمسی مانند 1405/05/07؛ خالی = امروز'),
      due: S.str('مهلت پرداخت'),
      items: {
        type: 'array',
        description: 'ردیف‌های کالا',
        items: {
          type: 'object',
          properties: {
            name: S.str('نام کالا'),
            qty: S.numb('تعداد'),
            price: S.numb('قیمت واحد؛ خالی = قیمت ثبت‌شده کالا'),
            discount: S.numb('تخفیف ردیف'),
          },
          required: ['name', 'qty'],
        },
      },
      discount: S.numb('تخفیف کل (تومان)'),
      taxRate: S.numb('درصد مالیات؛ خالی = نرخ تنظیمات'),
      paidNow: S.numb('مبلغ پرداخت‌شده همین الان (تومان)'),
      payMethod: S.enumr(PAY_METHODS, 'روش پرداخت'),
      accountName: S.str('حساب دریافت/پرداخت وجه'),
      addToProducts: S.bool('در فاکتور خرید، کالاهای جدید به انبار اضافه شوند'),
      note: S.str('توضیح'),
    },
    preview: (a) => {
      const draft = buildInvoiceDraft(a);
      return {
        title: `${draft.kind} به نام ${draft.contactLabel} — شماره ${draft.no}`,
        lines: [
          ...draft.items.map((it) => `${it.desc} × ${it.qty} × ${it.price}${it.discount ? ` منهای ${it.discount}` : ''}`),
          `جمع ردیف‌ها: ${invoiceSubtotal(draft)}`,
          draft.discount ? `تخفیف کل: ${draft.discount}` : '',
          `مالیات (${draft.taxRate}٪): ${invoiceTax(draft)}`,
          `قابل پرداخت: ${invoiceTotal(draft)}`,
          draft.paidNow ? `پرداخت نقدی: ${draft.paidNow} (${draft.accountLabel})` : 'بدون پرداخت نقدی',
          draft.warnings.length ? `⚑ ${draft.warnings.join(' | ')}` : '',
        ].filter(Boolean),
      };
    },
    run: (a) => {
      const draft = buildInvoiceDraft(a);
      if (!draft.items.length) return { error: 'حداقل یک ردیف کالا لازم است.' };
      const s = state();
      const settings = s.settings;
      const isPurchase = draft.kind === 'خرید';
      const addToProducts = a.addToProducts !== undefined ? !!a.addToProducts : !!settings.addNewFromPurchase;

      // فاکتور خرید: افزودن/به‌روزرسانی کالا و افزودن موجودی
      if (isPurchase && addToProducts) {
        const markup = num(settings.buyMarkup) || 25;
        for (const it of draft.items) {
          const existing = findProduct(it.desc);
          if (existing) {
            store.put('product', {
              ...existing,
              buy: it.price || num(existing.buy),
              sell: num(existing.sell) || roundTo(it.price * (1 + markup / 100)),
              stock: num(existing.stock) + num(it.qty),
            });
          } else {
            store.put('product', {
              name: it.desc, sku: nextSku(), unit: UNITS[0], loc: '',
              buy: it.price, sell: roundTo(it.price * (1 + markup / 100)), stock: num(it.qty), min: 1,
            });
          }
        }
      }

      // فروش موجودی را کم می‌کند، مرجوعی فروش برمی‌گرداند
      if (draft.kind === 'فروش' || draft.kind === 'مرجوعی فروش') {
        const sign = draft.kind === 'فروش' ? -1 : 1;
        for (const it of draft.items) {
          const product = it.productId ? s.products.find((p) => p.id === it.productId) : null;
          if (product) store.put('product', { ...product, stock: num(product.stock) + sign * num(it.qty) });
        }
      }

      const saved = store.put('invoice', {
        no: draft.no, kind: draft.kind, date: draft.date, due: draft.due,
        contactId: draft.contactId, discount: draft.discount, taxRate: draft.taxRate,
        openingPaid: 0, items: draft.items, note: draft.note,
      });

      if (draft.paidNow > 0) {
        const isExpense = draft.kind === 'خرید' || draft.kind === 'مرجوعی فروش';
        store.put('txn', {
          date: draft.date,
          type: isExpense ? 'هزینه' : 'درآمد',
          cat: isPurchase ? 'خرید کالا' : 'فروش کالا',
          amount: draft.paidNow,
          accountId: draft.accountId,
          contactId: draft.contactId,
          method: draft.payMethod,
          note: `فاکتور #${saved.no}`,
          invoiceId: saved.id,
        });
      }

      return { ok: true, invoice: invoiceBrief(store.find('invoice', saved.id) || saved), warnings: draft.warnings };
    },
  },

  record_payment: {
    desc: 'ثبت پرداخت یا دریافت وجه برای یک فاکتور موجود.',
    write: true,
    params: {
      invoiceNo: S.str('شماره فاکتور (الزامی)'),
      amount: S.numb('مبلغ (تومان)؛ خالی = کل مانده'),
      accountName: S.str('حساب'),
      method: S.enumr(PAY_METHODS, 'روش پرداخت'),
      date: S.str('تاریخ شمسی'),
    },
    preview: (a) => {
      const inv = findInvoice(a.invoiceNo);
      const bal = inv ? invoiceBalance(inv, state().txns) : 0;
      const amount = a.amount !== undefined ? num(a.amount) : bal;
      return {
        title: `ثبت پرداخت برای فاکتور #${a.invoiceNo}`,
        lines: [
          inv ? `مانده فعلی: ${bal}` : 'فاکتور پیدا نشد',
          `مبلغ پرداخت: ${amount}`,
          `حساب: ${findAccount(a.accountName)?.name || '—'}`,
        ],
      };
    },
    run: (a) => {
      const inv = findInvoice(a.invoiceNo);
      if (!inv) return { error: 'فاکتور پیدا نشد.' };
      const s = state();
      const bal = invoiceBalance(inv, s.txns);
      const amount = a.amount !== undefined ? num(a.amount) : bal;
      if (amount <= 0) return { error: 'مبلغ معتبر نیست یا فاکتور مانده‌ای ندارد.' };
      const isExpense = inv.kind === 'خرید' || inv.kind === 'مرجوعی فروش';
      const acc = findAccount(a.accountName);
      store.put('txn', {
        date: toIso(a.date),
        type: isExpense ? 'هزینه' : 'درآمد',
        cat: inv.kind === 'خرید' ? 'خرید کالا' : 'فروش کالا',
        amount,
        accountId: acc?.id || '',
        contactId: inv.contactId || '',
        method: a.method || PAY_METHODS[0],
        note: `فاکتور #${inv.no}`,
        invoiceId: inv.id,
      });
      const fresh = store.find('invoice', inv.id) || inv;
      return { ok: true, invoice: invoiceBrief(fresh) };
    },
  },

  record_transaction: {
    desc: 'ثبت درآمد، هزینه یا انتقال بین دو حساب.',
    write: true,
    params: {
      type: S.enumr(['درآمد', 'هزینه', 'انتقال'], 'نوع (الزامی)'),
      amount: S.numb('مبلغ به تومان (الزامی)'),
      cat: S.str(`دسته؛ درآمد: ${INCOME_CATS.join(', ')} | هزینه: ${EXPENSE_CATS.join(', ')}`),
      accountName: S.str('حساب مبدأ'),
      toAccountName: S.str('حساب مقصد (فقط برای انتقال)'),
      contactName: S.str('طرف حساب'),
      method: S.enumr(PAY_METHODS, 'روش پرداخت'),
      date: S.str('تاریخ شمسی؛ خالی = امروز'),
      note: S.str('توضیح'),
    },
    preview: (a) => ({
      title: `ثبت ${a.type || 'تراکنش'}: ${num(a.amount)} تومان`,
      lines: [
        a.cat ? `دسته: ${a.cat}` : '',
        `حساب: ${findAccount(a.accountName)?.name || '—'}`,
        a.toAccountName ? `به حساب: ${findAccount(a.toAccountName)?.name || '—'}` : '',
        a.contactName ? `طرف حساب: ${a.contactName}` : '',
        `تاریخ: ${isoToJalali(toIso(a.date))}`,
        a.note ? `توضیح: ${a.note}` : '',
      ].filter(Boolean),
    }),
    run: (a) => {
      const amount = num(a.amount);
      if (!a.type) return { error: 'نوع تراکنش لازم است.' };
      if (amount <= 0) return { error: 'مبلغ باید بزرگ‌تر از صفر باشد.' };
      const acc = findAccount(a.accountName);
      const to = a.toAccountName ? findAccount(a.toAccountName) : null;
      if (a.type === 'انتقال' && (!acc || !to || acc.id === to.id)) {
        return { error: 'برای انتقال، دو حساب متفاوت لازم است.' };
      }
      const contact = a.contactName ? findContact(a.contactName) : null;
      const cats = a.type === 'درآمد' ? INCOME_CATS : EXPENSE_CATS;
      const cat = a.type === 'انتقال'
        ? 'انتقال داخلی'
        : (cats.find((c) => score(a.cat, c) >= 60) || a.cat || cats[cats.length - 1]);
      const saved = store.put('txn', {
        date: toIso(a.date),
        type: a.type,
        cat,
        amount,
        accountId: acc?.id || '',
        toAccountId: to?.id || '',
        contactId: contact?.id || '',
        method: a.method || PAY_METHODS[0],
        note: a.note || '',
      });
      return { ok: true, transaction: txnBrief(saved) };
    },
  },

  save_cheque: {
    desc: 'ثبت یا ویرایش چک دریافتی یا پرداختی.',
    write: true,
    params: {
      kind: S.enumr(CHEQUE_KINDS, 'نوع چک'),
      no: S.str('شماره چک'),
      bank: S.str('بانک'),
      amount: S.numb('مبلغ (تومان)'),
      due: S.str('تاریخ سررسید شمسی'),
      contactName: S.str('طرف حساب'),
      status: S.enumr(CHEQUE_STATUS, 'وضعیت'),
      note: S.str('توضیح'),
    },
    preview: (a) => ({
      title: `چک ${a.no ? `#${a.no}` : ''} — ${num(a.amount)} تومان`,
      lines: [
        `نوع: ${a.kind || CHEQUE_KINDS[0]}`,
        a.bank ? `بانک: ${a.bank}` : '',
        `سررسید: ${isoToJalali(toIso(a.due, isoPlusDays(30)))}`,
        a.contactName ? `طرف حساب: ${a.contactName}` : '',
      ].filter(Boolean),
    }),
    run: (a) => {
      const amount = num(a.amount);
      if (amount <= 0) return { error: 'مبلغ چک لازم است.' };
      const existing = a.no ? state().cheques.find((c) => normText(c.no) === normText(a.no)) : null;
      const contact = a.contactName ? findContact(a.contactName) : null;
      const saved = store.put('cheque', {
        ...(existing || {}),
        kind: a.kind || existing?.kind || CHEQUE_KINDS[0],
        no: a.no || existing?.no || '',
        bank: a.bank || existing?.bank || '',
        amount,
        due: toIso(a.due, existing?.due || isoPlusDays(30)),
        contactId: contact?.id || existing?.contactId || '',
        status: a.status || existing?.status || 'در جریان',
        note: a.note ?? existing?.note ?? '',
      });
      return { ok: true, action: existing ? 'updated' : 'created', cheque: chequeBrief(saved) };
    },
  },

  set_cheque_status: {
    desc: 'تغییر وضعیت یک چک (پاس شده، برگشتی، باطل شده).',
    write: true,
    params: {
      no: S.str('شماره چک (الزامی)'),
      status: S.enumr(CHEQUE_STATUS, 'وضعیت جدید (الزامی)'),
    },
    preview: (a) => ({ title: `چک #${a.no} → ${a.status}`, lines: [] }),
    run: (a) => {
      const cheque = state().cheques.find((c) => normText(c.no) === normText(a.no));
      if (!cheque) return { error: 'چک پیدا نشد.' };
      if (!CHEQUE_STATUS.includes(a.status)) return { error: `وضعیت باید یکی از این‌ها باشد: ${CHEQUE_STATUS.join(', ')}` };
      const saved = store.put('cheque', { ...cheque, status: a.status });
      return { ok: true, cheque: chequeBrief(saved) };
    },
  },

  set_budget: {
    desc: 'تعیین بودجه ماهانه برای یک دسته هزینه.',
    write: true,
    params: {
      month: S.str('ماه شمسی مانند 1405-05؛ خالی = ماه جاری'),
      cat: S.enumr(EXPENSE_CATS, 'دسته هزینه (الزامی)'),
      amount: S.numb('مبلغ بودجه (تومان)'),
    },
    preview: (a) => ({ title: `بودجه ${monthKeyLabel(toMonthKey(a.month))}`, lines: [`${a.cat}: ${num(a.amount)} تومان`] }),
    run: (a) => {
      if (!a.cat) return { error: 'دسته هزینه لازم است.' };
      const month = toMonthKey(a.month);
      const cat = EXPENSE_CATS.find((c) => score(a.cat, c) >= 60) || a.cat;
      const existing = state().budgets.find((b) => b.month === month && b.cat === cat);
      const saved = store.put('budget', { ...(existing || {}), month, cat, amount: num(a.amount) });
      return { ok: true, budget: { month: saved.month, cat: saved.cat, amount: num(saved.amount) } };
    },
  },

  save_doc: {
    desc: 'ثبت سند یا مدرک مالیاتی.',
    write: true,
    params: {
      title: S.str('عنوان (الزامی)'),
      type: S.enumr(DOC_TYPES, 'نوع سند'),
      date: S.str('تاریخ شمسی'),
      amount: S.numb('مبلغ'),
      tax: S.numb('مالیات'),
      no: S.str('شماره سند'),
      note: S.str('توضیح'),
    },
    preview: (a) => ({ title: `سند: ${a.title}`, lines: [a.type || '', a.amount !== undefined ? `مبلغ: ${num(a.amount)}` : ''].filter(Boolean) }),
    run: (a) => {
      if (!a.title) return { error: 'عنوان سند لازم است.' };
      const saved = store.put('doc', {
        title: a.title,
        type: a.type || DOC_TYPES[0],
        date: toIso(a.date),
        amount: num(a.amount),
        tax: num(a.tax),
        no: a.no || '',
        note: a.note || '',
      });
      return { ok: true, doc: clean({ title: saved.title, type: saved.type, date: isoToJalali(saved.date), amount: num(saved.amount) }) };
    },
  },

  update_settings: {
    desc: 'تغییر تنظیمات مغازه (نام، نرخ مالیات، درصد سود، …).',
    write: true,
    params: {
      shop: S.str('نام مغازه'),
      owner: S.str('نام مالک'),
      phone: S.str('تلفن'),
      address: S.str('نشانی'),
      taxRate: S.numb('درصد مالیات بر ارزش افزوده'),
      buyMarkup: S.numb('درصد سود روی فاکتور خرید'),
      autoMargin: S.numb('درصد سود پیش‌فرض کالا (از قیمت فروش کم می‌شود)'),
      lowStockDays: S.numb('بازه هشدار چک و موجودی (روز)'),
      addNewFromPurchase: S.bool('کالای فاکتور خرید به انبار اضافه شود'),
    },
    preview: (a) => ({
      title: 'تغییر تنظیمات',
      lines: Object.entries(clean(a)).map(([k, v]) => `${k}: ${v}`),
    }),
    run: (a) => {
      const patch = clean({
        shop: a.shop, owner: a.owner, phone: a.phone, address: a.address,
        taxRate: a.taxRate !== undefined ? num(a.taxRate) : undefined,
        buyMarkup: a.buyMarkup !== undefined ? num(a.buyMarkup) : undefined,
        autoMargin: a.autoMargin !== undefined ? num(a.autoMargin) : undefined,
        lowStockDays: a.lowStockDays !== undefined ? num(a.lowStockDays) : undefined,
      });
      if (a.addNewFromPurchase !== undefined) patch.addNewFromPurchase = !!a.addNewFromPurchase;
      if (!Object.keys(patch).length) return { error: 'چیزی برای تغییر مشخص نشده است.' };
      store.put('settings', { ...state().settings, ...patch });
      return { ok: true, settings: clean({ ...state().settings, id: undefined }) };
    },
  },

  delete_item: {
    desc: 'حذف یک رکورد. فقط وقتی کاربر صریحاً حذف خواسته باشد.',
    write: true,
    danger: true,
    params: {
      kind: S.enumr(['کالا', 'طرف حساب', 'فاکتور', 'تراکنش', 'چک', 'سند', 'حساب'], 'نوع رکورد (الزامی)'),
      identifier: S.str('نام یا شماره رکورد (الزامی)'),
    },
    preview: (a) => {
      const found = resolveForDelete(a.kind, a.identifier);
      return {
        title: `حذف ${a.kind}: ${found?.label || a.identifier}`,
        lines: found ? ['این حذف در همه دستگاه‌ها اعمال می‌شود و برگشت‌پذیر نیست.'] : ['رکورد پیدا نشد.'],
      };
    },
    run: (a) => {
      const found = resolveForDelete(a.kind, a.identifier);
      if (!found) return { error: 'رکورد پیدا نشد.' };
      store.remove(found.type, found.id);
      return { ok: true, deleted: found.label };
    },
  },

  /* --------------------- گزارش‌ها و یادآورهای تکمیلی --------------------- */

  cheques_due_soon: {
    desc: 'یادآور چک: چک‌های نزدیک سررسید و چک‌های سررسیدگذشته.',
    params: {
      days: S.numb('تا چند روز آینده (پیش‌فرض از تنظیمات)'),
      kind: S.enumr(CHEQUE_KINDS, 'فقط دریافتی یا پرداختی'),
    },
    run: ({ days, kind }) => {
      const s = state();
      const span = num(days) || num(s.settings.lowStockDays) || 7;
      const today = todayIso();
      let list = chequesDueSoon(s, span);
      if (kind) list = list.filter((c) => c.kind === kind);
      const overdue = list.filter((c) => String(c.due) < today);
      const upcoming = list.filter((c) => String(c.due) >= today);
      const totalOf = (arr) => arr.reduce((acc, c) => acc + num(c.amount), 0);
      return {
        days: span,
        today: isoToJalali(today),
        overdueCount: overdue.length,
        overdueAmount: totalOf(overdue),
        upcomingCount: upcoming.length,
        upcomingAmount: totalOf(upcoming),
        overdue: overdue.map(chequeBrief),
        upcoming: upcoming.map(chequeBrief),
      };
    },
  },

  contact_balances: {
    desc: 'فهرست بدهکاران و بستانکاران بر اساس مانده فاکتورها (چه کسی چقدر بدهکار است).',
    params: {
      side: S.enumr(['بدهکار', 'بستانکار', 'هر دو'], 'بدهکار = طلب ما، بستانکار = بدهی ما'),
      limit: S.numb('حداکثر تعداد (پیش‌فرض ۲۰)'),
    },
    run: ({ side, limit }) => {
      const s = state();
      const map = new Map();
      for (const inv of s.invoices) {
        const bal = invoiceBalance(inv, s.txns);
        if (!bal) continue;
        const key = inv.contactId || '_';
        const row = map.get(key) || { contact: contactName(inv.contactId) || 'متفرقه', receivable: 0, payable: 0 };
        if (inv.kind === 'فروش') row.receivable += bal;
        else if (inv.kind === 'مرجوعی فروش') row.receivable -= bal;
        else if (inv.kind === 'خرید') row.payable += bal;
        else if (inv.kind === 'مرجوعی خرید') row.payable -= bal;
        map.set(key, row);
      }
      let rows = [...map.values()].filter((r) => r.receivable || r.payable);
      if (side === 'بدهکار') rows = rows.filter((r) => r.receivable > 0);
      if (side === 'بستانکار') rows = rows.filter((r) => r.payable > 0);
      rows.sort((a, b) => (b.receivable + b.payable) - (a.receivable + a.payable));
      return {
        totalReceivable: receivable(s),
        totalPayable: payable(s),
        contacts: rows.slice(0, Math.min(num(limit) || 20, 60)),
      };
    },
  },

  contact_statement: {
    desc: 'صورت‌حساب یک طرف حساب: فاکتورها، پرداخت‌ها، چک‌ها و مانده نهایی.',
    params: {
      contact: S.str('نام مشتری یا تامین‌کننده (الزامی)'),
      limit: S.numb('حداکثر ردیف هر بخش (پیش‌فرض ۱۵)'),
    },
    run: ({ contact, limit }) => {
      const s = state();
      const c = findContact(contact);
      if (!c) return { error: 'این طرف حساب پیدا نشد.' };
      const cap = Math.min(num(limit) || 15, 60);
      const newest = (a, b) => String(b.date || '').localeCompare(String(a.date || ''));
      const invoices = s.invoices.filter((i) => i.contactId === c.id).sort(newest);
      const payments = s.txns.filter((t) => t.contactId === c.id).sort(newest);
      const cheques = s.cheques.filter((x) => x.contactId === c.id);
      let rec = 0;
      let pay = 0;
      for (const inv of invoices) {
        const bal = invoiceBalance(inv, s.txns);
        if (inv.kind === 'فروش') rec += bal;
        else if (inv.kind === 'مرجوعی فروش') rec -= bal;
        else if (inv.kind === 'خرید') pay += bal;
        else if (inv.kind === 'مرجوعی خرید') pay -= bal;
      }
      return {
        contact: c.name,
        role: c.role,
        phone: c.phone,
        invoiceCount: invoices.length,
        receivable: rec,
        payable: pay,
        netBalance: rec - pay,
        invoices: invoices.slice(0, cap).map(invoiceBrief),
        payments: payments.slice(0, cap).map(txnBrief),
        cheques: cheques.map(chequeBrief),
      };
    },
  },

  profit_report: {
    desc: 'گزارش سود و زیان یک ماه: فروش، سود فروش، درآمد، هزینه و سود خالص.',
    params: { month: S.str('ماه شمسی مثل ۱۴۰۵-۰۵؛ خالی = ماه جاری') },
    run: ({ month }) => {
      const s = state();
      const key = toMonthKey(month);
      const sales = s.invoices.filter((i) => i.kind === 'فروش' && monthKey(i.date) === key);
      const purchases = s.invoices.filter((i) => i.kind === 'خرید' && monthKey(i.date) === key);
      const totalOf = (arr) => arr.reduce((acc, inv) => acc + invoiceTotal(inv), 0);
      const grossProfit = monthSalesProfit(s, key);
      const income = monthIncome(s, key);
      const expense = monthExpense(s, key);
      return {
        month: monthKeyLabel(key),
        invoiceCount: sales.length,
        salesTotal: totalOf(sales),
        purchaseTotal: totalOf(purchases),
        grossProfit,
        income,
        expense,
        netCash: income - expense,
        netProfit: grossProfit - expense,
      };
    },
  },

  inventory_report: {
    desc: 'گزارش انبار: ارزش انبار، کالاهای کم‌موجودی، کالاهای بی‌قیمت و سنگین‌ترین اقلام.',
    params: { limit: S.numb('حداکثر ردیف هر بخش (پیش‌فرض ۱۰)') },
    run: ({ limit }) => {
      const s = state();
      const cap = Math.min(num(limit) || 10, 40);
      const missingPrice = s.products.filter((p) => !num(p.sell) || !num(p.buy));
      const byValue = [...s.products].sort((a, b) => (num(b.stock) * num(b.buy)) - (num(a.stock) * num(a.buy)));
      return {
        productCount: s.products.length,
        stockValue: stockValue(s),
        lowStockCount: lowStock(s).length,
        lowStockItems: lowStock(s).slice(0, cap).map(productBrief),
        missingPriceItems: missingPrice.slice(0, cap).map(productBrief),
        topByValue: byValue.slice(0, cap).map((p) => ({
          name: p.name, stock: num(p.stock), buy: num(p.buy), value: num(p.stock) * num(p.buy),
        })),
      };
    },
  },

  today_summary: {
    desc: 'خلاصه امروز: فروش و خرید امروز، دریافت و پرداخت، موجودی نقدی و یادآورها.',
    params: {},
    run: () => {
      const s = state();
      const today = todayIso();
      const invs = s.invoices.filter((i) => i.date === today);
      const txns = s.txns.filter((t) => t.date === today);
      const totalOf = (arr) => arr.reduce((acc, inv) => acc + invoiceTotal(inv), 0);
      const sumOf = (arr) => arr.reduce((acc, t) => acc + num(t.amount), 0);
      return {
        date: isoToJalali(today),
        salesCount: invs.filter((i) => i.kind === 'فروش').length,
        salesTotal: totalOf(invs.filter((i) => i.kind === 'فروش')),
        purchaseTotal: totalOf(invs.filter((i) => i.kind === 'خرید')),
        incomeToday: sumOf(txns.filter((t) => t.type === 'درآمد')),
        expenseToday: sumOf(txns.filter((t) => t.type === 'هزینه')),
        cash: cashTotal(s),
        receivable: receivable(s),
        payable: payable(s),
        lowStockCount: lowStock(s).length,
        chequesDueSoonCount: chequesDueSoon(s, num(s.settings.lowStockDays) || 7).length,
      };
    },
  },

  bulk_adjust_stock: {
    desc: 'تغییر موجودی چند کالا در یک مرحله (مناسب شمارش انبار).',
    write: true,
    params: {
      items: {
        type: 'array',
        description: 'ردیف‌های شمارش انبار',
        items: {
          type: 'object',
          properties: {
            product: S.str('نام یا کد کالا'),
            stock: S.numb('موجودی نهایی'),
            delta: S.numb('تغییر نسبی؛ مثبت برای افزودن و منفی برای کاستن'),
          },
          required: ['product'],
        },
      },
    },
    preview: (a) => ({
      title: `تغییر موجودی ${(a.items || []).length} کالا`,
      lines: (a.items || []).slice(0, 12).map((it) => {
        const change = it.stock !== undefined ? `موجودی = ${num(it.stock)}` : `تغییر ${num(it.delta)}`;
        return `${it.product}: ${change}`;
      }),
    }),
    run: (a) => {
      const items = Array.isArray(a.items) ? a.items : [];
      if (!items.length) return { error: 'فهرست کالا خالی است.' };
      const updated = [];
      const notFound = [];
      for (const it of items) {
        const p = findProduct(it && it.product);
        if (!p) { notFound.push(it && it.product); continue; }
        const next = it.stock !== undefined ? num(it.stock) : num(p.stock) + num(it.delta);
        store.put('product', { ...p, stock: next });
        updated.push({ name: p.name, stock: next });
      }
      return { ok: true, updatedCount: updated.length, products: updated, notFound };
    },
  },
};

/* --------------------------- توابع کمکی ابزارها --------------------------- */

function pickProductsForBump(a) {
  let list = state().products;
  if (Array.isArray(a.productNames) && a.productNames.length) {
    const ids = new Set(a.productNames.map((n) => findProduct(n)?.id).filter(Boolean));
    return list.filter((p) => ids.has(p.id));
  }
  return list;
}

/** پیش‌نویس فاکتور از ورودی مدل (هم برای پیش‌نمایش و هم برای ثبت) */
function buildInvoiceDraft(a) {
  const s = state();
  const settings = s.settings;
  const kind = INVOICE_KINDS.includes(a.kind) ? a.kind : 'فروش';
  const isPurchase = kind === 'خرید';
  const contact = a.contactName ? findContact(a.contactName) : null;
  const warnings = [];
  if (a.contactName && !contact) warnings.push(`طرف حساب «${a.contactName}» در لیست نیست؛ فاکتور به نام متفرقه ثبت می‌شود`);

  const items = (Array.isArray(a.items) ? a.items : []).map((raw) => {
    const product = findProduct(raw.name);
    const qty = num(raw.qty) || 1;
    const price = raw.price !== undefined && raw.price !== null && raw.price !== ''
      ? num(raw.price)
      : num(isPurchase ? product?.buy : product?.sell);
    if (!product) warnings.push(`کالای «${raw.name}» در انبار نیست`);
    else if (kind === 'فروش' && num(product.stock) < qty) {
      warnings.push(`موجودی ${product.name} فقط ${num(product.stock)} است`);
    }
    return {
      productId: product?.id || '',
      desc: product?.name || raw.name || '',
      qty,
      price,
      discount: num(raw.discount),
      cost: num(product?.buy),
    };
  }).filter((it) => it.desc);

  const acc = findAccount(a.accountName);
  const date = toIso(a.date);
  const draft = {
    no: nextInvoiceNo(),
    kind,
    date,
    due: toIso(a.due, date),
    contactId: contact?.id || '',
    contactLabel: contact?.name || 'متفرقه',
    discount: num(a.discount),
    taxRate: a.taxRate !== undefined ? num(a.taxRate) : num(settings.taxRate),
    items,
    note: a.note || '',
    paidNow: num(a.paidNow),
    payMethod: a.payMethod || PAY_METHODS[0],
    accountId: acc?.id || '',
    accountLabel: acc?.name || 'بدون حساب',
    warnings,
  };
  return draft;
}

function resolveForDelete(kind, identifier) {
  const s = state();
  const t = normText(identifier);
  switch (kind) {
    case 'کالا': {
      const p = findProduct(identifier);
      return p ? { type: 'product', id: p.id, label: p.name } : null;
    }
    case 'طرف حساب': {
      const c = findContact(identifier);
      return c ? { type: 'contact', id: c.id, label: c.name } : null;
    }
    case 'فاکتور': {
      const i = findInvoice(identifier);
      return i ? { type: 'invoice', id: i.id, label: `فاکتور #${i.no}` } : null;
    }
    case 'چک': {
      const c = s.cheques.find((x) => normText(x.no) === t);
      return c ? { type: 'cheque', id: c.id, label: `چک #${c.no}` } : null;
    }
    case 'سند': {
      const d = s.docs.find((x) => score(identifier, x.title) >= 60);
      return d ? { type: 'doc', id: d.id, label: d.title } : null;
    }
    case 'حساب': {
      const acc = s.accounts.find((x) => normText(x.name) === t);
      return acc ? { type: 'account', id: acc.id, label: acc.name } : null;
    }
    case 'تراکنش': {
      const tx = s.txns.find((x) => score(identifier, `${x.note || ''} ${x.cat || ''}`) >= 80);
      return tx ? { type: 'txn', id: tx.id, label: `${tx.type} ${num(tx.amount)}` } : null;
    }
    default:
      return null;
  }
}

/* ======================== اعلام ابزارها به مدل ======================== */

export const toolDeclarations = () => [{
  functionDeclarations: Object.entries(TOOLS).map(([name, tool]) => {
    const properties = tool.params || {};
    return {
      name,
      description: tool.write ? `[تغییر داده] ${tool.desc}` : tool.desc,
      ...(Object.keys(properties).length
        ? { parameters: { type: 'object', properties } }
        : {}),
    };
  }),
}];

export function systemInstruction() {
  const s = state();
  const shop = s.settings.shop || 'مغازه';
  return {
    parts: [{
      text: [
        `تو دستیار حسابداری برنامه «حساب‌یار» برای ${shop} (یک مغازه ابزارفروشی در ایران) هستی.`,
        '',
        'قواعد پاسخ:',
        '- فارسی، ساده و کوتاه جواب بده؛ لحن محاوره‌ای مغازه‌دار را بفهم (مثلاً «ده تا پیچ ۴۰ بزن به نام رضایی»).',
        '- واحد پول تومان است و تاریخ‌ها شمسی. اعداد را خوانا بنویس (مثلاً ۱٬۲۵۰٬۰۰۰ تومان).',
        '- هرگز عدد را حدس نزن و از حافظه نگو. هر رقمی که می‌گویی باید از خروجی ابزارها آمده باشد.',
        '- اگر برای پاسخ دادن به داده نیاز داری، اول ابزارِ خواندن را صدا بزن؛ بعد جواب بده.',
        '- جدول فقط وقتی بساز که چند ردیف داده را مقایسه می‌کنی؛ وگرنه دو–سه خط متن کافی است.',
        '',
        'قواعد ثبت و تغییر:',
        '- ابزارهایی که با [تغییر داده] علامت خورده‌اند، پس از تأیید کاربر اجرا می‌شوند. لازم نیست در متن دوباره اجازه بگیری؛ کارت تأیید خودکار نشان داده می‌شود.',
        '- اگر کاربر تأیید نکرد، اصرار نکن؛ فقط بپرس چه چیزی را باید عوض کنی.',
        '- اگر اطلاعات لازم ناقص است (مبلغ، تعداد، نام کالا)، فقط همان را بپرس؛ سوال‌پیچ نکن.',
        '- قیمت ردیف‌های فاکتور را خالی بگذار تا از قیمت ثبت‌شده کالا برداشته شود، مگر کاربر قیمت دیگری گفته باشد.',
        '- برای حذف یا تغییر گروهی قیمت، حتماً اول دامنه کار را روشن کن (چند کالا و دقیقاً کدام کالاها).',
        '- کد کالا خودکار ساخته می‌شود و دسته‌بندی و برند حذف شده‌اند؛ درباره‌شان سوال نکن.',
        '- برای کالای جدید فقط نام و قیمت فروش را بگیر؛ قیمت خرید اگر گفته نشد، خودکار از قیمت فروش کم می‌شود.',
        '- در پایان کارِ ثبت‌شده را یک‌خطی خلاصه کن (مثلاً «فاکتور #۱۰۰۴ به مبلغ … ثبت شد»).',
        '',
        `امروز: ${isoToJalali(todayIso())} شمسی (${todayIso()} میلادی). ماه جاری: ${currentMonthKey()}.`,
        `حجم داده فعلی: ${s.products.length} کالا، ${s.contacts.length} طرف حساب، ${s.invoices.length} فاکتور، ${s.txns.length} تراکنش، ${s.cheques.length} چک، ${s.accounts.length} حساب.`,
        `نرخ مالیات تنظیمات: ${num(s.settings.taxRate)}٪ — درصد سود خرید: ${num(s.settings.buyMarkup)}٪ — درصد سود پیش‌فرض کالا (کسر از قیمت فروش): ${num(s.settings.autoMargin)}٪.`,
        s.accounts.length ? `حساب‌ها: ${s.accounts.map((a) => a.name).join('، ')}.` : 'هنوز هیچ حسابی ثبت نشده است.',
      ].join('\n'),
    }],
  };
}

/* ============================== گفت‌وگو ============================== */

const MAX_STEPS = 6;
const MAX_HISTORY = 40;

export class ChatError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function askModel(contents) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {}),
      },
      body: JSON.stringify({
        contents,
        tools: toolDeclarations(),
        systemInstruction: systemInstruction(),
      }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = payload.error || {};
      throw new ChatError(err.code || 'chat_error', err.message || `خطای ${res.status}`);
    }
    return payload;
  } catch (err) {
    if (err instanceof ChatError) throw err;
    if (err.name === 'AbortError') throw new ChatError('chat_timeout', 'پاسخ بیش از حد طول کشید. دوباره تلاش کنید.');
    throw new ChatError('offline', 'اتصال برقرار نشد. دستیار برای کار کردن به اینترنت نیاز دارد.');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * یک گفت‌وگوی زنده با دستیار.
 *
 * send(text, { onToolStart, onToolDone, confirm })
 *   - confirm({ name, args, preview, danger }) باید Promise<boolean> بدهد.
 *   - برای ابزارهای تغییردهنده، بدون confirm هیچ چیزی اجرا نمی‌شود.
 */
export class ChatSession {
  constructor() {
    this.contents = [];
    this.usage = { total: 0 };
  }

  reset() {
    this.contents = [];
    this.usage = { total: 0 };
  }

  _trim() {
    if (this.contents.length <= MAX_HISTORY) return;
    // از ابتدا حذف می‌کنیم ولی مراقبیم گفت‌وگو با پاسخ ابزار شروع نشود
    let cut = this.contents.length - MAX_HISTORY;
    while (cut < this.contents.length && this.contents[cut].parts?.some((p) => p.functionResponse)) cut += 1;
    this.contents = this.contents.slice(cut);
  }

  async send(text, { onToolStart, onToolDone, confirm } = {}) {
    const message = String(text || '').trim();
    if (!message) return { text: '' };

    this.contents.push({ role: 'user', parts: [{ text: message }] });
    this._trim();

    const actions = [];

    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await askModel(this.contents);
      this.usage.total += res.usage?.total || 0;

      const calls = res.functionCalls || [];
      if (!calls.length) {
        const answer = res.text || 'پاسخی دریافت نشد.';
        this.contents.push({ role: 'model', parts: [{ text: answer }] });
        return { text: answer, actions };
      }

      this.contents.push({
        role: 'model',
        parts: [
          ...(res.text ? [{ text: res.text }] : []),
          ...calls.map((c) => ({ functionCall: { name: c.name, args: c.args } })),
        ],
      });

      const responses = [];
      for (const call of calls) {
        const tool = TOOLS[call.name];
        if (!tool) {
          responses.push({ name: call.name, response: { error: 'ابزار ناشناخته است.' } });
          continue;
        }

        let result;
        if (tool.write) {
          let preview = { title: tool.desc, lines: [] };
          try {
            if (tool.preview) preview = tool.preview(call.args || {});
          } catch { /* پیش‌نمایش نباید جریان را بشکند */ }
          const approved = confirm
            ? await confirm({ name: call.name, args: call.args || {}, preview, danger: !!tool.danger })
            : false;
          if (!approved) {
            result = { cancelled: true, message: 'کاربر این عملیات را تأیید نکرد.' };
          } else {
            onToolStart?.({ name: call.name, write: true, preview });
            try {
              result = tool.run(call.args || {});
            } catch (err) {
              result = { error: String(err?.message || err) };
            }
            if (result && result.ok) actions.push({ name: call.name, preview, result });
          }
        } else {
          onToolStart?.({ name: call.name, write: false });
          try {
            result = tool.run(call.args || {});
          } catch (err) {
            result = { error: String(err?.message || err) };
          }
        }

        onToolDone?.({ name: call.name, write: !!tool.write, result });
        responses.push({ name: call.name, response: result ?? {} });
      }

      this.contents.push({
        role: 'user',
        parts: responses.map((r) => ({ functionResponse: { name: r.name, response: r.response } })),
      });
      this._trim();
    }

    const giveUp = 'این درخواست خیلی طولانی شد. لطفاً ساده‌تر و کوتاه‌تر بگویید چه کاری لازم است.';
    this.contents.push({ role: 'model', parts: [{ text: giveUp }] });
    return { text: giveUp, actions };
  }
}

/** نمونه پرسش‌ها برای نمایش در اولین ورود */
export const SAMPLE_PROMPTS = [
  'این ماه چقدر سود کردم؟',
  'کدام کالاها دارد تمام می‌شود؟',
  'بیشترین بدهکارهای من کی‌ها هستند؟',
  'چک‌های دو هفته آینده را بگو',
  'خلاصه امروز را بگو',
  'صورت‌حساب حسن رضایی را بده',
  'گزارش انبار را بده',
  '۱۰ عدد پیچ خودکار ۴۰ فروختم، فاکتور بزن',
  '۲۰۰ هزار تومان هزینه حمل و نقل ثبت کن',
  'قیمت فروش همه کالاهای دسته پیچ و مهره را ۱۰ درصد زیاد کن',
  'فروش این ماه را با ماه قبل مقایسه کن',
];
