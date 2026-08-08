/**
 * shop.js — ویترین عمومی فروشگاه (نسخهٔ ۱.۸.۲).
 * فقط دو مسیر عمومی: GET /api/shop/catalog و POST /api/shop/order
 * هیچ رمزی لازم نیست و هیچ دادهٔ مالی به مشتری نشان داده نمی‌شود.
 */

const $ = (sel, root = document) => root.querySelector(sel);
const FA = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
const AR = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
const faNum = (v) => String(v ?? '').replace(/\d/g, (d) => FA[+d]);
// صفحه‌کلید فارسی و عربی هر دو رقم می‌فرستند؛ همه را به لاتین برمی‌گردانیم
const toEn = (v) => String(v ?? '')
  .replace(/[۰-۹]/g, (d) => String(FA.indexOf(d)))
  .replace(/[٠-٩]/g, (d) => String(AR.indexOf(d)));
const num = (v) => {
  const n = Number(toEn(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const money = (v) => faNum(Math.round(num(v)).toLocaleString('en-US'));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const normText = (s) => toEn(s)
  .replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\u200c/g, ' ')
  .trim().toLowerCase();

const CART_KEY = 'hesabyar.shop.cart';
const WHO_KEY = 'hesabyar.shop.buyer';

const state = {
  shop: { name: 'فروشگاه', phone: '', address: '' },
  products: [],
  cart: {},
  query: '',
  onlyStock: false,
  step: 'cart',
  sending: false,
  error: '',
  result: null,
  payMethod: 'هماهنگی تلفنی',
  // مقادیر فرم در حافظه می‌ماند تا هیچ رندر دوباره‌ای نوشته‌های مشتری را پاک نکند
  form: { name: '', phone: '', address: '', note: '' },
};

const readJson = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key) || 'null') || fallback; } catch { return fallback; }
};
const writeJson = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* حافظه پر است */ }
};

const productOf = (id) => state.products.find((p) => p.id === id);
const stockOf = (p) => Math.max(0, Math.floor(num(p && p.stock)));
const maxQty = (p) => (stockOf(p) > 0 ? Math.min(9999, stockOf(p)) : 0);

const cartLines = () => Object.entries(state.cart)
  .map(([id, qty]) => {
    const product = productOf(id);
    return product ? { ...product, qty: num(qty) } : null;
  })
  .filter((line) => line && line.qty > 0);

const cartCount = () => cartLines().reduce((sum, l) => sum + l.qty, 0);
const cartTotal = () => cartLines().reduce((sum, l) => sum + l.qty * l.price, 0);

/* -------------------------------- پیام کوتاه -------------------------------- */

let flashTimer = 0;
function flash(message) {
  let host = $('#shop-toast');
  if (!host) {
    host = document.createElement('div');
    host.id = 'shop-toast';
    host.className = 'shop-toast is-hidden';
    document.body.appendChild(host);
  }
  host.innerHTML = `<span>${esc(message)}</span>`;
  host.classList.remove('is-hidden');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => host.classList.add('is-hidden'), 2800);
}

/* -------------------------------- دریافت -------------------------------- */

// سبد ذخیره‌شده را با موجودی امروز هماهنگ می‌کند (کالای حذف‌شده یا تمام‌شده)
function syncCartWithCatalog() {
  let changed = false;
  Object.keys(state.cart).forEach((id) => {
    const product = productOf(id);
    if (!product) { delete state.cart[id]; changed = true; return; }
    const max = maxQty(product);
    if (max <= 0) { delete state.cart[id]; changed = true; return; }
    if (num(state.cart[id]) > max) { state.cart[id] = max; changed = true; }
  });
  if (changed) {
    writeJson(CART_KEY, state.cart);
    flash('سبد شما با موجودی امروز هماهنگ شد');
  }
}

async function loadCatalog() {
  try {
    const res = await fetch('/api/shop/catalog', { headers: { accept: 'application/json' }, cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || 'خطا در دریافت فهرست');
    state.shop = data.shop || state.shop;
    state.products = Array.isArray(data.products) ? data.products : [];
    document.title = `ثبت سفارش — ${state.shop.name}`;
    $('#shop-name').textContent = state.shop.name;
    $('#shop-sub').textContent = state.shop.phone
      ? `تماس: ${faNum(state.shop.phone)}`
      : 'لیست کالاها و ثبت سفارش';
    syncCartWithCatalog();
    renderCount();
    renderList();
    if (!$('#drawer').classList.contains('is-hidden')) renderDrawer(true);
  } catch (err) {
    $('#list').innerHTML = `<div class="empty">دریافت فهرست کالاها ممکن نشد. اینترنت را بررسی کنید و دوباره تلاش کنید.<br><span class="tiny muted">${esc(err.message || '')}</span><br><button class="btn btn-sm" type="button" data-retry style="margin-top:12px">تلاش دوباره</button></div>`;
  }
}

/* --------------------------------- فهرست --------------------------------- */

const stockBadge = (p) => {
  const s = stockOf(p);
  if (s <= 0) return '<span class="badge out">ناموجود</span>';
  if (s <= 2) return '<span class="badge low">موجودی کم</span>';
  return '<span class="badge ok">موجود</span>';
};

function controlHtml(p) {
  if (maxQty(p) <= 0) return '<button class="btn btn-sm" type="button" disabled>ناموجود</button>';
  const inCart = num(state.cart[p.id]);
  if (!inCart) return `<button class="btn btn-sm btn-primary" type="button" data-add="${esc(p.id)}">افزودن</button>`;
  return `<div class="qty">
      <button type="button" data-minus="${esc(p.id)}" aria-label="کم کردن">−</button>
      <input class="nums" value="${faNum(inCart)}" data-qty="${esc(p.id)}" inputmode="numeric" aria-label="تعداد" />
      <button type="button" data-plus="${esc(p.id)}" aria-label="افزودن">+</button>
    </div>`;
}

function renderList() {
  const q = normText(state.query);
  const list = state.products.filter((p) => {
    if (state.onlyStock && stockOf(p) <= 0) return false;
    if (!q) return true;
    return normText(`${p.name} ${p.sku}`).includes(q);
  });

  $('#foot').textContent = `${faNum(state.products.length)} کالا در فهرست`
    + (state.shop.address ? ` — ${state.shop.address}` : '');

  if (!list.length) {
    $('#list').innerHTML = '<div class="empty">کالایی با این مشخصات پیدا نشد.</div>';
    return;
  }

  $('#list').innerHTML = list.map((p) => {
    const price = p.price > 0
      ? `${money(p.price)} <small>تومان</small>`
      : '<small>تماس بگیرید</small>';
    return `
      <div class="row" data-id="${esc(p.id)}">
        <div class="row-main">
          <div class="row-name">${esc(p.name)} ${stockBadge(p)}</div>
          <div class="row-meta">${p.sku ? `کد ${faNum(esc(p.sku))}` : ''}${p.unit ? ` · واحد: ${esc(p.unit)}` : ''}</div>
        </div>
        <div class="row-price nums">${price}</div>
        <div class="row-ctl">${controlHtml(p)}</div>
      </div>`;
  }).join('');
}

// فقط همان ردیف به‌روز می‌شود؛ با رندر کاملِ فهرست، دکمه زیر انگشت جابه‌جا می‌شد
function updateRow(id) {
  const product = productOf(id);
  const row = Array.from(document.querySelectorAll('.row')).find((r) => r.dataset.id === id);
  const ctl = row ? $('.row-ctl', row) : null;
  if (!product || !ctl) { renderList(); return; }
  ctl.innerHTML = controlHtml(product);
}

const renderCount = () => { $('#cart-count').textContent = faNum(cartCount()); };

/* ---------------------------------- سبد ---------------------------------- */

function cartBodyHtml(lines) {
  return lines.map((l) => `
    <div class="cart-line">
      <div class="nm">
        <div>${esc(l.name)}</div>
        <div class="tiny muted nums">${money(l.price)} تومان${l.unit ? ` · ${esc(l.unit)}` : ''}</div>
      </div>
      <div class="qty">
        <button type="button" data-minus="${esc(l.id)}">−</button>
        <input class="nums" value="${faNum(l.qty)}" data-qty="${esc(l.id)}" inputmode="numeric" aria-label="تعداد" />
        <button type="button" data-plus="${esc(l.id)}">+</button>
      </div>
      <div class="nums" style="min-width:88px;text-align:end">${money(l.qty * l.price)}</div>
    </div>`).join('');
}

function payOption(value, title, hint, disabled) {
  const active = !disabled && state.payMethod === value;
  return `<label class="pay-opt${active ? ' is-active' : ''}${disabled ? ' is-soon' : ''}"${disabled ? ' title="به‌زودی"' : ''}>
      <input type="radio" name="pay" value="${esc(value)}"${active ? ' checked' : ''}${disabled ? ' disabled' : ''} />
      <span><b>${esc(title)}</b><span class="tiny muted">${esc(hint)}</span></span>
    </label>`;
}

function formHtml() {
  const f = state.form;
  return `
    <div class="note">شمارهٔ تماس را درست وارد کنید؛ برای تأیید سفارش و هزینهٔ ارسال با همین شماره تماس می‌گیریم.</div>
    ${state.error ? `<div class="note err">${esc(state.error)}</div>` : ''}
    <form id="checkout" novalidate>
      <div class="field">
        <label for="f-name">نام و نام خانوادگی</label>
        <input id="f-name" name="name" value="${esc(f.name)}" autocomplete="name" enterkeyhint="next" placeholder="مثلاً حسن رضایی" />
      </div>
      <div class="field">
        <label for="f-phone">شمارهٔ تماس</label>
        <input id="f-phone" name="phone" class="nums" value="${esc(f.phone)}" type="tel" inputmode="tel" autocomplete="tel" enterkeyhint="next" placeholder="09xxxxxxxxx" />
      </div>
      <div class="field">
        <label for="f-address">آدرس (اختیاری)</label>
        <textarea id="f-address" name="address" placeholder="اگر ارسال می‌خواهید، آدرس را بنویسید">${esc(f.address)}</textarea>
      </div>
      <div class="field">
        <label for="f-note">توضیح سفارش (اختیاری)</label>
        <textarea id="f-note" name="note" placeholder="مثلاً سایز یا برند خاصی مد نظر دارید">${esc(f.note)}</textarea>
      </div>

      <h4 style="margin:16px 0 8px">روش پرداخت</h4>
      ${payOption('هماهنگی تلفنی', 'هماهنگی تلفنی / پرداخت در محل', 'همکاران ما تماس می‌گیرند و مبلغ نهایی را اعلام می‌کنند.', false)}
      ${payOption('پرداخت اینترنتی', 'پرداخت اینترنتی (درگاه بانکی)', 'به‌زودی فعال می‌شود.', true)}
      ${payOption('کارت به کارت', 'کارت به کارت', 'به‌زودی فعال می‌شود.', true)}

      <button class="btn btn-primary btn-block" type="submit" style="margin-top:14px"${state.sending ? ' disabled' : ''}>${state.sending ? 'در حال ارسال…' : 'ثبت نهایی سفارش'}</button>
    </form>`;
}

// همهٔ حالت‌ها یک‌جا ساخته و یک‌بار نوشته می‌شوند تا جای اسکرول و فوکوس نپرد
function renderDrawer(keepScroll = false) {
  const body = $('#drawer-body');
  const foot = $('#drawer-foot');
  const top = keepScroll ? body.scrollTop : 0;
  const lines = cartLines();
  let title = 'سبد سفارش';
  let bodyHtml = '';
  let footHtml = '';

  if (state.step === 'done') {
    title = 'سفارش ثبت شد';
    bodyHtml = `
      <div class="done">
        <div class="tick">✓</div>
        <h3 style="margin:0 0 6px">سفارش شما ثبت شد</h3>
        <p class="muted small">شمارهٔ پیگیری: <b class="nums">${faNum(esc(state.result?.no || ''))}</b></p>
        <p class="small">برای هماهنگی ارسال و پرداخت با شما تماس می‌گیریم.</p>
        ${state.shop.phone ? `<p class="small">تماس مستقیم: <a class="nums" href="tel:${esc(state.shop.phone)}">${faNum(esc(state.shop.phone))}</a></p>` : ''}
      </div>`;
    footHtml = '<button class="btn btn-block" type="button" data-act="again">ثبت سفارش تازه</button>';
  } else if (!lines.length) {
    bodyHtml = '<div class="empty">سبد خالی است. از فهرست، کالا انتخاب کنید.</div>';
    footHtml = '<button class="btn btn-block" type="button" data-act="close">بازگشت به فهرست</button>';
  } else {
    const total = `<div class="totals"><span>جمع سفارش</span><b class="nums">${money(cartTotal())} تومان</b></div>`;
    if (state.step === 'form') {
      title = 'اطلاعات تماس';
      bodyHtml = formHtml();
      // دکمه به فرم وصل است تا با Enter و لمس، هر دو کار کند
      footHtml = `${total}
        <button class="btn btn-primary btn-block" type="submit" form="checkout" data-act="send"${state.sending ? ' disabled' : ''}>${state.sending ? 'در حال ارسال…' : 'ثبت نهایی سفارش'}</button>
        <button class="btn btn-block" type="button" data-act="back" style="margin-top:8px">بازگشت به سبد</button>`;
    } else {
      bodyHtml = cartBodyHtml(lines);
      footHtml = `${total}
        <button class="btn btn-primary btn-block" type="button" data-act="next">ادامه و ثبت مشخصات</button>
        <button class="btn btn-block" type="button" data-act="close" style="margin-top:8px">افزودن کالای دیگر</button>`;
    }
  }

  $('#drawer-title').textContent = title;
  body.innerHTML = bodyHtml;
  foot.innerHTML = footHtml;
  body.scrollTop = top;
}

const openDrawer = () => {
  $('#overlay').classList.remove('is-hidden');
  $('#drawer').classList.remove('is-hidden');
  document.body.classList.add('no-scroll');
  renderDrawer();
};
const closeDrawer = () => {
  $('#overlay').classList.add('is-hidden');
  $('#drawer').classList.add('is-hidden');
  document.body.classList.remove('no-scroll');
};

/* -------------------------------- عملیات -------------------------------- */

function setQty(id, qty, opts = {}) {
  const product = productOf(id);
  const max = product ? maxQty(product) : 0;
  let n = Math.max(0, Math.round(num(qty)));

  if (product && max <= 0) {
    n = 0;
    flash(`«${product.name}» فعلاً موجود نیست`);
  } else if (product && n > max) {
    n = max;
    flash(`بیشتر از موجودی (${faNum(max)} ${product.unit || 'عدد'}) نمی‌شود سفارش داد`);
  }

  if (n <= 0) delete state.cart[id];
  else state.cart[id] = n;

  writeJson(CART_KEY, state.cart);
  renderCount();
  updateRow(id);
  if (!opts.skipDrawer && !$('#drawer').classList.contains('is-hidden')) renderDrawer(true);
}

function collectForm() {
  const pick = (sel, key) => {
    const el = $(sel);
    return el ? el.value : (state.form[key] || '');
  };
  const form = {
    name: pick('#f-name', 'name').trim(),
    phone: toEn(pick('#f-phone', 'phone')).replace(/[^\d+]/g, ''),
    address: pick('#f-address', 'address').trim(),
    note: pick('#f-note', 'note').trim(),
  };
  state.form = { ...state.form, ...form };
  return form;
}

async function submitOrder() {
  if (state.sending) return; // جلوگیری از ارسال دوباره با دو بار لمس
  const { name, phone, address, note } = collectForm();
  const lines = cartLines();

  if (name.length < 2) { state.error = 'نام خود را کامل وارد کنید.'; renderDrawer(true); $('#f-name')?.focus(); return; }
  if (phone.replace(/\D/g, '').length < 8) { state.error = 'شمارهٔ تماس را درست وارد کنید.'; renderDrawer(true); $('#f-phone')?.focus(); return; }
  if (!lines.length) { state.error = 'سبد خالی است.'; renderDrawer(true); return; }

  state.sending = true;
  state.error = '';
  renderDrawer(true);

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
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || 'ثبت سفارش ممکن نشد.');

    writeJson(WHO_KEY, { name, phone, address });
    state.result = data;
    state.step = 'done';
    state.cart = {};
    state.form = { ...state.form, note: '' };
    writeJson(CART_KEY, state.cart);
    renderCount();
    await loadCatalog();
  } catch (err) {
    state.error = (err instanceof TypeError)
      ? 'اتصال اینترنت برقرار نیست. دوباره تلاش کنید.'
      : (err.message || 'ثبت سفارش ممکن نشد.');
  } finally {
    state.sending = false;
    renderDrawer(true);
  }
}

/* --------------------------------- رویداد --------------------------------- */

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-retry]')) return loadCatalog();

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
  if (what === 'back') { collectForm(); state.step = 'cart'; return renderDrawer(); }
  if (what === 'again') { state.step = 'cart'; state.result = null; return renderDrawer(); }
  return undefined; // ارسال با رویداد submit انجام می‌شود
});

// ارسال فرم؛ هم با دکمهٔ پایین کشو و هم با کلید Enter صفحه‌کلید موبایل
document.addEventListener('submit', (e) => {
  if (e.target && e.target.id === 'checkout') {
    e.preventDefault();
    submitOrder();
  }
});

// هر حرفی که تایپ می‌شود در حافظه می‌ماند تا با رندر دوباره پاک نشود
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el && el.name && Object.prototype.hasOwnProperty.call(state.form, el.name)) {
    state.form[el.name] = el.value;
  }
});

document.addEventListener('change', (e) => {
  const qty = e.target.closest('[data-qty]');
  if (qty) return setQty(qty.dataset.qty, qty.value);

  if (e.target.name === 'pay' && !e.target.disabled) {
    state.payMethod = e.target.value;
    document.querySelectorAll('.pay-opt').forEach((el) => {
      el.classList.toggle('is-active', el.contains(e.target));
    });
  }
  return undefined;
});

$('#q').addEventListener('input', (e) => {
  state.query = e.target.value;
  renderList();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDrawer();
});

// اگر مشتری صفحه را چند ساعت باز گذاشته باشد، با برگشتن قیمت و موجودی تازه می‌شود
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') loadCatalog();
});

/* ---------------------------------- شروع ---------------------------------- */

state.cart = readJson(CART_KEY, {});
state.form = { ...state.form, ...readJson(WHO_KEY, {}) };
renderCount();
loadCatalog();
