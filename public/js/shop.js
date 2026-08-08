/**
 * shop.js — ویترین عمومی فروشگاه.
 * فقط دو مسیر عمومی: GET /api/shop/catalog و POST /api/shop/order
 * هیچ رمزی لازم نیست و هیچ دادهٔ مالی به مشتری نشان داده نمی‌شود.
 */

const $ = (sel, root = document) => root.querySelector(sel);
const FA = ['\u06f0', '\u06f1', '\u06f2', '\u06f3', '\u06f4', '\u06f5', '\u06f6', '\u06f7', '\u06f8', '\u06f9'];
const faNum = (v) => String(v ?? '').replace(/\d/g, (d) => FA[+d]);
const num = (v) => {
  const s = String(v ?? '').replace(/[\u06f0-\u06f9]/g, (d) => String(FA.indexOf(d))).replace(/[^\d.-]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};
const money = (v) => faNum(Math.round(num(v)).toLocaleString('en-US'));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const normText = (s) => String(s ?? '')
  .replace(/[\u06f0-\u06f9]/g, (d) => String(FA.indexOf(d)))
  .replace(/\u064a/g, '\u06cc').replace(/\u0643/g, '\u06a9').replace(/\u200c/g, ' ')
  .trim().toLowerCase();

const CART_KEY = 'hesabyar.shop.cart';
const WHO_KEY = 'hesabyar.shop.buyer';

const state = {
  shop: { name: '\u0641\u0631\u0648\u0634\u06af\u0627\u0647', phone: '', address: '' },
  products: [],
  cart: {},
  query: '',
  onlyStock: false,
  step: 'cart',
  sending: false,
  error: '',
  result: null,
  payMethod: '\u0647\u0645\u0627\u0647\u0646\u06af\u06cc \u062a\u0644\u0641\u0646\u06cc',
};

const readJson = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key) || 'null') || fallback; } catch { return fallback; }
};
const writeJson = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* حافظه پر است */ }
};

const cartLines = () => Object.entries(state.cart)
  .map(([id, qty]) => {
    const product = state.products.find((p) => p.id === id);
    return product ? { ...product, qty: num(qty) } : null;
  })
  .filter((line) => line && line.qty > 0);

const cartCount = () => cartLines().reduce((sum, l) => sum + l.qty, 0);
const cartTotal = () => cartLines().reduce((sum, l) => sum + l.qty * l.price, 0);

/* -------------------------------- دریافت -------------------------------- */

async function loadCatalog() {
  try {
    const res = await fetch('/api/shop/catalog', { headers: { accept: 'application/json' } });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || '\u062e\u0637\u0627 \u062f\u0631 \u062f\u0631\u06cc\u0627\u0641\u062a \u0641\u0647\u0631\u0633\u062a');
    state.shop = data.shop || state.shop;
    state.products = Array.isArray(data.products) ? data.products : [];
    document.title = `\u062b\u0628\u062a \u0633\u0641\u0627\u0631\u0634 \u2014 ${state.shop.name}`;
    $('#shop-name').textContent = state.shop.name;
    $('#shop-sub').textContent = state.shop.phone
      ? `\u062a\u0645\u0627\u0633: ${faNum(state.shop.phone)}`
      : '\u0644\u06cc\u0633\u062a \u06a9\u0627\u0644\u0627\u0647\u0627 \u0648 \u062b\u0628\u062a \u0633\u0641\u0627\u0631\u0634';
    renderList();
  } catch (err) {
    $('#list').innerHTML = `<div class="empty">\u062f\u0631\u06cc\u0627\u0641\u062a \u0641\u0647\u0631\u0633\u062a \u06a9\u0627\u0644\u0627\u0647\u0627 \u0645\u0645\u06a9\u0646 \u0646\u0634\u062f. \u0627\u06cc\u0646\u062a\u0631\u0646\u062a \u0631\u0627 \u0628\u0631\u0631\u0633\u06cc \u06a9\u0646\u06cc\u062f \u0648 \u062f\u0648\u0628\u0627\u0631\u0647 \u062a\u0644\u0627\u0634 \u06a9\u0646\u06cc\u062f.<br><span class="tiny muted">${esc(err.message || '')}</span></div>`;
  }
}

/* --------------------------------- فهرست --------------------------------- */

const stockBadge = (p) => {
  if (p.stock <= 0) return '<span class="badge out">\u0646\u0627\u0645\u0648\u062c\u0648\u062f</span>';
  if (p.stock <= 2) return '<span class="badge low">\u0645\u0648\u062c\u0648\u062f\u06cc \u06a9\u0645</span>';
  return '<span class="badge ok">\u0645\u0648\u062c\u0648\u062f</span>';
};

function renderList() {
  const q = normText(state.query);
  const list = state.products.filter((p) => {
    if (state.onlyStock && p.stock <= 0) return false;
    if (!q) return true;
    return normText(`${p.name} ${p.sku}`).includes(q);
  });

  $('#foot').textContent = `${faNum(state.products.length)} \u06a9\u0627\u0644\u0627 \u062f\u0631 \u0641\u0647\u0631\u0633\u062a`
    + (state.shop.address ? ` \u2014 ${state.shop.address}` : '');

  if (!list.length) {
    $('#list').innerHTML = '<div class="empty">\u06a9\u0627\u0644\u0627\u06cc\u06cc \u0628\u0627 \u0627\u06cc\u0646 \u0645\u0634\u062e\u0635\u0627\u062a \u067e\u06cc\u062f\u0627 \u0646\u0634\u062f.</div>';
    return;
  }

  $('#list').innerHTML = list.map((p) => {
    const inCart = num(state.cart[p.id]);
    const price = p.price > 0
      ? `${money(p.price)} <small>\u062a\u0648\u0645\u0627\u0646</small>`
      : '<small>\u062a\u0645\u0627\u0633 \u0628\u06af\u06cc\u0631\u06cc\u062f</small>';
    const control = inCart
      ? `<div class="qty">
           <button type="button" data-minus="${esc(p.id)}" aria-label="\u06a9\u0645 \u06a9\u0631\u062f\u0646">\u2212</button>
           <input class="nums" value="${faNum(inCart)}" data-qty="${esc(p.id)}" inputmode="numeric" aria-label="\u062a\u0639\u062f\u0627\u062f" />
           <button type="button" data-plus="${esc(p.id)}" aria-label="\u0627\u0641\u0632\u0648\u062f\u0646">+</button>
         </div>`
      : `<button class="btn btn-sm btn-primary" type="button" data-add="${esc(p.id)}">\u0627\u0641\u0632\u0648\u062f\u0646</button>`;
    return `
      <div class="row">
        <div class="row-main">
          <div class="row-name">${esc(p.name)} ${stockBadge(p)}</div>
          <div class="row-meta">${p.sku ? `\u06a9\u062f ${faNum(esc(p.sku))}` : ''}${p.unit ? ` \u00b7 \u0648\u0627\u062d\u062f: ${esc(p.unit)}` : ''}</div>
        </div>
        <div class="row-price nums">${price}</div>
        ${control}
      </div>`;
  }).join('');
}

const renderCount = () => { $('#cart-count').textContent = faNum(cartCount()); };

/* ---------------------------------- سبد ---------------------------------- */

function cartBodyHtml(lines) {
  return lines.map((l) => `
    <div class="cart-line">
      <div class="nm">
        <div>${esc(l.name)}</div>
        <div class="tiny muted nums">${money(l.price)} \u062a\u0648\u0645\u0627\u0646${l.unit ? ` \u00b7 ${esc(l.unit)}` : ''}</div>
      </div>
      <div class="qty">
        <button type="button" data-minus="${esc(l.id)}">\u2212</button>
        <input class="nums" value="${faNum(l.qty)}" data-qty="${esc(l.id)}" inputmode="numeric" aria-label="\u062a\u0639\u062f\u0627\u062f" />
        <button type="button" data-plus="${esc(l.id)}">+</button>
      </div>
      <div class="nums" style="min-width:88px;text-align:end">${money(l.qty * l.price)}</div>
    </div>`).join('');
}

function formHtml() {
  const who = readJson(WHO_KEY, { name: '', phone: '', address: '' });
  return `
    <div class="note">\u0634\u0645\u0627\u0631\u0647\u0654 \u062a\u0645\u0627\u0633 \u0631\u0627 \u062f\u0631\u0633\u062a \u0648\u0627\u0631\u062f \u06a9\u0646\u06cc\u062f\u061b \u0628\u0631\u0627\u06cc \u062a\u0623\u06cc\u06cc\u062f \u0633\u0641\u0627\u0631\u0634 \u0648 \u0647\u0632\u06cc\u0646\u0647\u0654 \u0627\u0631\u0633\u0627\u0644 \u0628\u0627 \u0647\u0645\u06cc\u0646 \u0634\u0645\u0627\u0631\u0647 \u062a\u0645\u0627\u0633 \u0645\u06cc\u200c\u06af\u06cc\u0631\u06cc\u0645.</div>
    ${state.error ? `<div class="note err">${esc(state.error)}</div>` : ''}
    <div class="field">
      <label for="f-name">\u0646\u0627\u0645 \u0648 \u0646\u0627\u0645 \u062e\u0627\u0646\u0648\u0627\u062f\u06af\u06cc</label>
      <input id="f-name" name="name" value="${esc(who.name)}" autocomplete="name" placeholder="\u0645\u062b\u0644\u0627\u064b \u062d\u0633\u0646 \u0631\u0636\u0627\u06cc\u06cc" />
    </div>
    <div class="field">
      <label for="f-phone">\u0634\u0645\u0627\u0631\u0647\u0654 \u062a\u0645\u0627\u0633</label>
      <input id="f-phone" name="phone" class="nums" value="${esc(who.phone)}" inputmode="tel" autocomplete="tel" placeholder="09xxxxxxxxx" />
    </div>
    <div class="field">
      <label for="f-address">\u0622\u062f\u0631\u0633 (\u0627\u062e\u062a\u06cc\u0627\u0631\u06cc)</label>
      <textarea id="f-address" name="address" placeholder="\u0627\u06af\u0631 \u0627\u0631\u0633\u0627\u0644 \u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u06cc\u062f\u060c \u0622\u062f\u0631\u0633 \u0631\u0627 \u0628\u0646\u0648\u06cc\u0633\u06cc\u062f">${esc(who.address)}</textarea>
    </div>
    <div class="field">
      <label for="f-note">\u062a\u0648\u0636\u06cc\u062d \u0633\u0641\u0627\u0631\u0634 (\u0627\u062e\u062a\u06cc\u0627\u0631\u06cc)</label>
      <textarea id="f-note" name="note" placeholder="\u0645\u062b\u0644\u0627\u064b \u0633\u0627\u06cc\u0632 \u06cc\u0627 \u0628\u0631\u0646\u062f \u062e\u0627\u0635\u06cc \u0645\u062f \u0646\u0638\u0631 \u062f\u0627\u0631\u06cc\u062f"></textarea>
    </div>

    <h4 style="margin:16px 0 8px">\u0631\u0648\u0634 \u067e\u0631\u062f\u0627\u062e\u062a</h4>
    <label class="pay-opt is-active">
      <input type="radio" name="pay" value="\u0647\u0645\u0627\u0647\u0646\u06af\u06cc \u062a\u0644\u0641\u0646\u06cc" checked />
      <span><b>\u0647\u0645\u0627\u0647\u0646\u06af\u06cc \u062a\u0644\u0641\u0646\u06cc / \u067e\u0631\u062f\u0627\u062e\u062a \u062f\u0631 \u0645\u062d\u0644</b>
      <span class="tiny muted">\u0647\u0645\u06a9\u0627\u0631\u0627\u0646 \u0645\u0627 \u062a\u0645\u0627\u0633 \u0645\u06cc\u200c\u06af\u06cc\u0631\u0646\u062f \u0648 \u0645\u0628\u0644\u063a \u0646\u0647\u0627\u06cc\u06cc \u0631\u0627 \u0627\u0639\u0644\u0627\u0645 \u0645\u06cc\u200c\u06a9\u0646\u0646\u062f.</span></span>
    </label>
    <label class="pay-opt is-soon" title="\u0628\u0647\u200c\u0632\u0648\u062f\u06cc">
      <input type="radio" name="pay" value="\u067e\u0631\u062f\u0627\u062e\u062a \u0627\u06cc\u0646\u062a\u0631\u0646\u062a\u06cc" disabled />
      <span><b>\u067e\u0631\u062f\u0627\u062e\u062a \u0627\u06cc\u0646\u062a\u0631\u0646\u062a\u06cc (\u062f\u0631\u06af\u0627\u0647 \u0628\u0627\u0646\u06a9\u06cc)</b>
      <span class="tiny muted">\u0628\u0647\u200c\u0632\u0648\u062f\u06cc \u0641\u0639\u0627\u0644 \u0645\u06cc\u200c\u0634\u0648\u062f.</span></span>
    </label>
    <label class="pay-opt is-soon" title="\u0628\u0647\u200c\u0632\u0648\u062f\u06cc">
      <input type="radio" name="pay" value="\u06a9\u0627\u0631\u062a \u0628\u0647 \u06a9\u0627\u0631\u062a" disabled />
      <span><b>\u06a9\u0627\u0631\u062a \u0628\u0647 \u06a9\u0627\u0631\u062a</b>
      <span class="tiny muted">\u0628\u0647\u200c\u0632\u0648\u062f\u06cc \u0641\u0639\u0627\u0644 \u0645\u06cc\u200c\u0634\u0648\u062f.</span></span>
    </label>`;
}

function renderDrawer() {
  const body = $('#drawer-body');
  const foot = $('#drawer-foot');
  const lines = cartLines();

  if (state.step === 'done') {
    $('#drawer-title').textContent = '\u0633\u0641\u0627\u0631\u0634 \u062b\u0628\u062a \u0634\u062f';
    body.innerHTML = `
      <div class="done">
        <div class="tick">\u2713</div>
        <h3 style="margin:0 0 6px">\u0633\u0641\u0627\u0631\u0634 \u0634\u0645\u0627 \u062b\u0628\u062a \u0634\u062f</h3>
        <p class="muted small">\u0634\u0645\u0627\u0631\u0647\u0654 \u067e\u06cc\u06af\u06cc\u0631\u06cc: <b class="nums">${faNum(esc(state.result?.no || ''))}</b></p>
        <p class="small">\u0628\u0631\u0627\u06cc \u0647\u0645\u0627\u0647\u0646\u06af\u06cc \u0627\u0631\u0633\u0627\u0644 \u0648 \u067e\u0631\u062f\u0627\u062e\u062a \u0628\u0627 \u0634\u0645\u0627 \u062a\u0645\u0627\u0633 \u0645\u06cc\u200c\u06af\u06cc\u0631\u06cc\u0645.</p>
        ${state.shop.phone ? `<p class="small">\u062a\u0645\u0627\u0633 \u0645\u0633\u062a\u0642\u06cc\u0645: <a class="nums" href="tel:${esc(state.shop.phone)}">${faNum(esc(state.shop.phone))}</a></p>` : ''}
      </div>`;
    foot.innerHTML = '<button class="btn btn-block" type="button" data-act="again">\u062b\u0628\u062a \u0633\u0641\u0627\u0631\u0634 \u062a\u0627\u0632\u0647</button>';
    return;
  }

  if (!lines.length) {
    $('#drawer-title').textContent = '\u0633\u0628\u062f \u0633\u0641\u0627\u0631\u0634';
    body.innerHTML = '<div class="empty">\u0633\u0628\u062f \u062e\u0627\u0644\u06cc \u0627\u0633\u062a. \u0627\u0632 \u0641\u0647\u0631\u0633\u062a\u060c \u06a9\u0627\u0644\u0627 \u0627\u0646\u062a\u062e\u0627\u0628 \u06a9\u0646\u06cc\u062f.</div>';
    foot.innerHTML = '<button class="btn btn-block" type="button" data-act="close">\u0628\u0627\u0632\u06af\u0634\u062a \u0628\u0647 \u0641\u0647\u0631\u0633\u062a</button>';
    return;
  }

  const total = `<div class="totals"><span>\u062c\u0645\u0639 \u0633\u0641\u0627\u0631\u0634</span><b class="nums">${money(cartTotal())} \u062a\u0648\u0645\u0627\u0646</b></div>`;

  if (state.step === 'form') {
    $('#drawer-title').textContent = '\u0627\u0637\u0644\u0627\u0639\u0627\u062a \u062a\u0645\u0627\u0633';
    body.innerHTML = formHtml();
    foot.innerHTML = `${total}
      <button class="btn btn-primary btn-block" type="button" data-act="send"${state.sending ? ' disabled' : ''}>${state.sending ? '\u062f\u0631 \u062d\u0627\u0644 \u0627\u0631\u0633\u0627\u0644\u2026' : '\u062b\u0628\u062a \u0646\u0647\u0627\u06cc\u06cc \u0633\u0641\u0627\u0631\u0634'}</button>
      <button class="btn btn-block" type="button" data-act="back" style="margin-top:8px">\u0628\u0627\u0632\u06af\u0634\u062a \u0628\u0647 \u0633\u0628\u062f</button>`;
    return;
  }

  $('#drawer-title').textContent = '\u0633\u0628\u062f \u0633\u0641\u0627\u0631\u0634';
  body.innerHTML = cartBodyHtml(lines);
  foot.innerHTML = `${total}
    <button class="btn btn-primary btn-block" type="button" data-act="next">\u0627\u062f\u0627\u0645\u0647 \u0648 \u062b\u0628\u062a \u0645\u0634\u062e\u0635\u0627\u062a</button>
    <button class="btn btn-block" type="button" data-act="close" style="margin-top:8px">\u0627\u0641\u0632\u0648\u062f\u0646 \u06a9\u0627\u0644\u0627\u06cc \u062f\u06cc\u06af\u0631</button>`;
}

const openDrawer = () => {
  $('#overlay').classList.remove('is-hidden');
  $('#drawer').classList.remove('is-hidden');
  renderDrawer();
};
const closeDrawer = () => {
  $('#overlay').classList.add('is-hidden');
  $('#drawer').classList.add('is-hidden');
};

/* -------------------------------- عملیات -------------------------------- */

function setQty(id, qty) {
  const n = Math.max(0, Math.min(9999, Math.round(num(qty))));
  if (n <= 0) delete state.cart[id];
  else state.cart[id] = n;
  writeJson(CART_KEY, state.cart);
  renderCount();
  renderList();
  if (!$('#drawer').classList.contains('is-hidden')) renderDrawer();
}

async function submitOrder() {
  const name = $('#f-name')?.value.trim() || '';
  const phone = ($('#f-phone')?.value || '').replace(/[\u06f0-\u06f9]/g, (d) => String(FA.indexOf(d))).replace(/[^\d+]/g, '');
  const address = $('#f-address')?.value.trim() || '';
  const note = $('#f-note')?.value.trim() || '';
  const lines = cartLines();

  if (name.length < 2) { state.error = '\u0646\u0627\u0645 \u062e\u0648\u062f \u0631\u0627 \u06a9\u0627\u0645\u0644 \u0648\u0627\u0631\u062f \u06a9\u0646\u06cc\u062f.'; renderDrawer(); return; }
  if (phone.length < 8) { state.error = '\u0634\u0645\u0627\u0631\u0647\u0654 \u062a\u0645\u0627\u0633 \u0631\u0627 \u062f\u0631\u0633\u062a \u0648\u0627\u0631\u062f \u06a9\u0646\u06cc\u062f.'; renderDrawer(); return; }
  if (!lines.length) { state.error = '\u0633\u0628\u062f \u062e\u0627\u0644\u06cc \u0627\u0633\u062a.'; renderDrawer(); return; }

  state.sending = true;
  state.error = '';
  renderDrawer();

  try {
    const res = await fetch('/api/shop/order', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name, phone, address, note,
        payMethod: state.payMethod,
        items: lines.map((l) => ({ id: l.id, qty: l.qty })),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || '\u062b\u0628\u062a \u0633\u0641\u0627\u0631\u0634 \u0645\u0645\u06a9\u0646 \u0646\u0634\u062f.');

    writeJson(WHO_KEY, { name, phone, address });
    state.result = data;
    state.step = 'done';
    state.cart = {};
    writeJson(CART_KEY, state.cart);
    renderCount();
    renderList();
    loadCatalog(); // موجودی تازه را بگیر
  } catch (err) {
    state.error = err.message || '\u062b\u0628\u062a \u0633\u0641\u0627\u0631\u0634 \u0645\u0645\u06a9\u0646 \u0646\u0634\u062f.';
  } finally {
    state.sending = false;
    renderDrawer();
  }
}

/* --------------------------------- رویداد --------------------------------- */

document.addEventListener('click', (e) => {
  const add = e.target.closest('[data-add]');
  if (add) return setQty(add.dataset.add, num(state.cart[add.dataset.add]) + 1);

  const plus = e.target.closest('[data-plus]');
  if (plus) return setQty(plus.dataset.plus, num(state.cart[plus.dataset.plus]) + 1);

  const minus = e.target.closest('[data-minus]');
  if (minus) return setQty(minus.dataset.minus, num(state.cart[minus.dataset.minus]) - 1);

  if (e.target.closest('#cart-open')) return openDrawer();
  if (e.target.closest('#cart-close') || e.target.closest('#overlay')) return closeDrawer();

  const stock = e.target.closest('#only-stock');
  if (stock) {
    state.onlyStock = !state.onlyStock;
    stock.setAttribute('aria-pressed', String(state.onlyStock));
    return renderList();
  }

  const act = e.target.closest('[data-act]');
  if (!act) return;
  const what = act.dataset.act;
  if (what === 'close') return closeDrawer();
  if (what === 'next') { state.step = 'form'; state.error = ''; return renderDrawer(); }
  if (what === 'back') { state.step = 'cart'; return renderDrawer(); }
  if (what === 'send') return submitOrder();
  if (what === 'again') { state.step = 'cart'; state.result = null; return renderDrawer(); }
});

document.addEventListener('change', (e) => {
  const qty = e.target.closest('[data-qty]');
  if (qty) return setQty(qty.dataset.qty, qty.value);

  if (e.target.name === 'pay') {
    state.payMethod = e.target.value;
    document.querySelectorAll('.pay-opt').forEach((el) => {
      el.classList.toggle('is-active', el.contains(e.target));
    });
  }
});

$('#q').addEventListener('input', (e) => {
  state.query = e.target.value;
  renderList();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDrawer();
});

/* ---------------------------------- شروع ---------------------------------- */

state.cart = readJson(CART_KEY, {});
renderCount();
loadCatalog();
