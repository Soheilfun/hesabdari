/**
 * views-shop.js — سفارش‌های ویترین سایت.
 * سفارش‌ها از صفحهٔ عمومی /shop.html می‌آیند و اینجا به فاکتور تبدیل می‌شوند.
 */

import {
  esc, faNum, isoToJalali, money, moneyShort, normText, num, todayIso,
} from './core.js';
import {
  card, chip, confirmDialog, empty, icon, openDrawer, rowActions, stat, table, tabs, toast,
} from './ui.js';

export const ORDER_STATUS = ['\u062c\u062f\u06cc\u062f', '\u062a\u0645\u0627\u0633 \u06af\u0631\u0641\u062a\u0647 \u0634\u062f', '\u062a\u0628\u062f\u06cc\u0644 \u0628\u0647 \u0641\u0627\u06a9\u062a\u0648\u0631', '\u0644\u063a\u0648 \u0634\u062f\u0647'];

const STATUS_TONE = {
  '\u062c\u062f\u06cc\u062f': 'blue',
  '\u062a\u0645\u0627\u0633 \u06af\u0631\u0641\u062a\u0647 \u0634\u062f': 'orange',
  '\u062a\u0628\u062f\u06cc\u0644 \u0628\u0647 \u0641\u0627\u06a9\u062a\u0648\u0631': 'green',
  '\u0644\u063a\u0648 \u0634\u062f\u0647': 'red',
};

const orderDate = (o) => {
  if (o.date) return o.date;
  const t = num(o.createdAt);
  return t > 0 ? new Date(t).toISOString().slice(0, 10) : todayIso();
};

const orderTotal = (o) => (o.items || []).reduce((s, it) => s + num(it.qty) * num(it.price), 0);
const itemsLabel = (o) => (o.items || []).map((it) => `${it.desc} \u00d7${faNum(num(it.qty))}`).join('\u060c ');
const nextInvoiceNo = (state) => String(Math.max(1000, ...state.invoices.map((i) => num(i.no) || 0)) + 1);
const samePhone = (a, b) => {
  const clean = (v) => String(v ?? '').replace(/[^\d]/g, '').slice(-10);
  return clean(a).length >= 7 && clean(a) === clean(b);
};

/* ------------------------------ جزئیات ------------------------------ */

function orderView(ctx, order) {
  const lines = (order.items || []).map((it) => `
    <div class="line"><span>${esc(it.desc)} \u00d7 ${faNum(num(it.qty))} ${esc(it.unit || '')}</span>
    <b class="nums">${money(num(it.qty) * num(it.price))}</b></div>`).join('');

  openDrawer({
    title: `\u0633\u0641\u0627\u0631\u0634 ${faNum(order.no || '')}`,
    submitLabel: '\u0628\u0633\u062a\u0646',
    body: `
      <div class="panel">
        <div class="line"><span>\u0646\u0627\u0645 \u0645\u0634\u062a\u0631\u06cc</span><b>${esc(order.name || '')}</b></div>
        <div class="line"><span>\u0634\u0645\u0627\u0631\u0647\u0654 \u062a\u0645\u0627\u0633</span><b class="nums"><a href="tel:${esc(order.phone || '')}">${faNum(esc(order.phone || ''))}</a></b></div>
        <div class="line"><span>\u062a\u0627\u0631\u06cc\u062e</span><b class="nums">${faNum(isoToJalali(orderDate(order)))}</b></div>
        <div class="line"><span>\u0631\u0648\u0634 \u067e\u0631\u062f\u0627\u062e\u062a</span><b>${esc(order.payMethod || '\u0647\u0645\u0627\u0647\u0646\u06af\u06cc \u062a\u0644\u0641\u0646\u06cc')}</b></div>
        ${order.address ? `<div class="line"><span>\u0622\u062f\u0631\u0633</span><b>${esc(order.address)}</b></div>` : ''}
        ${order.note ? `<div class="line"><span>\u062a\u0648\u0636\u06cc\u062d \u0645\u0634\u062a\u0631\u06cc</span><b>${esc(order.note)}</b></div>` : ''}
      </div>
      <h4 style="margin:16px 0 8px">\u0627\u0642\u0644\u0627\u0645</h4>
      <div class="panel">${lines || '<div class="line"><span>\u0628\u062f\u0648\u0646 \u0627\u0642\u0644\u0627\u0645</span></div>'}
        <div class="line"><span>\u062c\u0645\u0639 \u06a9\u0644</span><b class="nums">${money(orderTotal(order))} \u062a\u0648\u0645\u0627\u0646</b></div>
      </div>`,
    onSubmit() { return true; },
  });
}

/* --------------------------- تبدیل به فاکتور --------------------------- */

async function convertToInvoice(ctx, order) {
  const { state, store } = ctx;
  const ok = await confirmDialog({
    title: '\u062a\u0628\u062f\u06cc\u0644 \u0628\u0647 \u0641\u0627\u06a9\u062a\u0648\u0631 \u0641\u0631\u0648\u0634\u061f',
    message: '\u0641\u0627\u06a9\u062a\u0648\u0631 \u0641\u0631\u0648\u0634 \u0633\u0627\u062e\u062a\u0647 \u0645\u06cc\u200c\u0634\u0648\u062f\u060c \u0645\u0648\u062c\u0648\u062f\u06cc \u06a9\u0627\u0644\u0627\u0647\u0627 \u06a9\u0645 \u0645\u06cc\u200c\u0634\u0648\u062f \u0648 \u0627\u06af\u0631 \u0645\u0634\u062a\u0631\u06cc \u062b\u0628\u062a \u0646\u0634\u062f\u0647 \u0628\u0627\u0634\u062f\u060c \u062e\u0648\u062f\u06a9\u0627\u0631 \u0627\u0636\u0627\u0641\u0647 \u0645\u06cc\u200c\u0634\u0648\u062f.',
    confirmLabel: '\u0628\u0633\u0627\u0632',
    danger: false,
  });
  if (!ok) return;

  let contact = state.contacts.find((c) => samePhone(c.phone, order.phone))
    || state.contacts.find((c) => normText(c.name) === normText(order.name));
  if (!contact) {
    contact = store.put('contact', {
      name: order.name || '\u0645\u0634\u062a\u0631\u06cc \u0633\u0627\u06cc\u062a',
      role: '\u0645\u0634\u062a\u0631\u06cc',
      phone: order.phone || '',
      nid: '',
      address: order.address || '',
      note: '\u0627\u0632 \u0633\u0641\u0627\u0631\u0634 \u0633\u0627\u06cc\u062a',
    });
  }

  const items = (order.items || []).map((it) => {
    const product = state.products.find((p) => p.id === it.productId)
      || state.products.find((p) => normText(p.name) === normText(it.desc));
    return {
      desc: it.desc,
      productId: product?.id || '',
      qty: num(it.qty),
      price: num(it.price),
      discount: 0,
      cost: product ? num(product.buy) : 0,
    };
  });

  const invoice = store.put('invoice', {
    no: nextInvoiceNo(state),
    kind: '\u0641\u0631\u0648\u0634',
    date: todayIso(),
    due: todayIso(),
    contactId: contact.id,
    discount: 0,
    taxRate: 0,
    openingPaid: 0,
    items,
    note: `\u0633\u0641\u0627\u0631\u0634 \u0633\u0627\u06cc\u062a ${order.no || ''}${order.note ? ` \u2014 ${order.note}` : ''}`,
  });

  // اگر هنگام ثبت سفارش موجودی کم شده، دوباره کم نمی‌شود
  if (!order.stockTaken) {
    items.forEach((it) => {
      if (!it.productId) return;
      const product = state.products.find((p) => p.id === it.productId);
      if (product) store.put('product', { ...product, stock: num(product.stock) - it.qty });
    });
  }

  store.put('order', { ...order, status: '\u062a\u0628\u062f\u06cc\u0644 \u0628\u0647 \u0641\u0627\u06a9\u062a\u0648\u0631', invoiceId: invoice.id });
  toast(`\u0641\u0627\u06a9\u062a\u0648\u0631 #${faNum(invoice.no)} \u0633\u0627\u062e\u062a\u0647 \u0634\u062f`, 'green');
  ctx.go('invoices', { id: invoice.id });
}

/* ------------------------------- نمای اصلی ------------------------------- */

let lastAutoSync = 0;

export const orders = {
  title: '\u0633\u0641\u0627\u0631\u0634\u200c\u0647\u0627\u06cc \u0633\u0627\u06cc\u062a',
  subtitle: () => '\u0633\u0641\u0627\u0631\u0634\u200c\u0647\u0627\u06cc\u06cc \u06a9\u0647 \u0645\u0634\u062a\u0631\u06cc\u200c\u0647\u0627 \u0627\u0632 \u0635\u0641\u062d\u0647\u0654 \u0648\u06cc\u062a\u0631\u06cc\u0646 \u062b\u0628\u062a \u06a9\u0631\u062f\u0647\u200c\u0627\u0646\u062f',
  actions: () => `
    <button class="btn" type="button" data-open-shop>دیدن صفحهٔ فروشگاه</button>
    <button class="btn" data-refresh>به‌روزرسانی</button>
    <button class="btn btn-primary" data-copy-link>\u06a9\u067e\u06cc \u0644\u06cc\u0646\u06a9 \u0633\u0641\u0627\u0631\u0634</button>`,

  render(ctx) {
    const { state, query } = ctx;
    const all = (state.orders || []).slice()
      .sort((a, b) => num(b.createdAt) - num(a.createdAt));

    const active = ctx.params.tab || 'new';
    const byTab = {
      new: all.filter((o) => (o.status || '\u062c\u062f\u06cc\u062f') === '\u062c\u062f\u06cc\u062f'),
      open: all.filter((o) => o.status === '\u062a\u0645\u0627\u0633 \u06af\u0631\u0641\u062a\u0647 \u0634\u062f'),
      done: all.filter((o) => o.status === '\u062a\u0628\u062f\u06cc\u0644 \u0628\u0647 \u0641\u0627\u06a9\u062a\u0648\u0631'),
      all,
    };

    const list = (byTab[active] || all).filter((o) => !query
      || normText(`${o.name || ''} ${o.phone || ''} ${o.no || ''} ${itemsLabel(o)}`).includes(normText(query)));

    const rows = list.map((o) => ({
      _id: o.id,
      no: `<span class="nums">${faNum(esc(o.no || ''))}</span>`,
      date: `<span class="nums">${faNum(isoToJalali(orderDate(o)))}</span>`,
      name: esc(o.name || '\u2014'),
      phone: `<a class="nums" href="tel:${esc(o.phone || '')}">${faNum(esc(o.phone || ''))}</a>`,
      items: `<span class="small">${esc(itemsLabel(o) || '\u2014')}</span>`,
      total: money(orderTotal(o)),
      status: chip(o.status || '\u062c\u062f\u06cc\u062f', STATUS_TONE[o.status || '\u062c\u062f\u06cc\u062f'] || 'blue'),
      actions: rowActions([
        { icon: icon('search'), title: '\u0645\u0634\u0627\u0647\u062f\u0647', attrs: `data-view="${o.id}"` },
        { icon: icon('check'), title: '\u062a\u0645\u0627\u0633 \u06af\u0631\u0641\u062a\u0645', attrs: `data-called="${o.id}"` },
        { icon: icon('invoice'), title: '\u062a\u0628\u062f\u06cc\u0644 \u0628\u0647 \u0641\u0627\u06a9\u062a\u0648\u0631', attrs: `data-conv="${o.id}"` },
        { icon: icon('trash'), title: '\u062d\u0630\u0641', attrs: `data-del="${o.id}"`, danger: true },
      ]),
    }));

    const openSum = byTab.new.concat(byTab.open).reduce((s, o) => s + orderTotal(o), 0);

    return `
      <div class="grid cols-3" style="margin-bottom:var(--sp-4)">
        ${stat({ label: '\u0633\u0641\u0627\u0631\u0634 \u062c\u062f\u06cc\u062f', value: faNum(byTab.new.length), unit: '\u0645\u0648\u0631\u062f', tone: 'blue' })}
        ${stat({ label: '\u062f\u0631 \u067e\u06cc\u06af\u06cc\u0631\u06cc', value: faNum(byTab.open.length), unit: '\u0645\u0648\u0631\u062f', tone: 'orange' })}
        ${stat({ label: '\u0645\u0628\u0644\u063a \u0633\u0641\u0627\u0631\u0634\u200c\u0647\u0627\u06cc \u0628\u0627\u0632', value: moneyShort(openSum), unit: '\u062a\u0648\u0645\u0627\u0646', tone: 'green' })}
      </div>
      ${tabs([
        { key: 'new', label: `\u062c\u062f\u06cc\u062f (${faNum(byTab.new.length)})` },
        { key: 'open', label: '\u062f\u0631 \u067e\u06cc\u06af\u06cc\u0631\u06cc' },
        { key: 'done', label: '\u0641\u0627\u06a9\u062a\u0648\u0631 \u0634\u062f\u0647' },
        { key: 'all', label: '\u0647\u0645\u0647' },
      ], active)}
      ${card({
        body: table([
          { key: 'no', label: '\u0634\u0645\u0627\u0631\u0647' },
          { key: 'date', label: '\u062a\u0627\u0631\u06cc\u062e' },
          { key: 'name', label: '\u0645\u0634\u062a\u0631\u06cc' },
          { key: 'phone', label: '\u062a\u0645\u0627\u0633' },
          { key: 'items', label: '\u0627\u0642\u0644\u0627\u0645' },
          { key: 'total', label: '\u0645\u0628\u0644\u063a', num: true },
          { key: 'status', label: '\u0648\u0636\u0639\u06cc\u062a' },
          { key: 'actions', label: '' },
        ], rows, {
          emptyState: empty(
            '\u0633\u0641\u0627\u0631\u0634\u06cc \u062f\u0631 \u0627\u06cc\u0646 \u062f\u0633\u062a\u0647 \u0646\u06cc\u0633\u062a',
            '\u0644\u06cc\u0646\u06a9 /shop.html \u0631\u0627 \u0628\u0631\u0627\u06cc \u0645\u0634\u062a\u0631\u06cc\u200c\u0647\u0627 \u0628\u0641\u0631\u0633\u062a\u06cc\u062f \u062a\u0627 \u0633\u0641\u0627\u0631\u0634\u200c\u0647\u0627\u06cc\u0634\u0627\u0646 \u0627\u06cc\u0646\u062c\u0627 \u0628\u06cc\u0627\u06cc\u062f.',
            icon('cart', 28),
          ),
        }),
        tight: true,
      })}`;
  },

  mount(root, ctx) {
    // به‌محض باز شدن صفحه، یک همگام‌سازی فوری تا سفارش‌های تازه دیده شوند
    // حداکثر یک بار در هر ۵ ثانیه؛ رندر دوباره نباید سیل درخواست بسازد
    if (Date.now() - lastAutoSync > 5000) {
      lastAutoSync = Date.now();
      ctx.store.sync();
    }

    root.addEventListener('click', async (e) => {
      if (e.target.closest('[data-open-shop]')) {
        // در اپ نصب‌شده، window.open ممکن است پنجره ندهد؛ آن‌وقت همین‌جا باز می‌کنیم
        const link = `${location.origin}/shop.html`;
        let win = null;
        try { win = window.open(link, '_blank', 'noopener'); } catch { win = null; }
        if (!win) location.href = link;
        return undefined;
      }

      if (e.target.closest('[data-refresh]')) {
        await ctx.store.sync();
        toast('فهرست به‌روز شد', 'green');
        return undefined;
      }

      const tab = e.target.closest('[data-tab]');
      if (tab) return ctx.setParams({ tab: tab.dataset.tab });

      const find = (id) => (ctx.state.orders || []).find((o) => o.id === id);

      const view = e.target.closest('[data-view]');
      if (view) return orderView(ctx, find(view.dataset.view));

      const called = e.target.closest('[data-called]');
      if (called) {
        const order = find(called.dataset.called);
        if (order) {
          ctx.store.put('order', { ...order, status: '\u062a\u0645\u0627\u0633 \u06af\u0631\u0641\u062a\u0647 \u0634\u062f' });
          toast('\u0648\u0636\u0639\u06cc\u062a \u0628\u0647 \u00ab\u062a\u0645\u0627\u0633 \u06af\u0631\u0641\u062a\u0647 \u0634\u062f\u00bb \u062a\u063a\u06cc\u06cc\u0631 \u06a9\u0631\u062f', 'green');
          ctx.refresh();
        }
        return undefined;
      }

      const conv = e.target.closest('[data-conv]');
      if (conv) {
        const order = find(conv.dataset.conv);
        if (order) await convertToInvoice(ctx, order);
        return undefined;
      }

      const del = e.target.closest('[data-del]');
      if (del && await confirmDialog({ title: '\u062d\u0630\u0641 \u0633\u0641\u0627\u0631\u0634\u061f', message: '\u0627\u06cc\u0646 \u0633\u0641\u0627\u0631\u0634 \u0627\u0632 \u0647\u0645\u0647\u0654 \u062f\u0633\u062a\u06af\u0627\u0647\u200c\u0647\u0627 \u062d\u0630\u0641 \u0645\u06cc\u200c\u0634\u0648\u062f.' })) {
        ctx.store.remove('order', del.dataset.del);
        toast('\u062d\u0630\u0641 \u0634\u062f');
        return undefined;
      }

      if (e.target.closest('[data-copy-link]')) {
        const link = `${location.origin}/shop.html`;
        try {
          await navigator.clipboard.writeText(link);
          toast('\u0644\u06cc\u0646\u06a9 \u06a9\u067e\u06cc \u0634\u062f', 'green');
        } catch {
          toast(link);
        }
      }
      return undefined;
    });
  },
};
