/**
 * data.js — لایه داده: کلاینت API، مخزن حافظه، صف خروجی آفلاین و موتور همگام‌سازی.
 *
 * مدل ذخیره‌سازی:
 *   منبع حقیقت (source of truth) همیشه سرور است.
 *   مرورگر فقط یک «کش خواندنی» + «صف تغییرات ارسال‌نشده» نگه می‌دارد
 *   تا قطعی اینترنت مغازه کار را متوقف نکند. به محض وصل شدن، صف خالی و
 *   تغییرات سرور دریافت می‌شود (حل تعارض: آخرین نوشته برنده است).
 */

import { uid } from './core.js';

const LS = {
  token: 'hesabyar.token',
  cache: 'hesabyar.cache.v2',
  outbox: 'hesabyar.outbox.v2',
  cursor: 'hesabyar.cursor.v2',
  theme: 'hesabyar.theme',
};

export const COLLECTIONS = {
  account: 'accounts',
  contact: 'contacts',
  product: 'products',
  invoice: 'invoices',
  txn: 'txns',
  cheque: 'cheques',
  budget: 'budgets',
  doc: 'docs',
  order: 'orders',
};

export const DEFAULT_SETTINGS = {
  id: 'settings',
  shop: 'مغازه من',
  owner: '',
  phone: '',
  address: '',
  taxRate: 10,
  buyMarkup: 25,
  autoMargin: 20,
  addNewFromPurchase: true,
  shopReserveStock: true,
  lowStockDays: 7,
};

const emptyState = () => ({
  settings: { ...DEFAULT_SETTINGS },
  accounts: [], contacts: [], products: [], invoices: [],
  txns: [], cheques: [], budgets: [], docs: [], orders: [],
});

const readJson = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
};

const writeJson = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* حافظه پر است */ }
};

/* ================================ API ==================================== */

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const auth = {
  get token() { return localStorage.getItem(LS.token) || ''; },
  set token(value) {
    if (value) localStorage.setItem(LS.token, value);
    else localStorage.removeItem(LS.token);
  },
};

async function request(path, { method = 'GET', body, timeout = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`/api/${path}`, {
      method,
      signal: controller.signal,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = payload.error || {};
      throw new ApiError(res.status, err.code || 'http_error', err.message || `خطای ${res.status}`);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  login: (password) => request('auth/login', { method: 'POST', body: { password } }),
  session: () => request('auth/session'),
  pull: (since) => request(`state?since=${since || 0}`),
  sync: (since, ops) => request('sync', { method: 'POST', body: { since: since || 0, ops } }),
  exportAll: () => request('export'),
  reset: () => request('reset', { method: 'POST', body: { confirm: 'DELETE' } }),
  chat: (payload) => request('chat', { method: 'POST', body: payload, timeout: 60000 }),
};

/* =============================== Store =================================== */

class Store extends EventTarget {
  constructor() {
    super();
    this.state = emptyState();
    this.outbox = readJson(LS.outbox, []);
    this.cursor = Number(localStorage.getItem(LS.cursor) || 0);
    this.status = { online: navigator.onLine, syncing: false, lastSync: 0, error: '', pending: 0 };
    this._syncTimer = null;
    this._hydrateFromCache();
  }

  /* ------------------------------ وضعیت ------------------------------ */

  setStatus(patch) {
    this.status = { ...this.status, ...patch, pending: this.outbox.length };
    this.dispatchEvent(new CustomEvent('status', { detail: this.status }));
  }

  emitChange() {
    this.dispatchEvent(new CustomEvent('change', { detail: this.state }));
  }

  /* ------------------------------- کش -------------------------------- */

  _hydrateFromCache() {
    const cached = readJson(LS.cache, null);
    if (cached && cached.settings) this.state = { ...emptyState(), ...cached };
  }

  _persistCache() {
    writeJson(LS.cache, this.state);
    writeJson(LS.outbox, this.outbox);
    localStorage.setItem(LS.cursor, String(this.cursor));
  }

  clearLocal() {
    [LS.cache, LS.outbox, LS.cursor].forEach((k) => localStorage.removeItem(k));
    this.state = emptyState();
    this.outbox = [];
    this.cursor = 0;
  }

  /* ---------------------------- خواندن داده ---------------------------- */

  list(type) { return this.state[COLLECTIONS[type]] || []; }
  find(type, id) { return this.list(type).find((x) => x.id === id) || null; }
  get settings() { return this.state.settings; }

  /* ---------------------------- نوشتن داده ---------------------------- */

  /** ایجاد یا به‌روزرسانی یک رکورد (خوشبینانه در UI، سپس ارسال به سرور) */
  put(type, record) {
    const collection = COLLECTIONS[type];
    const now = Date.now();
    // updatedAt فراداده است و نباید داخل خود رکورد ذخیره/ارسال شود
    const { updatedAt: _drop, ...clean } = record || {};
    const item = { ...clean, id: clean.id || uid(type), updatedAt: now };

    if (type === 'settings') {
      this.state.settings = { ...this.state.settings, ...clean, id: 'settings' };
    } else {
      const list = this.state[collection];
      const index = list.findIndex((x) => x.id === item.id);
      if (index >= 0) list[index] = { ...list[index], ...clean, id: item.id };
      else list.unshift(item);
    }

    const data = type === 'settings' ? this.state.settings : clean;
    this._queue({ id: item.id, type, data: { ...data, id: item.id }, updatedAt: now });
    this._afterMutation();
    return item;
  }

  /** حذف نرم — حذف هم بین دستگاه‌ها همگام می‌شود */
  remove(type, id) {
    const collection = COLLECTIONS[type];
    this.state[collection] = this.state[collection].filter((x) => x.id !== id);
    this._queue({ id, type, deleted: true, updatedAt: Date.now() });
    this._afterMutation();
  }

  /** چند تغییر در یک تراکنش منطقی (مثلاً ذخیره فاکتور + به‌روزرسانی موجودی) */
  batch(fn) {
    const silent = { put: (t, r) => this.put(t, r), remove: (t, id) => this.remove(t, id) };
    fn(silent);
  }

  _queue(op) {
    // اگر همان رکورد در صف هست، جایگزین می‌شود تا صف رشد بی‌رویه نکند
    this.outbox = this.outbox.filter((o) => o.id !== op.id);
    this.outbox.push(op);
  }

  _afterMutation() {
    this._persistCache();
    this.emitChange();
    this.setStatus({});
    this.scheduleSync(400);
  }

  /* --------------------------- همگام‌سازی --------------------------- */

  _merge(records) {
    if (!records?.length) return false;
    let touched = false;

    for (const rec of records) {
      // تغییر محلی‌ای که هنوز ارسال نشده باشد را بازنویسی نمی‌کنیم
      const pending = this.outbox.some((o) => o.id === rec.id);

      if (rec.type === 'settings') {
        if (!rec.deleted && !pending) {
          this.state.settings = { ...DEFAULT_SETTINGS, ...rec.data, id: 'settings' };
          touched = true;
        }
        continue;
      }
      const collection = COLLECTIONS[rec.type];
      if (!collection) continue;
      const list = this.state[collection];
      const index = list.findIndex((x) => x.id === rec.id);

      if (rec.deleted) {
        if (index >= 0 && !pending) { list.splice(index, 1); touched = true; }
        continue;
      }
      if (pending) continue;
      const incoming = { ...rec.data, id: rec.id, updatedAt: rec.updatedAt };
      if (index >= 0) {
        list[index] = incoming;
        touched = true;
      } else {
        list.push(incoming);
        touched = true;
      }
    }
    return touched;
  }

  scheduleSync(delay = 1500) {
    clearTimeout(this._syncTimer);
    this._syncTimer = setTimeout(() => this.sync(), delay);
  }

  async sync({ full = false } = {}) {
    if (!auth.token) return;
    if (this.status.syncing) return;
    if (!navigator.onLine) {
      this.setStatus({ online: false });
      return;
    }

    this.setStatus({ syncing: true, error: '' });
    const sending = [...this.outbox];
    try {
      let since = full ? 0 : this.cursor;
      let res;
      // سرور در هر درخواست حداکثر ۵۰۰ تغییر میپذیرد؛ صف بزرگ (ورود گروهی)
      // تکهتکه ارسال میشود تا هیچ‌وقت قفل نشود
      if (!sending.length) {
        res = await api.pull(since);
      } else {
        const CHUNK = 200;
        for (let i = 0; i < sending.length; i += CHUNK) {
          const part = sending.slice(i, i + CHUNK);
          res = await api.sync(since, part);
          const partKeys = new Set(part.map((o) => `${o.id}:${o.updatedAt}`));
          this.outbox = this.outbox.filter((o) => !partKeys.has(`${o.id}:${o.updatedAt}`));
          this._persistCache();
          this.setStatus({ syncing: true });
          if (this._merge(res.records || [])) this._chunkChanged = true;
          since = res.serverTime || since;
        }
      }

      // عملیاتی که موفق رفتند از صف حذف می‌شوند (بقیه دفعه بعد می‌روند)
      const changed = (sending.length ? false : this._merge(res.records || [])) || !!this._chunkChanged;
      this._chunkChanged = false;
      // ۳ ثانیه هم‌پوشانی تا تغییری در مرز زمانی جا نماند
      this.cursor = Math.max(0, (res.serverTime || Date.now()) - 3000);
      this._persistCache();
      this.setStatus({ syncing: false, online: true, lastSync: Date.now(), error: '' });
      if (changed || full) this.emitChange();
    } catch (err) {
      const offline = err.name === 'AbortError' || err.message === 'Failed to fetch';
      this.setStatus({
        syncing: false,
        online: !offline,
        error: offline ? '' : err.message || 'خطای همگام‌سازی',
      });
      if (err instanceof ApiError && err.status === 401) {
        this.dispatchEvent(new CustomEvent('unauthorized'));
      }
    }
  }

  /** بارگیری کامل از سرور (پس از ورود یا در دستگاه جدید)
   *  توجه: صف تغییرات ارسال‌نشده (outbox) عمداً دست‌نخورده می‌ماند تا
   *  ثبت‌های آفلاین کاربر با همگام‌سازی کامل از بین نروند. */
  async bootstrap() {
    this.cursor = 0;
    this.state = emptyState();
    await this.sync({ full: true });
    this.emitChange();
  }

  startAutoSync() {
    window.addEventListener('online', () => { this.setStatus({ online: true }); this.sync(); });
    window.addEventListener('offline', () => this.setStatus({ online: false }));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.sync();
      this._scheduleTick(400);
    });
    window.addEventListener('focus', () => this.sync());
    this._scheduleTick(1500);
  }

  /** نظرسنجی زنده: وقتی برنامه باز است هر ۷ ثانیه، در پس‌زمینه هر ۳۰ ثانیه */
  _scheduleTick(delay = 7000) {
    clearTimeout(this._pollTimer);
    this._pollTimer = setTimeout(async () => {
      await this.sync();
      const visible = typeof document === 'undefined' || document.visibilityState === 'visible';
      this._scheduleTick(visible ? 7000 : 30000);
    }, delay);
  }
}

export const store = new Store();
