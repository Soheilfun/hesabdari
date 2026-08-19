/**
 * core.js — تقویم شمسی، قالب‌بندی اعداد، ابزارهای DOM و منطق دامنه حسابداری.
 * این فایل هیچ وابستگی به DOM یا شبکه ندارد تا قابل تست و بازاستفاده باشد.
 */

/* ============================ تقویم شمسی ============================ */

export const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

const div = (a, b) => Math.floor(a / b);
export const pad = (n) => (n < 10 ? '0' : '') + n;

export function gregorianToJalali(gy, gm, gd) {
  const gdm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = 355666 + 365 * gy + div(gy2 + 3, 4) - div(gy2 + 99, 100) + div(gy2 + 399, 400) + gd + gdm[gm - 1];
  let jy = -1595 + 33 * div(days, 12053);
  days %= 12053;
  jy += 4 * div(days, 1461);
  days %= 1461;
  if (days > 365) { jy += div(days - 1, 365); days = (days - 1) % 365; }
  return days < 186
    ? [jy, 1 + div(days, 31), 1 + (days % 31)]
    : [jy, 7 + div(days - 186, 30), 1 + ((days - 186) % 30)];
}

export function jalaliToGregorian(jy, jm, jd) {
  let gy = jy > 979 ? 1600 : 621;
  jy -= jy > 979 ? 979 : 0;
  let days = 365 * jy + div(jy, 33) * 8 + div((jy % 33) + 3, 4) + 78 + jd +
    (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  gy += 400 * div(days, 146097);
  days %= 146097;
  if (days > 36524) {
    gy += 100 * div(--days, 36524);
    days %= 36524;
    if (days >= 365) days++;
  }
  gy += 4 * div(days, 1461);
  days %= 1461;
  if (days > 365) { gy += div(days - 1, 365); days = (days - 1) % 365; }
  let gd = days + 1;
  const leap = (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0;
  const md = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 1;
  for (; gm <= 12 && gd > md[gm]; gm++) gd -= md[gm];
  return [gy, gm, gd];
}

/** تبدیل ارقام فارسی/عربی به لاتین */
export const enDigits = (s) => String(s ?? '')
  .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
  .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));

/**
 * یکسان‌سازی متن برای جست‌وجو و مقایسه نام کالاها:
 * رقم فارسی/عربی ← انگلیسی، کوچک‌سازی لاتین، یکسان‌سازی ی/ک عربی،
 * حذف نیم‌فاصله و فاصله‌های تکراری.
 */
export const normText = (value) => enDigits(value)
  .toLowerCase()
  .replace(/[\u064a\u0649]/g, '\u06cc')
  .replace(/\u0643/g, '\u06a9')
  .replace(/[\u200c\u200e\u200f]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const jParts = (iso) => {
  const parts = String(iso || '').split('-').map(Number);
  const [y, m, d] = parts;
  // ورودی نامعتبر/تهی نباید به NaN تبدیل شود
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n)) || m < 1 || m > 12 || d < 1 || d > 31) {
    return jParts(todayIso());
  }
  return gregorianToJalali(y, m, d);
};

/** ISO → ۱۴۰۵/۰۵/۰۶ */
export const isoToJalali = (iso) => {
  if (!iso) return '';
  const [y, m, d] = jParts(iso);
  return `${y}/${pad(m)}/${pad(d)}`;
};

/** ۱۴۰۵/۰۵/۰۶ (با هر جداکننده‌ای) → ISO */
export const jalaliToIso = (text) => {
  if (!text) return '';
  const parts = enDigits(text).replace(/[^0-9]/g, '/').split('/').filter(Boolean).map(Number);
  if (parts.length < 3) return '';
  let [jy, jm, jd] = parts;
  if (jy < 100) {
    // سال دو رقمی: نزدیک‌ترین تفسیر به سال جاری (نه همیشه ۱۳۰۰)
    const [cy] = jParts(todayIso());
    jy = Math.floor(cy / 100) * 100 + jy;
    if (jy > cy + 10) jy -= 100;
  } else if (jy < 1200) {
    jy += 1300;
  }
  if (jm < 1 || jm > 12 || jd < 1 || jd > 31) return '';
  const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
  return `${gy}-${pad(gm)}-${pad(gd)}`;
};

export const jalaliLong = (iso) => {
  const [y, m, d] = jParts(iso);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

export const monthKey = (iso) => {
  const [y, m] = jParts(iso);
  return `${y}-${pad(m)}`;
};

export const monthKeyLabel = (key) => {
  const [y, m] = String(key).split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
};

export const currentMonthKey = () => monthKey(todayIso());

export const lastMonthKeys = (count) => {
  let [y, m] = jParts(todayIso());
  const out = [];
  for (let i = 0; i < count; i++) {
    out.unshift(`${y}-${pad(m)}`);
    if (--m === 0) { m = 12; y--; }
  }
  return out;
};

export const isoPlusDays = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const daysBetween = (isoA, isoB) =>
  Math.round((new Date(isoB) - new Date(isoA)) / 86400000);

/* ============================ اعداد و متن ============================ */

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

export const faNum = (v) => String(v).replace(/[0-9]/g, (d) => FA_DIGITS[+d]);

export function money(value) {
  let n = Math.round(Number(value) || 0);
  const negative = n < 0;
  n = Math.abs(n);
  return (negative ? '−' : '') + faNum(String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '٬'));
}

export const toman = (v) => `${money(v)} تومان`;

/** نمایش فشرده برای کارت‌های آماری: ۱۲٫۴ میلیون */
export function moneyShort(value) {
  const n = Math.abs(Number(value) || 0);
  const sign = Number(value) < 0 ? '−' : '';
  if (n >= 1e9) return `${sign}${faNum((n / 1e9).toFixed(n >= 1e10 ? 0 : 1))} میلیارد`;
  if (n >= 1e6) return `${sign}${faNum((n / 1e6).toFixed(n >= 1e7 ? 0 : 1))} میلیون`;
  if (n >= 1e3) return `${sign}${faNum((n / 1e3).toFixed(0))} هزار`;
  return money(value);
}

export function num(value) {
  // «٬» جداکننده هزارگان و «٫» جداکننده اعشار فارسی است
  const s = enDigits(value)
    .replace(/[\u066c\s,']/g, '')
    .replace(/\u066b/g, '.');
  const n = parseFloat(s);
  return Number.isNaN(n) ? 0 : n;
}

export const roundTo = (value, step = 1000) =>
  step > 0 ? Math.round(Number(value) / step) * step : Math.round(Number(value));

export const uid = (prefix = 'id') =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export const sum = (list, pick) => list.reduce((acc, item) => acc + (Number(pick(item)) || 0), 0);

export const byId = (list, id) => list.find((x) => x.id === id) || null;

export const uniq = (list) => [...new Set(list.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fa'));

export const debounce = (fn, wait = 250) => {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
};

/* ============================== ثابت‌ها ============================== */

export const EXPENSE_CATS = ['خرید کالا', 'اجاره مغازه', 'حقوق و دستمزد', 'قبوض (آب، برق، گاز، تلفن)', 'حمل و نقل', 'تبلیغات', 'مالیات و عوارض', 'بیمه', 'تجهیزات و تعمیرات', 'لوازم مصرفی مغازه', 'کارمزد بانکی', 'برداشت شخصی', 'پرداخت چک', 'متفرقه'];
export const INCOME_CATS = ['فروش کالا', 'خدمات و تعمیرات', 'تخفیف خرید از تأمین‌کننده', 'آورده نقدی مالک', 'وصول چک', 'سایر درآمد'];
export const UNITS = ['عدد', 'بسته', 'متر', 'کیلوگرم', 'جفت', 'حلقه', 'لیتر'];
export const PRODUCT_CATS = ['ابزار برقی', 'ابزار دستی', 'یراق و قفل', 'پیچ و مهره', 'لوازم برقی و سیم', 'لوله و اتصالات', 'رنگ و چسب', 'ایمنی و حفاظت', 'مواد مصرفی'];
export const PAY_METHODS = ['نقد', 'کارتخوان', 'کارت به کارت', 'انتقال بانکی', 'چک', 'اعتباری'];
export const ACCOUNT_TYPES = ['صندوق مغازه', 'حساب بانکی', 'کیف پول دیجیتال', 'سایر'];
export const CONTACT_ROLES = ['مشتری', 'تأمین‌کننده', 'هر دو'];
export const DOC_TYPES = ['فاکتور رسمی خرید', 'فاکتور رسمی فروش', 'رسید بانکی', 'قرارداد', 'اظهارنامه مالیاتی', 'فیش پرداخت مالیات', 'بیمه', 'اجاره‌نامه', 'سایر'];
export const INVOICE_KINDS = ['فروش', 'خرید', 'مرجوعی فروش', 'مرجوعی خرید'];
export const CHEQUE_KINDS = ['دریافتی (از مشتری)', 'پرداختی (به تأمین‌کننده)'];
export const CHEQUE_STATUS = ['در جریان', 'پاس شده', 'برگشتی', 'باطل شده'];

/* دسته‌های ثبت خودکار فروش/خرید و تسویهٔ طرف حساب‌ها */
export const CAT_SALE = 'فروش کالا';
export const CAT_PURCHASE = 'خرید کالا';
export const CAT_SALE_RETURN = 'برگشت از فروش';
export const CAT_PURCHASE_RETURN = 'برگشت از خرید';
export const CAT_COLLECT = 'وصول مطالبات';
export const CAT_PAY_DEBT = 'پرداخت بدهی';
if (!EXPENSE_CATS.includes(CAT_SALE_RETURN)) EXPENSE_CATS.splice(EXPENSE_CATS.length - 1, 0, CAT_SALE_RETURN, CAT_PAY_DEBT);
if (!INCOME_CATS.includes(CAT_PURCHASE_RETURN)) INCOME_CATS.splice(INCOME_CATS.length - 1, 0, CAT_PURCHASE_RETURN, CAT_COLLECT);

/* ========================= منطق دامنه حسابداری ========================= */

// تخفیف هر ردیف فقط از همان ردیف کم می‌شود و ردیف هرگز منفی نمی‌شود (رفتار استاندارد فاکتور).
export const invoiceSubtotal = (inv) =>
  sum(inv.items || [], (it) => Math.max(0, num(it.qty) * num(it.price) - num(it.discount)));

export const invoiceTax = (inv) =>
  Math.round(Math.max(0, invoiceSubtotal(inv) - num(inv.discount)) * num(inv.taxRate) / 100);

export const invoiceTotal = (inv) =>
  Math.max(0, invoiceSubtotal(inv) - num(inv.discount)) + invoiceTax(inv);

// تراکنش «تعهدی» (ثبت خودکار فروش/خرید نسیه) پرداخت محسوب نمی‌شود
export const invoicePaid = (inv, txns) =>
  sum(txns.filter((t) => t.invoiceId === inv.id && !t.accrual), (t) => t.amount) + num(inv.openingPaid);

export const invoiceBalance = (inv, txns) => Math.max(0, invoiceTotal(inv) - invoicePaid(inv, txns));

export const invoiceCost = (inv, products) =>
  sum(inv.items || [], (it) => {
    const product = byId(products, it.productId);
    const unitCost = num(it.cost) || (product ? num(product.buy) : 0);
    return unitCost * num(it.qty);
  });

export const invoiceProfit = (inv, products) =>
  Math.max(0, invoiceSubtotal(inv) - num(inv.discount)) - invoiceCost(inv, products);

export function invoiceStatus(inv, txns) {
  const balance = invoiceBalance(inv, txns);
  const paid = invoicePaid(inv, txns);
  if (balance <= 0) return { key: 'paid', label: 'تسویه شده', tone: 'green' };
  if (paid > 0) return { key: 'partial', label: 'بخشی پرداخت شده', tone: 'orange' };
  if (inv.due && inv.due < todayIso()) return { key: 'overdue', label: 'معوق', tone: 'red' };
  return { key: 'open', label: 'پرداخت نشده', tone: 'neutral' };
}

export function accountBalance(accountId, state) {
  const account = byId(state.accounts, accountId);
  if (!account) return 0;
  let balance = num(account.opening);
  for (const t of state.txns) {
    if (t.type === 'درآمد' && t.accountId === accountId) balance += num(t.amount);
    if (t.type === 'هزینه' && t.accountId === accountId) balance -= num(t.amount);
    if (t.type === 'انتقال') {
      if (t.accountId === accountId) balance -= num(t.amount);
      if (t.toAccountId === accountId) balance += num(t.amount);
    }
  }
  return balance;
}

export const cashTotal = (state) => sum(state.accounts, (a) => accountBalance(a.id, state));
export const stockValue = (state) => sum(state.products, (p) => num(p.stock) * num(p.buy));
export const lowStock = (state) => state.products.filter((p) => num(p.stock) <= num(p.min));

// فاکتورهای مرجوعی، طلب/بدهی را خلاف جهت فاکتور اصلی تغییر می‌دهند
const RECEIVABLE_SIGN = { 'فروش': 1, 'مرجوعی فروش': -1 };
const PAYABLE_SIGN = { 'خرید': 1, 'مرجوعی خرید': -1 };

export const receivable = (state) => sum(
  state.invoices.filter((i) => RECEIVABLE_SIGN[i.kind]),
  (i) => RECEIVABLE_SIGN[i.kind] * invoiceBalance(i, state.txns),
);

export const payable = (state) => sum(
  state.invoices.filter((i) => PAYABLE_SIGN[i.kind]),
  (i) => PAYABLE_SIGN[i.kind] * invoiceBalance(i, state.txns),
);

export const monthTxns = (state, key) => state.txns.filter((t) => monthKey(t.date) === key);
// «تسویه» جابه‌جایی طلب/بدهی است، نه درآمد یا هزینهٔ تازه؛ پس در جمع ماه شمرده نمی‌شود
export const isLedgerIncome = (t) => t.type === 'درآمد' && !t.settle;
export const isLedgerExpense = (t) => t.type === 'هزینه' && !t.settle;
export const monthIncome = (state, key) => sum(monthTxns(state, key).filter(isLedgerIncome), (t) => t.amount);
export const monthExpense = (state, key) => sum(monthTxns(state, key).filter(isLedgerExpense), (t) => t.amount);

export const monthSalesProfit = (state, key) => sum(
  state.invoices.filter((i) => i.kind === 'فروش' && monthKey(i.date) === key),
  (i) => invoiceProfit(i, state.products),
);

export const openCheques = (state, kind) =>
  state.cheques.filter((c) => c.status === 'در جریان' && (!kind || c.kind === kind));

export const chequesDueSoon = (state, days = 7) => {
  const limit = isoPlusDays(days);
  return openCheques(state).filter((c) => c.due && c.due <= limit);
};

/* ============ روزها، فروش روز و پروندهٔ طرف حساب (نسخه ۱.۹) ============ */

/** تعداد روزهای یک ماه شمسی (اسفند ۲۹ یا ۳۰ روز) */
export function jalaliMonthLength(jy, jm) {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  const [gy, gm, gd] = jalaliToGregorian(jy, 12, 30);
  return gregorianToJalali(gy, gm, gd)[1] === 12 ? 30 : 29;
}

/** روزهای یک ماه شمسی به شکل [{ day, iso }] */
export function monthDays(key) {
  const [jy, jm] = String(key).split('-').map(Number);
  if (!Number.isFinite(jy) || !Number.isFinite(jm)) return [];
  const out = [];
  for (let d = 1; d <= jalaliMonthLength(jy, jm); d += 1) {
    const [gy, gm, gd] = jalaliToGregorian(jy, jm, d);
    out.push({ day: d, iso: `${gy}-${pad(gm)}-${pad(gd)}` });
  }
  return out;
}

export const dayTxns = (state, iso) => state.txns.filter((t) => t.date === iso);
export const dayIncome = (state, iso) => sum(dayTxns(state, iso).filter(isLedgerIncome), (t) => t.amount);
export const dayExpense = (state, iso) => sum(dayTxns(state, iso).filter(isLedgerExpense), (t) => t.amount);

const SALES_SIGN = { 'فروش': 1, 'مرجوعی فروش': -1 };

/** خلاصهٔ فروش یک روز: مبلغ، تعداد فاکتور، تعداد قلم، وصولی نقدی و سود */
export function daySales(state, iso) {
  const list = state.invoices.filter((i) => i.date === iso && SALES_SIGN[i.kind]);
  const cash = state.txns.filter((t) => t.date === iso && t.type === 'درآمد' && !t.accrual && !t.settle);
  return {
    count: list.filter((i) => i.kind === 'فروش').length,
    returns: list.filter((i) => i.kind === 'مرجوعی فروش').length,
    total: sum(list, (i) => SALES_SIGN[i.kind] * invoiceTotal(i)),
    profit: sum(list, (i) => SALES_SIGN[i.kind] * invoiceProfit(i, state.products)),
    units: list.reduce((acc, i) => acc + SALES_SIGN[i.kind] * sum(i.items || [], (it) => num(it.qty)), 0),
    cash: sum(cash, (t) => t.amount),
  };
}

/* فروش = طلب ما، خرید = بدهی ما؛ مرجوعی‌ها خلاف جهت فاکتور اصلی */
export const CONTACT_BALANCE_SIGN = { 'فروش': 1, 'خرید': -1, 'مرجوعی فروش': -1, 'مرجوعی خرید': 1 };

export const contactInvoices = (state, id) => state.invoices.filter((i) => i.contactId === id);
export const contactTxns = (state, id) => state.txns.filter((t) => t.contactId === id);
export const contactCheques = (state, id) => (state.cheques || []).filter((c) => c.contactId === id);

/** فاکتورهای بازِ یک طرف حساب در یک جهت (۱ = او بدهکار است) از قدیمی به جدید */
export const contactOpenInvoices = (state, id, dir) => contactInvoices(state, id)
  .filter((i) => CONTACT_BALANCE_SIGN[i.kind] === dir && invoiceBalance(i, state.txns) > 0)
  .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

/** مانده حساب طرف حساب؛ مثبت = او به ما بدهکار است */
export function contactBalance(state, id) {
  const fromInvoices = sum(
    contactInvoices(state, id).filter((i) => CONTACT_BALANCE_SIGN[i.kind]),
    (i) => CONTACT_BALANCE_SIGN[i.kind] * invoiceBalance(i, state.txns),
  );
  // دریافت/پرداخت علی‌الحساب که به فاکتور خاصی وصل نیست
  const advances = sum(
    contactTxns(state, id).filter((t) => t.settle && !t.invoiceId),
    (t) => (t.type === 'درآمد' ? -num(t.amount) : num(t.amount)),
  );
  return fromInvoices + advances;
}
