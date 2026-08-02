/**
 * app.js — پوسته برنامه: ورود، مسیریابی، منو، جستوجو، تم و نشانگر همگام‌سازی.
 */

import { api, auth, store } from './data.js';
import { $, $$, confirmDialog, icon, toast } from './ui.js';
import { debounce, esc, faNum } from './core.js';
import { bulk, dashboard, invoices, products } from './views-sales.js';
import { accounts, budgets, cheques, contacts, docs, money_, reports, settings } from './views-finance.js';
import { chat } from './views-chat.js';

/* ------------------------------- تعریف صفحات ------------------------------- */

const VIEWS = {
  dashboard, chat, invoices, products, bulk,
  money: money_, accounts, contacts, cheques, budgets, docs, reports, settings,
};

const NAV = [
  {
    label: 'مرور',
    items: [
      { key: 'dashboard', label: 'داشبورد', icon: 'dashboard' },
      { key: 'chat', label: 'دستیار هوشمند', icon: 'sparkle' },
      { key: 'reports', label: 'گزارش‌ها', icon: 'report' },
    ],
  },
  {
    label: 'فروش و انبار',
    items: [
      { key: 'invoices', label: 'فاکتورها', icon: 'invoice' },
      { key: 'products', label: 'کالاها', icon: 'box' },
      { key: 'contacts', label: 'طرف حساب‌ها', icon: 'users' },
    ],
  },
  {
    label: 'مالی',
    items: [
      { key: 'money', label: 'درآمد و هزینه', icon: 'swap' },
      { key: 'accounts', label: 'حساب‌ها', icon: 'wallet' },
      { key: 'cheques', label: 'چک‌ها', icon: 'cheque', badge: (state) => state.cheques.filter((c) => c.status === 'در جریان').length },
      { key: 'budgets', label: 'بودجه', icon: 'budget' },
      { key: 'docs', label: 'اسناد و مالیات', icon: 'doc' },
    ],
  },
  {
    label: 'تنظیمات',
    items: [{ key: 'settings', label: 'تنظیمات', icon: 'settings' }],
  },
];

const MOBILE_TABS = ['dashboard', 'invoices', 'chat', 'products', 'settings'];

/* --------------------------------- وضعیت --------------------------------- */

const ui = { route: 'dashboard', params: {}, query: '' };

const readHash = () => {
  const [route, qs] = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('?');
  ui.route = VIEWS[route] ? route : 'dashboard';
  ui.params = Object.fromEntries(new URLSearchParams(qs || ''));
};

const writeHash = (route, params = {}) => {
  const qs = new URLSearchParams(params).toString();
  location.hash = `/${route}${qs ? `?${qs}` : ''}`;
};

const ctx = {
  get state() { return store.state; },
  store,
  get params() { return ui.params; },
  get query() { return ui.query; },
  go: (route, params) => writeHash(route, params),
  setParams: (patch) => writeHash(ui.route, { ...ui.params, ...patch }),
  refresh: () => render(),
};

/* ------------------------------- رندر پوسته ------------------------------- */

function renderNav() {
  const state = store.state;
  $('#nav').innerHTML = NAV.map((group) => `
    <div class="nav-group">
      <div class="label">${esc(group.label)}</div>
      ${group.items.map((item) => {
        const count = item.badge?.(state) || 0;
        return `<button type="button" class="nav-item" data-route="${item.key}"${item.key === ui.route ? ' aria-current="page"' : ''} title="${esc(item.label)}">
          <span class="ico">${icon(item.icon, 19)}</span>
          <span class="txt">${esc(item.label)}</span>
          ${count ? `<span class="badge">${faNum(count)}</span>` : ''}
        </button>`;
      }).join('')}
    </div>`).join('');

  $('#tabbar').innerHTML = MOBILE_TABS.map((key) => {
    const item = NAV.flatMap((g) => g.items).find((i) => i.key === key);
    return `<button type="button" data-route="${key}"${key === ui.route ? ' aria-current="page"' : ''}>
      <span class="ico">${icon(item.icon, 19)}</span><span>${esc(item.label)}</span></button>`;
  }).join('');

  $('#brand-name').textContent = state.settings.shop || 'حساب‌یار';
  $('#brand-sub').textContent = state.settings.owner || 'حسابداری مغازه';
}

function render() {
  const view = VIEWS[ui.route];
  const page = $('#page');
  const subtitle = typeof view.subtitle === 'function' ? view.subtitle(ctx) : '';

  page.innerHTML = `
    <div class="page-inner">
      <div class="page-head">
        <div>
          <h1>${esc(view.title)}</h1>
          ${subtitle ? `<div class="title-sub">${esc(subtitle)}</div>` : ''}
        </div>
        <div class="actions">${view.actions ? view.actions(ctx) : ''}</div>
      </div>
      <div id="view-root">${view.render(ctx)}</div>
    </div>`;

  // دامنه رویدادهای هر صفحه شامل دکمه‌های سرصفحه هم می‌شود؛ این عنصر در هر
  // رندر از نو ساخته می‌شود، پس نه دکمه‌ای بی‌اثر می‌ماند و نه لیسنری انباشته می‌شود.
  view.mount?.($('.page-inner', page), ctx);

  renderNav();
  document.title = `${view.title} — ${store.state.settings.shop || 'حساب‌یار'}`;
}

/* ------------------------------ نشانگر همگام ------------------------------ */

function renderSync(status) {
  const chip = $('#sync-chip');
  const label = $('#sync-text');
  if (!chip) return;
  if (status.syncing) { chip.dataset.state = 'syncing'; label.textContent = 'در حال همگام‌سازی'; return; }
  if (!status.online) { chip.dataset.state = 'offline'; label.textContent = status.pending ? `آفلاین — ${faNum(status.pending)} در صف` : 'آفلاین'; return; }
  if (status.error) { chip.dataset.state = 'error'; label.textContent = 'خطای اتصال'; return; }
  chip.dataset.state = 'ok';
  if (status.pending) { label.textContent = `${faNum(status.pending)} در صف`; return; }
  label.textContent = status.lastSync ? 'همگام' : 'آماده';
}

/* --------------------------------- ورود --------------------------------- */

function showGate(message = '') {
  $('#app').classList.add('is-hidden');
  $('#gate').classList.remove('is-hidden');
  $('#gate-error').textContent = message;
  $('#gate-pass').focus();
}

async function showApp() {
  $('#gate').classList.add('is-hidden');
  $('#app').classList.remove('is-hidden');
  render();
  await store.sync({ full: !store.state.products.length && !store.state.invoices.length });
  render();
}

/* --------------------------------- راه‌اندازی --------------------------------- */

function bindShell() {
  document.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-route]');
    if (nav) writeHash(nav.dataset.route);
  });

  // رفتارهای مشترک صفحه — یک‌بار ثبت می‌شود، نه در هر رندر
  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) writeHash(go.dataset.go);
    const inv = e.target.closest('[data-new-invoice]');
    if (inv) invoices.openForm(ctx, null);
    const qs = e.target.closest('[data-quick-sale]');
    if (qs) products.quickSale(ctx);
  });

  window.addEventListener('hashchange', () => { readHash(); render(); $('#page').focus(); });

  $('#theme-btn').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('hesabyar.theme', next);
  });

  $('#lock-btn').addEventListener('click', async () => {
    // خروج، کش و صف ارسال‌نشده را پاک می‌کند؛ اگر چیزی در صف مانده باشد هشدار می‌دهیم
    if (store.status.pending) {
      const ok = await confirmDialog({
        title: 'تغییرات ارسال‌نشده دارید',
        message: `${faNum(store.status.pending)} تغییر هنوز روی سرور ذخیره نشده است. اگر خارج شوید این تغییرات از بین می‌رود.`,
        confirmLabel: 'خروج و پاک کردن',
      });
      if (!ok) { store.sync(); return; }
    }
    auth.token = '';
    store.clearLocal();
    showGate('از حساب خارج شدید.');
  });

  $('#sync-chip').addEventListener('click', () => store.sync());

  $('#global-search').addEventListener('input', debounce((e) => {
    // کادر جست‌وجو بیرون از ناحیه رندر است؛ دست زدن به مقدار آن نشانگر تایپ را می‌پراند
    ui.query = e.target.value.trim();
    render();
  }, 250));

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      $('#global-search').focus();
    }
  });

  store.addEventListener('status', (e) => renderSync(e.detail));
  // با هر تغییر داده، صفحه فعلی هم تازه می‌شود (دیباونس برای عملیات گروهی)
  store.addEventListener('change', debounce(() => {
    if ($('#app').classList.contains('is-hidden')) return;
    if ($('.scrim') || $('.dialog-scrim')) { renderNav(); return; } // هنگام باز بودن فرم فقط منو به‌روز شود
    render();
  }, 120));
  store.addEventListener('unauthorized', () => { auth.token = ''; showGate('ورود منقضی شده است؛ دوباره وارد شوید.'); });
}

function bindGate() {
  $('#gate-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = $('#gate-submit');
    const password = $('#gate-pass').value;
    if (!password) { $('#gate-error').textContent = 'رمز عبور را وارد کنید.'; return; }
    button.disabled = true;
    button.textContent = 'در حال ورود…';
    try {
      const res = await api.login(password);
      auth.token = res.token;
      $('#gate-pass').value = '';
      $('#gate-error').textContent = '';
      await store.bootstrap();
      await showApp();
      toast('خوش آمدید', 'green');
    } catch (err) {
      $('#gate-error').textContent = err.status === 401 ? 'رمز عبور نادرست است.' : (err.message || 'خطا در اتصال به سرور.');
    } finally {
      button.disabled = false;
      button.textContent = 'ورود';
    }
  });
}

async function boot() {
  readHash();
  bindShell();
  bindGate();
  renderSync(store.status);
  store.startAutoSync();

  if (!auth.token) { showGate(); return; }
  try {
    await api.session();
    await showApp();
  } catch (err) {
    if (err.status === 401) { auth.token = ''; showGate('برای ادامه، دوباره وارد شوید.'); }
    else { await showApp(); } // آفلاین: با کش محلی ادامه می‌دهیم
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

boot();

void $$;
