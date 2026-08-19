/**
 * views-sales.js — داشبورد، فاکتورها، کالاها و ورود گروهی کالا.
 */

import {
  CHEQUE_KINDS, INVOICE_KINDS, PAY_METHODS, UNITS,
  cashTotal, chequesDueSoon, currentMonthKey, esc, faNum, invoiceBalance, invoicePaid,
  invoiceProfit, invoiceStatus, invoiceSubtotal, invoiceTax, invoiceTotal, isoPlusDays,
  isoToJalali, jalaliLong, lastMonthKeys, lowStock, money, moneyShort, monthExpense,
  monthIncome, monthKey, monthKeyLabel, monthSalesProfit, num, payable, receivable,
  enDigits, normText, roundTo, stockValue, todayIso, toman, uniq,
  CAT_PURCHASE, CAT_PURCHASE_RETURN, CAT_SALE, CAT_SALE_RETURN,
  dayExpense, dayIncome, daySales, debounce, jalaliToIso, monthDays, sum,
} from './core.js';
import {
  $, $$, banner, card, chip, confirmDialog, dateField, download, empty, icon,
  number as numberField, openDrawer, rowActions, select, stat, table, tabs, text, textarea, toast,
} from './ui.js';

export const contactOptions = (state) => state.contacts.map((c) => ({ v: c.id, t: c.name }));
export const accountOptions = (state) => state.accounts.map((a) => ({ v: a.id, t: a.name }));
export const contactName = (state, id) => state.contacts.find((c) => c.id === id)?.name || 'مشتری متفرقه';
export const productName = (state, id) => state.products.find((p) => p.id === id)?.name || '';

/* ================================ داشبورد ================================ */

export const dashboard = {
  title: 'داشبورد',
  subtitle: () => `امروز ${jalaliLong(todayIso())}`,
  actions: () => `
    <button class="btn" data-go="money">ثبت دخل و خرج</button>
    <button class="btn" data-new-invoice>فاکتور جدید</button>
    <button class="btn btn-primary" data-quick-sale>فروش سریع</button>`,

  render(ctx) {
    const { state } = ctx;
    const key = currentMonthKey();
    const today = todayIso();
    const allDays = monthDays(key);
    const passed = allDays.filter((d) => d.iso <= today);
    const chartDays = passed.length ? passed : allDays;
    const sales = daySales(state, today);

    const low = lowStock(state);
    const soon = chequesDueSoon(state, 7);
    const overdue = state.invoices.filter((i) => i.kind === 'فروش' && invoiceStatus(i, state.txns).key === 'overdue');

    const alerts = [
      low.length ? banner(`<b>${faNum(low.length)} کالا</b> به حداقل موجودی رسیده است.`, 'orange', icon('alert'),
        '<button class="btn btn-sm" data-go="products">دیدن کالاها</button>') : '',
      soon.length ? banner(`<b>${faNum(soon.length)} چک</b> تا ۷ روز آینده سررسید می‌شود.`, 'red', icon('cheque'),
        '<button class="btn btn-sm" data-go="cheques">دیدن چک‌ها</button>') : '',
      overdue.length ? banner(`<b>${faNum(overdue.length)} فاکتور فروش</b> معوق شده است.`, 'blue', icon('invoice'),
        '<button class="btn btn-sm" data-go="invoices">پیگیری</button>') : '',
    ].filter(Boolean).join('');

    const maxBar = Math.max(1, ...chartDays.flatMap((d) => [dayIncome(state, d.iso), dayExpense(state, d.iso)]));
    const chart = `<div class="chart" role="img" aria-label="نمودار روزانه درآمد و هزینه ماه جاری">
      ${chartDays.map((d) => {
        const inc = dayIncome(state, d.iso);
        const exp = dayExpense(state, d.iso);
        return `<div class="col">
          <div class="pair">
            <span class="b income" style="height:${(inc / maxBar) * 100}%" title="${faNum(d.day)} — درآمد ${money(inc)}"></span>
            <span class="b expense" style="height:${(exp / maxBar) * 100}%" title="${faNum(d.day)} — هزینه ${money(exp)}"></span>
          </div>
          <span class="cl">${d.day === 1 || d.day % 5 === 0 || d.iso === today ? faNum(d.day) : ''}</span>
        </div>`;
      }).join('')}
    </div>
    <div class="cluster" style="margin-top:var(--sp-3)">${chip('درآمد', 'green')}${chip('هزینه', 'red')}
      <span class="small muted">جمع ماه: درآمد ${money(monthIncome(state, key))} — هزینه ${money(monthExpense(state, key))}</span>
    </div>`;

    const meters = state.accounts.length ? `<div class="meters">${(() => {
      const total = Math.max(1, ...state.accounts.map((a) => Math.abs(ctxBalance(a.id, state))));
      return state.accounts.map((a) => {
        const b = ctxBalance(a.id, state);
        return `<div class="meter">
          <span class="name">${esc(a.name)}</span>
          <span class="track"><span class="fill" data-tone="${b < 0 ? 'red' : 'blue'}" style="width:${(Math.abs(b) / total) * 100}%"></span></span>
          <span class="nums small">${money(b)}</span>
        </div>`;
      }).join('');
    })()}</div>` : empty('حسابی ثبت نشده', 'صندوق مغازه را اضافه کنید.', icon('wallet', 28), '<button class="btn btn-sm" data-go="accounts">حساب‌ها</button>');

    const recent = state.invoices.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 6);
    const recentRows = recent.map((inv) => {
      const st = invoiceStatus(inv, state.txns);
      return {
        _id: inv.id,
        no: `<span class="nums">#${faNum(inv.no || '')}</span>`,
        kind: chip(inv.kind, inv.kind === 'فروش' ? 'green' : inv.kind === 'خرید' ? 'blue' : 'orange'),
        party: esc(contactName(state, inv.contactId)),
        date: isoToJalali(inv.date),
        total: money(invoiceTotal(inv)),
        status: chip(st.label, st.tone === 'neutral' ? '' : st.tone),
      };
    });

    return `
      ${alerts}
      <div style="margin-top:var(--sp-4)">
        ${card({
          title: `فروش امروز — ${jalaliLong(today)}`,
          actions: '<button class="btn btn-sm btn-primary" data-quick-sale>فروش سریع</button><button class="btn btn-sm" data-go="invoices">فاکتورها</button>',
          body: `<div class="grid cols-4">
            ${stat({ label: 'مبلغ فروش امروز', value: money(sales.total), unit: 'تومان', tone: 'green', icon: icon('invoice') })}
            ${stat({ label: 'تعداد فاکتور امروز', value: faNum(sales.count), hint: sales.returns ? `${faNum(sales.returns)} مرجوعی امروز` : `${faNum(sales.units)} قلم کالا` })}
            ${stat({ label: 'وصولی نقدی امروز', value: money(sales.cash), unit: 'تومان', tone: 'blue', icon: icon('wallet') })}
            ${stat({ label: 'سود امروز', value: money(sales.profit), unit: 'تومان', tone: 'orange', icon: icon('report') })}
          </div>`,
        })}
      </div>
      <div class="grid cols-4" style="margin:var(--sp-4) 0">
        ${stat({ label: `فروش ${monthKeyLabel(key)}`, value: moneyShort(monthIncome(state, key)), unit: 'تومان', tone: 'green', icon: icon('up') })}
        ${stat({ label: `هزینه ${monthKeyLabel(key)}`, value: moneyShort(monthExpense(state, key)), unit: 'تومان', tone: 'red', icon: icon('down') })}
        ${stat({ label: 'موجودی نقد و بانک', value: moneyShort(cashTotal(state)), unit: 'تومان', tone: 'blue', icon: icon('wallet') })}
        ${stat({ label: 'سود ناخالص ماه', value: moneyShort(monthSalesProfit(state, key)), unit: 'تومان', tone: 'orange', icon: icon('report') })}
      </div>
      <div class="grid cols-sidebar">
        ${card({ title: `درآمد و هزینه ${monthKeyLabel(key)} (روزانه)`, body: chart })}
        ${card({ title: 'مانده حساب‌ها', body: meters })}
      </div>
      <div class="grid cols-3" style="margin-top:var(--sp-4)">
        ${stat({ label: 'طلب از مشتریان', value: moneyShort(receivable(state)), unit: 'تومان' })}
        ${stat({ label: 'بدهی به تأمین‌کنندگان', value: moneyShort(payable(state)), unit: 'تومان' })}
        ${stat({ label: 'ارزش انبار', value: moneyShort(stockValue(state)), unit: 'تومان' })}
      </div>
      <div style="margin-top:var(--sp-4)">
        ${card({
          title: 'آخرین فاکتورها',
          actions: '<button class="btn btn-sm" data-go="invoices">همه فاکتورها</button>',
          tight: true,
          body: table([
            { key: 'no', label: 'شماره' },
            { key: 'kind', label: 'نوع' },
            { key: 'party', label: 'طرف حساب' },
            { key: 'date', label: 'تاریخ' },
            { key: 'total', label: 'مبلغ', num: true },
            { key: 'status', label: 'وضعیت' },
          ], recentRows, { emptyState: empty('هنوز فاکتوری ثبت نشده', 'اولین فاکتور فروش یا خرید را صادر کنید.', icon('invoice', 28), '<button class="btn btn-primary btn-sm" data-new-invoice>فاکتور جدید</button>') }),
        })}
      </div>`;
  },
};

function ctxBalance(accountId, state) {
  const account = state.accounts.find((a) => a.id === accountId);
  if (!account) return 0;
  let balance = num(account.opening);
  state.txns.forEach((t) => {
    if (t.type === 'درآمد' && t.accountId === accountId) balance += num(t.amount);
    if (t.type === 'هزینه' && t.accountId === accountId) balance -= num(t.amount);
    if (t.type === 'انتقال') {
      if (t.accountId === accountId) balance -= num(t.amount);
      if (t.toAccountId === accountId) balance += num(t.amount);
    }
  });
  return balance;
}

/* =============================== فاکتورها =============================== */

const nextInvoiceNo = (state) =>
  String(Math.max(1000, ...state.invoices.map((i) => num(i.no) || 0)) + 1);

function itemRowHtml(item = {}) {
  return `<div class="line-row" data-item>
    <input name="desc" list="product-list" value="${esc(item.desc || '')}" placeholder="نام کالا" data-product-id="${esc(item.productId || '')}" />
    <input name="qty" class="nums" inputmode="decimal" value="${esc(item.qty ?? 1)}" placeholder="تعداد" />
    <input name="price" class="nums" inputmode="decimal" value="${esc(item.price ?? '')}" placeholder="قیمت واحد" />
    <input name="discount" class="nums" inputmode="decimal" value="${esc(item.discount ?? '')}" placeholder="تخفیف" />
    <button type="button" class="btn btn-sm btn-icon rm" data-rm aria-label="حذف ردیف">${icon('close')}</button>
  </div>`;
}

function readItems(form, state, keep = []) {
  return $$('[data-item]', form).map((row) => {
    const desc = $('[name=desc]', row).value.trim();
    const product = state.products.find((p) => p.name === desc)
      || state.products.find((p) => normText(p.name) === normText(desc));
    const qty = num($('[name=qty]', row).value);
    const price = num($('[name=price]', row).value);
    // بها تمام‌شده قبلی (از خود فاکتور) حفظ می‌شود؛ در غیر این صورت قیمت خرید کالا
    const prior = keep.find((k) => k.desc === desc && num(k.qty) === qty && num(k.price) === price);
    return {
      desc,
      productId: product?.id || prior?.productId || '',
      qty,
      price,
      discount: num($('[name=discount]', row).value),
      cost: prior && num(prior.cost) ? num(prior.cost) : (product ? num(product.buy) : 0),
    };
  }).filter((it) => it.desc && it.qty > 0);
}

/* اثر هر نوع فاکتور روی موجودی انبار (factor = -1 برای برگشت اثر) */
const STOCK_SIGN = { 'فروش': -1, 'مرجوعی فروش': 1, 'خرید': 1, 'مرجوعی خرید': -1 };

function findProduct(state, item) {
  return state.products.find((p) => p.id === item.productId)
    || state.products.find((p) => normText(p.name) === normText(item.desc));
}

/** اعمال اثر ردیف‌های فاکتور روی موجودی؛ خروجی = تعداد ردیف‌های پیدا‌نشده */
function applyStockChange(store, state, kind, items, factor = 1) {
  const sign = (STOCK_SIGN[kind] || 0) * factor;
  if (!sign) return 0;
  let missing = 0;
  (items || []).forEach((it) => {
    const product = findProduct(state, it);
    if (product) store.put('product', { ...product, stock: num(product.stock) + sign * num(it.qty) });
    else missing += 1;
  });
  return missing;
}

/** برچسب فاکتور/سفارش مبنای مرجوعی */
function refLabel(state, key) {
  const [type, id] = String(key).split(':');
  if (type === 'order') {
    const order = (state.orders || []).find((o) => o.id === id);
    return `مرجوعی از سفارش ${order?.no || 'سایت'}`;
  }
  const src = state.invoices.find((i) => i.id === id);
  return `مرجوعی از فاکتور #${src?.no || ''}`;
}

/** فیلدهای وابسته به روش پرداخت (مشترک بین فاکتور و فروش سریع) */
function payFieldsHtml(state, method, contactId) {
  const all = accountOptions(state);
  const pick = (arr) => (arr.length ? arr : all);
  const cash = pick(state.accounts.filter((a) => a.type === 'صندوق مغازه').map((a) => ({ v: a.id, t: a.name })));
  const bank = pick(state.accounts.filter((a) => a.type !== 'صندوق مغازه').map((a) => ({ v: a.id, t: a.name })));
  if (method === 'نقد') return select('payAccountId', 'ورود به صندوق', cash, cash[0]?.v || '', { blank: '—' });
  if (method === 'کارتخوان') {
    return select('payAccountId', 'حساب مقصد کارتخوان', bank, bank[0]?.v || '', { blank: '—' })
      + text('posName', 'کارتخوان', '', { placeholder: 'مثلاً کارتخوان ملت — پیشخوان' });
  }
  if (method === 'کارت به کارت' || method === 'انتقال بانکی') {
    return select('payAccountId', 'واریز به حساب', bank, bank[0]?.v || '', { blank: '—' })
      + text('payRef', 'شماره پیگیری / چهار رقم آخر کارت', '');
  }
  if (method === 'چک') {
    return text('chequeNo', 'شماره چک', '') + text('chequeBank', 'بانک', '')
      + dateField('chequeDue', 'تاریخ سررسید', isoPlusDays(30));
  }
  if (method === 'اعتباری') {
    return select('creditContactId', 'طرف حساب اعتباری', contactOptions(state), contactId || '', {
      blank: '— از لیست طرف حساب‌ها انتخاب کنید —', span: true,
      hint: 'اگر در لیست نیست، نام و تلفن خریدار را بنویسید تا خودکار ساخته شود',
    })
      + text('buyerName', 'یا نام خریدار جدید', '')
      + text('buyerPhone', 'شماره تماس', '');
  }
  return '';
}

/** اتصال پنل پرداخت به فرم؛ خروجی = تابع رندر دوباره */
function bindPayPanel(form, state, onChange) {
  const box = $('#pay-extra', form);
  const methodEl = $('[name=payMethod]', form);
  const contactEl = $('[name=contactId]', form);
  if (!box || !methodEl) return () => {};
  const render = () => {
    box.innerHTML = payFieldsHtml(state, methodEl.value, contactEl?.value || '');
    const credit = $('[name=creditContactId]', box);
    if (credit && contactEl) {
      credit.addEventListener('change', () => { contactEl.value = credit.value; });
    }
    const amountField = $('[name=payAmount]', form)?.closest('.field');
    if (amountField) amountField.style.display = methodEl.value === 'اعتباری' ? 'none' : '';
    if (onChange) onChange();
  };
  methodEl.addEventListener('change', render);
  if (contactEl) contactEl.addEventListener('change', render);
  render();
  return render;
}

/** ثبت خودکار فروش/خرید در دفتر درآمد و هزینه (بخش نسیه، بدون اثر روی صندوق) */
function ledgerEntry(store, invoice, { amount, contactId, method, date }) {
  const cat = {
    'فروش': CAT_SALE, 'خرید': CAT_PURCHASE,
    'مرجوعی فروش': CAT_SALE_RETURN, 'مرجوعی خرید': CAT_PURCHASE_RETURN,
  }[invoice.kind];
  const isExpense = invoice.kind === 'خرید' || invoice.kind === 'مرجوعی فروش';
  if (!cat || !(amount > 0)) return;
  store.put('txn', {
    date: date || invoice.date || todayIso(),
    type: isExpense ? 'هزینه' : 'درآمد',
    cat,
    amount,
    accountId: '',
    contactId: contactId || '',
    method: method === 'چک' ? 'چک' : 'اعتباری',
    note: `${invoice.kind} #${invoice.no} — ثبت خودکار (دریافت‌نشده)`,
    invoiceId: invoice.id,
    accrual: true,
  });
}

/** ثبت کل مبلغ یک فاکتور در دفتر درآمد و هزینه (برای سفارش‌های سایت) */
export function recordSaleLedger(store, invoice, { contactId = '', method = 'اعتباری', date } = {}) {
  ledgerEntry(store, invoice, { amount: invoiceTotal(invoice), contactId, method, date });
}

function openInvoiceForm(ctx, invoice, options = {}) {

  const { state, store } = ctx;
  const settings = state.settings;
  const inv = invoice || {
    no: nextInvoiceNo(state), kind: 'فروش', date: todayIso(), due: todayIso(),
    contactId: '', discount: 0, taxRate: 0, openingPaid: 0, items: [{}], note: '',
  };
  const isEdit = !!invoice;
  const restock = !!options.restock;

  openDrawer({
    title: invoice ? `ویرایش فاکتور #${faNum(inv.no)}` : 'فاکتور جدید',
    wide: true,
    submitLabel: 'ذخیره فاکتور',
    body: `
      <datalist id="product-list">${state.products.map((p) => `<option value="${esc(p.name)}"></option>`).join('')}</datalist>
      ${isEdit ? banner(restock
        ? 'موجودی ردیف‌های قبلی به انبار برگشت می‌خورد و پس از ذخیره، موجودی بر اساس ردیف‌های جدید حساب می‌شود.'
        : 'موجودی کالاها دست‌نخورده می‌ماند و پرداخت‌های ثبت‌شده حفظ می‌شود.', restock ? 'orange' : 'blue', icon('info')) + '<div style="height:var(--sp-3)"></div>' : ''}
      <div class="form-grid">
        ${select('kind', 'نوع فاکتور', INVOICE_KINDS, inv.kind)}
        ${text('no', 'شماره فاکتور', inv.no)}
        ${select('contactId', 'طرف حساب', contactOptions(state), inv.contactId, { blank: 'مشتری متفرقه' })}
        ${dateField('date', 'تاریخ', inv.date)}
        ${dateField('due', 'مهلت پرداخت', inv.due || inv.date)}
        ${numberField('taxRate', 'درصد مالیات', inv.taxRate ?? settings.taxRate)}
      </div>
      <div class="form-grid" id="ref-box"></div>

      <h4 style="margin:var(--sp-4) 0 var(--sp-2)">ردیف‌های کالا</h4>
      <div class="line-head">
        <span>کالا</span><span>تعداد</span><span>قیمت واحد</span><span>تخفیف</span><span></span>
      </div>
      <div id="items">${(inv.items?.length ? inv.items : [{}]).map(itemRowHtml).join('')}</div>
      <button type="button" class="btn btn-sm" id="add-item">افزودن ردیف</button>

      <div class="form-grid" style="margin-top:var(--sp-4)">
        ${numberField('discount', 'تخفیف کل (تومان)', inv.discount || '')}
        ${textarea('note', 'توضیح', inv.note || '')}
      </div>

      <h4 style="margin:var(--sp-4) 0 var(--sp-2)">پرداخت</h4>
      <div class="form-grid">
        ${select('payMethod', 'روش پرداخت', PAY_METHODS, 'نقد')}
        ${numberField('payAmount', 'مبلغ پرداختی (تومان)', '')}
      </div>
      <div class="form-grid" id="pay-extra"></div>

      <div id="purchase-box" class="totals" style="margin-top:var(--sp-3);display:none">
        <label class="check"><input type="checkbox" name="addToProducts"${settings.addNewFromPurchase ? ' checked' : ''} />
          <span>کالاهای این فاکتور به لیست محصولات اضافه/به‌روز شوند</span></label>
        <div class="form-grid">
          ${numberField('markup', 'درصد سود برای قیمت فروش', settings.buyMarkup, { hint: 'قیمت فروش = قیمت خرید + این درصد' })}
        </div>
      </div>

      <div class="totals" id="totals" style="margin-top:var(--sp-4)"></div>`,

    onMount(form) {
      const kindEl = $('[name=kind]', form);
      const purchaseBox = $('#purchase-box', form);
      const refBox = $('#ref-box', form);

      const recalc = () => {
        const draft = {
          items: readItems(form, state),
          discount: num($('[name=discount]', form).value),
          taxRate: num($('[name=taxRate]', form).value),
        };
        const subtotal = invoiceSubtotal(draft);
        const tax = invoiceTax(draft);
        const total = invoiceTotal(draft);
        const paid = num($('[name=payAmount]', form).value);
        $('#totals', form).innerHTML = `
          <div class="line"><span>جمع ردیف‌ها</span><b class="nums">${toman(subtotal)}</b></div>
          <div class="line"><span>تخفیف کل</span><b class="nums">${toman(draft.discount)}</b></div>
          <div class="line"><span>مالیات</span><b class="nums">${toman(tax)}</b></div>
          <div class="line grand"><span>قابل پرداخت</span><b class="nums">${toman(total)}</b></div>
          <div class="line"><span>مانده پس از پرداخت</span><b class="nums">${toman(Math.max(0, total - paid))}</b></div>`;
        purchaseBox.style.display = kindEl.value === 'خرید' ? '' : 'none';
      };

      // پر‌کردن خودکار قیمت با انتخاب کالا
      form.addEventListener('input', (e) => {
        if (e.target.name === 'desc') {
          const product = state.products.find((p) => p.name === e.target.value.trim());
          if (product) {
            const row = e.target.closest('[data-item]');
            const priceEl = $('[name=price]', row);
            if (!num(priceEl.value)) {
              priceEl.value = kindEl.value === 'خرید' ? num(product.buy) : num(product.sell);
            }
          }
        }
        recalc();
      });
      form.addEventListener('change', recalc);

      const renderPay = bindPayPanel(form, state, recalc);
      void renderPay;

      // مرجوعی: انتخاب فاکتور یا سفارش سایتِ مبنا و پر شدن خودکار ردیف‌ها
      const byDateDesc = (a, b) => (b.date || '').localeCompare(a.date || '');
      const refOptions = (kind) => {
        if (kind === 'مرجوعی فروش') {
          return [
            ...state.invoices.filter((i) => i.kind === 'فروش').sort(byDateDesc).slice(0, 150)
              .map((i) => ({ v: `invoice:${i.id}`, t: `فاکتور فروش #${i.no} — ${contactName(state, i.contactId)} — ${isoToJalali(i.date)}` })),
            ...(state.orders || []).slice(0, 100)
              .map((o) => ({ v: `order:${o.id}`, t: `سفارش سایت ${o.no || ''} — ${o.name || ''}` })),
          ];
        }
        if (kind === 'مرجوعی خرید') {
          return state.invoices.filter((i) => i.kind === 'خرید').sort(byDateDesc).slice(0, 150)
            .map((i) => ({ v: `invoice:${i.id}`, t: `فاکتور خرید #${i.no} — ${contactName(state, i.contactId)} — ${isoToJalali(i.date)}` }));
        }
        return [];
      };

      const fillFromRef = (key) => {
        const [type, id] = String(key).split(':');
        const src = type === 'order'
          ? (state.orders || []).find((o) => o.id === id)
          : state.invoices.find((i) => i.id === id);
        if (!src) return;
        const rows = (src.items || []).map((it) => ({
          desc: it.desc || productName(state, it.productId),
          productId: it.productId || '',
          qty: num(it.qty),
          price: num(it.price),
          discount: 0,
        })).filter((it) => it.desc);
        if (rows.length) $('#items', form).innerHTML = rows.map(itemRowHtml).join('');
        if (src.contactId) $('[name=contactId]', form).value = src.contactId;
        const label = type === 'order' ? `سفارش سایت ${src.no || ''}` : `فاکتور #${src.no || ''}`;
        $('[name=note]', form).value = `مرجوعی از ${label}`;
        recalc();
      };

      const renderRef = () => {
        const options = refOptions(kindEl.value);
        if (!options.length) { refBox.innerHTML = ''; return; }
        refBox.innerHTML = select('refKey', 'مرجوعی از', options, inv.refKey || '', {
          blank: '— انتخاب کنید —', span: true,
          hint: 'با انتخاب فاکتور یا سفارش، ردیف‌ها و طرف حساب خودکار پر می‌شود',
        });
        $('[name=refKey]', refBox).addEventListener('change', (e) => {
          if (e.target.value) fillFromRef(e.target.value);
        });
      };

      kindEl.addEventListener('change', renderRef);
      renderRef();

      $('#add-item', form).addEventListener('click', () => {

        $('#items', form).insertAdjacentHTML('beforeend', itemRowHtml());
        const rows = $$('[data-item]', form);
        $('[name=desc]', rows[rows.length - 1]).focus();
      });

      form.addEventListener('click', (e) => {
        if (e.target.closest('[data-rm]')) {
          const rows = $$('[data-item]', form);
          if (rows.length > 1) e.target.closest('[data-item]').remove();
          else $$('input', rows[0]).forEach((el) => { el.value = ''; });
          recalc();
        }
      });

      recalc();
    },

    onSubmit(values, { form }) {
      const items = readItems(form, state, isEdit ? (invoice.items || []) : []);
      if (!items.length) { toast('حداقل یک ردیف کالا لازم است.', 'red'); return false; }

      const isPurchase = values.kind === 'خرید';
      const markup = num(values.markup) || settings.buyMarkup;
      const method = values.payMethod || 'نقد';

      // خریدار می‌تواند از لیست طرف حساب‌ها انتخاب شود یا تازه ساخته شود
      let buyerId = values.contactId || values.creditContactId || '';
      if (!buyerId && String(values.buyerName || '').trim()) {
        buyerId = store.put('contact', {
          name: String(values.buyerName).trim(),
          role: isPurchase ? 'تأمین‌کننده' : 'مشتری',
          phone: values.buyerPhone || '', nid: '', address: '',
          note: 'ثبت خودکار از فاکتور',
        }).id;
      }
      if (method === 'اعتباری' && !buyerId) {
        toast('برای پرداخت اعتباری، طرف حساب را از لیست انتخاب کنید یا نام خریدار را بنویسید.', 'red');
        return false;
      }

      // اگر کاربر در آغاز ویرایش «بله» را زده باشد، اثر ردیف‌های قبلی روی انبار برگشت می‌خورد
      if (isEdit && restock) applyStockChange(store, state, invoice.kind, invoice.items || [], -1);

      // افزودن/به‌روزرسانی کالاها از فاکتور خرید
      if (isPurchase && values.addToProducts && (!isEdit || restock)) {
        items.forEach((it) => {
          const existing = findProduct(state, it);
          if (existing) {
            store.put('product', {
              ...existing,
              buy: it.price || num(existing.buy),
              sell: num(existing.sell) || roundTo(it.price * (1 + markup / 100)),
              stock: num(existing.stock) + it.qty,
            });
          } else {
            store.put('product', {
              name: it.desc, sku: nextSku(state.products), unit: UNITS[0], loc: '',
              buy: it.price, sell: roundTo(it.price * (1 + markup / 100)), stock: it.qty, min: 1,
            });
          }
        });
      } else if (!isEdit || restock) {
        // موجودی بر اساس نوع فاکتور کم یا زیاد می‌شود
        const missing = applyStockChange(store, state, values.kind, items, 1);
        if (missing) toast(`${faNum(missing)} ردیف در لیست کالاها نبود؛ موجودی آن‌ها تغییر نکرد.`, 'orange');
      }

      const saved = store.put('invoice', {
        id: inv.id, no: values.no || nextInvoiceNo(state), kind: values.kind,
        date: values.date || todayIso(), due: values.due || values.date,
        contactId: buyerId, discount: num(values.discount), taxRate: num(values.taxRate),
        refKey: values.refKey || inv.refKey || '',
        // پرداخت‌های قبلی (تراکنش‌های مرتبط) حفظ می‌شود؛ openingPaid فقط برای صدور جدید است
        openingPaid: isEdit ? num(invoice.openingPaid) : 0, items, note: values.note,
      });

      const total = invoiceTotal(saved);
      const paid = method === 'اعتباری' ? 0 : Math.min(total, num(values.payAmount));
      const isExpense = values.kind === 'خرید' || values.kind === 'مرجوعی فروش';
      const cashCat = {
        'فروش': CAT_SALE, 'خرید': CAT_PURCHASE,
        'مرجوعی فروش': CAT_SALE_RETURN, 'مرجوعی خرید': CAT_PURCHASE_RETURN,
      }[values.kind] || CAT_SALE;

      if (!isEdit && method === 'چک' && paid > 0) {
        // چک به‌جای تراکنش نقدی، در دفتر چک‌ها ثبت می‌شود
        store.put('cheque', {
          kind: isExpense ? CHEQUE_KINDS[1] : CHEQUE_KINDS[0],
          no: values.chequeNo || '', bank: values.chequeBank || '', amount: paid,
          due: values.chequeDue || values.date || todayIso(),
          contactId: buyerId, status: 'در جریان',
          note: `فاکتور #${saved.no}`, invoiceId: saved.id,
        });
      } else if (!isEdit && method !== 'اعتباری' && paid > 0) {
        store.put('txn', {
          date: values.date || todayIso(),
          type: isExpense ? 'هزینه' : 'درآمد',
          cat: cashCat,
          amount: paid, accountId: values.payAccountId, contactId: buyerId,
          method, note: `فاکتور #${saved.no}${values.posName ? ` — ${values.posName}` : ''}${values.payRef ? ` — ${values.payRef}` : ''}`,
          invoiceId: saved.id,
        });
      }

      // هر فروش/خرید حتی نسیه، خودکار در دفتر درآمد و هزینه ثبت می‌شود
      if (!isEdit) {
        const cashPart = method === 'چک' || method === 'اعتباری' ? 0 : paid;
        ledgerEntry(store, saved, {
          amount: total - cashPart, contactId: buyerId, method, date: values.date || todayIso(),
        });
      }

      toast('فاکتور ذخیره شد', 'green');

      ctx.refresh();
      return true;
    },
  });
}

function printInvoice(state, inv) {
  const rows = (inv.items || []).map((it, i) => `<tr>
    <td>${faNum(i + 1)}</td><td>${esc(it.desc)}</td><td>${faNum(it.qty)}</td>
    <td>${money(it.price)}</td><td>${money(it.discount)}</td>
    <td>${money(Math.max(0, num(it.qty) * num(it.price) - num(it.discount)))}</td></tr>`).join('');

  const s = state.settings;
  document.getElementById('print-area').innerHTML = `
    <div class="print-doc">
      <div class="ph">
        <div><h2>${esc(s.shop || 'فاکتور')}</h2>
          <div>${esc(s.address || '')}</div><div>${esc(s.phone || '')}</div></div>
        <div style="text-align:left">
          <div><b>فاکتور ${esc(inv.kind)}</b></div>
          <div>شماره: ${faNum(inv.no || '')}</div>
          <div>تاریخ: ${isoToJalali(inv.date)}</div>
        </div>
      </div>
      <div style="margin-bottom:10px">طرف حساب: <b>${esc(contactName(state, inv.contactId))}</b></div>
      <table><thead><tr><th>ردیف</th><th>شرح کالا</th><th>تعداد</th><th>قیمت</th><th>تخفیف</th><th>جمع</th></tr></thead>
        <tbody>${rows}</tbody></table>
      <div class="pf">
        <div style="max-width:45%">${esc(inv.note || '')}</div>
        <table class="psum">
          <tr><td>جمع ردیف‌ها</td><td>${toman(invoiceSubtotal(inv))}</td></tr>
          <tr><td>تخفیف</td><td>${toman(inv.discount)}</td></tr>
          <tr><td>مالیات</td><td>${toman(invoiceTax(inv))}</td></tr>
          <tr class="grand"><td>قابل پرداخت</td><td>${toman(invoiceTotal(inv))}</td></tr>
          <tr><td>پرداخت شده</td><td>${toman(invoicePaid(inv, state.txns))}</td></tr>
          <tr><td>مانده</td><td>${toman(invoiceBalance(inv, state.txns))}</td></tr>
        </table>
      </div>
    </div>`;
  window.print();
}

export const invoices = {
  title: 'فاکتورها',
  subtitle: () => 'فاکتورهای فروش، خرید و مرجوعی',
  actions: () => '<button class="btn btn-primary" data-new-invoice>فاکتور جدید</button>',
  openForm: openInvoiceForm,

  render(ctx) {
    const { state, query } = ctx;
    const kind = ctx.params.kind || 'همه';
    const list = state.invoices
      .filter((i) => kind === 'همه' || i.kind === kind)
      .filter((i) => !query || normText(`${i.no || ''} ${contactName(state, i.contactId)} ${i.note || ''}`).includes(normText(query)))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    const rows = list.map((inv) => {
      const st = invoiceStatus(inv, state.txns);
      return {
        _id: inv.id,
        no: `<span class="nums">#${faNum(inv.no || '')}</span>${inv.refKey ? `<div class="tiny muted">${esc(refLabel(state, inv.refKey))}</div>` : ''}`,
        kind: chip(inv.kind, inv.kind === 'فروش' ? 'green' : inv.kind === 'خرید' ? 'blue' : 'orange'),
        party: esc(contactName(state, inv.contactId)),
        date: isoToJalali(inv.date),
        total: money(invoiceTotal(inv)),
        balance: money(invoiceBalance(inv, state.txns)),
        status: chip(st.label, st.tone === 'neutral' ? '' : st.tone),
        actions: rowActions([
          { icon: icon('print'), title: 'چاپ', attrs: `data-print="${inv.id}"` },
          { icon: icon('edit'), title: 'ویرایش', attrs: `data-edit="${inv.id}"` },
          { icon: icon('trash'), title: 'حذف', attrs: `data-del="${inv.id}"`, danger: true },
        ]),
      };
    });

    const totalSales = list.filter((i) => i.kind === 'فروش').reduce((a, i) => a + invoiceTotal(i), 0);
    const totalProfit = list.filter((i) => i.kind === 'فروش').reduce((a, i) => a + invoiceProfit(i, state.products), 0);

    return `
      <div class="grid cols-3" style="margin-bottom:var(--sp-4)">
        ${stat({ label: 'تعداد فاکتور', value: faNum(list.length) })}
        ${stat({ label: 'جمع فروش نمایش داده‌شده', value: moneyShort(totalSales), unit: 'تومان', tone: 'green' })}
        ${stat({ label: 'سود ناخالص', value: moneyShort(totalProfit), unit: 'تومان', tone: 'orange' })}
      </div>
      <div class="cluster" style="margin-bottom:var(--sp-4)">
        ${['همه', ...INVOICE_KINDS].map((k) =>
          `<button class="chip" data-filter="${esc(k)}"${k === kind ? ' data-tone="blue"' : ''}>${esc(k)}</button>`).join('')}
      </div>
      ${card({
        tight: true,
        body: table([
          { key: 'no', label: 'شماره' },
          { key: 'kind', label: 'نوع' },
          { key: 'party', label: 'طرف حساب' },
          { key: 'date', label: 'تاریخ' },
          { key: 'total', label: 'مبلغ کل', num: true },
          { key: 'balance', label: 'مانده', num: true },
          { key: 'status', label: 'وضعیت' },
          { key: 'actions', label: '' },
        ], rows, { emptyState: empty('فاکتوری یافت نشد', 'فیلتر را تغییر دهید یا فاکتور جدید بسازید.', icon('invoice', 28), '<button class="btn btn-primary btn-sm" data-new-invoice>فاکتور جدید</button>') }),
      })}`;
  },

  mount(root, ctx) {
    root.addEventListener('click', async (e) => {
      const filter = e.target.closest('[data-filter]');
      if (filter) return ctx.setParams({ kind: filter.dataset.filter });
      const edit = e.target.closest('[data-edit]');
      if (edit) {
        const inv = ctx.state.invoices.find((i) => i.id === edit.dataset.edit);
        if (!inv) return undefined;
        let restock = false;
        if ((inv.items || []).length && STOCK_SIGN[inv.kind]) {
          restock = await confirmDialog({
            title: 'موجودی کالاهای این فاکتور برگردد؟',
            message: 'با «بله»، اثر ردیف‌های فعلی روی انبار برگشت داده می‌شود و پس از ذخیره، موجودی بر اساس ردیف‌های جدید حساب می‌شود. با «انصراف»، موجودی دست‌نخورده می‌ماند.',
            confirmLabel: 'بله، برگردد',
            danger: false,
          });
        }
        return openInvoiceForm(ctx, inv, { restock });
      }
      const print = e.target.closest('[data-print]');
      if (print) return printInvoice(ctx.state, ctx.state.invoices.find((i) => i.id === print.dataset.print));
      const del = e.target.closest('[data-del]');
      if (del) {
        const inv = ctx.state.invoices.find((i) => i.id === del.dataset.del);
        if (!inv) return undefined;
        const ok = await confirmDialog({
          title: `حذف فاکتور #${faNum(inv.no || '')}؟`,
          message: 'فاکتور حذف می‌شود. تراکنش‌های نقدی ثبت‌شده در دفتر باقی می‌مانند.',
        });
        if (!ok) return undefined;
        let back = false;
        if ((inv.items || []).length && STOCK_SIGN[inv.kind]) {
          back = await confirmDialog({
            title: 'موجودی کالاها به انبار برگردد؟',
            message: inv.kind === 'فروش'
              ? 'با «بله»، کالاهای این فاکتور فروش به موجودی انبار اضافه می‌شود.'
              : 'با «بله»، اثر این فاکتور روی موجودی انبار برگشت داده می‌شود.',
            confirmLabel: 'بله، برگردد',
            danger: false,
          });
        }
        if (back) applyStockChange(ctx.store, ctx.state, inv.kind, inv.items || [], -1);
        // ثبت خودکار نسیهٔ همین فاکتور هم حذف می‌شود تا درآمد ساختگی نماند
        ctx.state.txns.filter((t) => t.invoiceId === inv.id && t.accrual)
          .forEach((t) => ctx.store.remove('txn', t.id));
        ctx.store.remove('invoice', inv.id);
        toast(back ? 'فاکتور حذف شد و موجودی برگشت' : 'فاکتور حذف شد');
      }

      return undefined;
    });
  },
};

/* ================================= کالاها ================================= */

/* درصد سود روی «قیمت فروش» اعمال می‌شود: قیمت خرید = فروش − درصد سود */
export const buyFromSell = (sell, margin) => roundTo(num(sell) * (1 - num(margin) / 100));
export const sellFromBuy = (buy, margin) => (num(margin) < 100 ? roundTo(num(buy) / (1 - num(margin) / 100)) : num(buy));

/** کد کالا خودکار ساخته می‌شود؛ نیازی به ثبت دستی نیست */
export function nextSku(products) {
  const nums = (products || [])
    .map((p) => Number(String(p.sku || '').replace(/[^0-9]/g, '')))
    .filter((n) => Number.isFinite(n) && n > 0);
  return `K-${(nums.length ? Math.max(...nums) : 1000) + 1}`;
}

function productForm(ctx, product) {
  const { state, store } = ctx;
  const p = product || { name: '', sku: '', unit: UNITS[0], loc: '', buy: '', sell: '', stock: 0, min: 1 };

  openDrawer({
    title: product ? 'ویرایش کالا' : 'کالای جدید',
    body: `<div class="form-grid">
      ${text('name', 'نام کالا', p.name, { span: true })}
      ${select('unit', 'واحد', UNITS, p.unit)}
      ${numberField('sell', 'قیمت فروش (تومان)', p.sell)}
      ${numberField('buy', 'قیمت خرید (تومان)', p.buy, { hint: `خالی بماند: ${faNum(state.settings.autoMargin)}٪ کمتر از قیمت فروش` })}
      ${numberField('stock', 'موجودی', p.stock)}
      ${numberField('min', 'حداقل موجودی', p.min)}
      ${text('loc', 'محل نگهداری', p.loc)}
      <p class="small muted" style="grid-column:1/-1">کد کالا خودکار ساخته می‌شود${p.sku ? ` — کد این کالا: ${esc(p.sku)}` : ''}</p>
    </div>`,
    onMount(form) {
      const buyEl = $('[name=buy]', form);
      const sellEl = $('[name=sell]', form);
      sellEl.addEventListener('input', () => {
        if (!num(buyEl.value)) buyEl.placeholder = String(buyFromSell(sellEl.value, state.settings.autoMargin));
      });
    },
    onSubmit(values) {
      if (!values.name) { toast('نام کالا الزامی است.', 'red'); return false; }
      const sell = num(values.sell);
      const buy = num(values.buy) || buyFromSell(sell, state.settings.autoMargin);
      const sku = p.sku || nextSku(state.products);
      store.put('product', {
        ...(product || {}), id: p.id, ...values, sku, buy, sell, stock: num(values.stock), min: num(values.min),
      });
      toast('کالا ذخیره شد', 'green');
      ctx.refresh();
      return true;
    },
  });
}

function priceBumpForm(ctx) {
  const { state, store } = ctx;
  openDrawer({
    title: 'افزایش گروهی قیمت',
    submitLabel: 'اعمال افزایش',
    body: `<p class="small muted">درصد دلخواه را روی قیمت فروش (و در صورت تمایل قیمت خرید) کالاها اعمال کنید.</p>
      <div class="form-grid">
        ${numberField('percent', 'درصد افزایش', 10)}
        ${select('round', 'گرد کردن به', [{ v: '1', t: 'بدون گرد کردن' }, { v: '1000', t: 'هزار تومان' }, { v: '5000', t: '۵ هزار تومان' }], '1000')}
      </div>
      <label class="check"><input type="checkbox" name="alsoBuy" /> <span>قیمت خرید هم افزایش پیدا کند</span></label>`,
    onSubmit(values) {
      const percent = num(values.percent);
      if (!percent) { toast('درصد را وارد کنید.', 'red'); return false; }
      const step = num(values.round) || 1;
      const targets = state.products;
      targets.forEach((p) => store.put('product', {
        ...p,
        sell: roundTo(num(p.sell) * (1 + percent / 100), step),
        buy: values.alsoBuy ? roundTo(num(p.buy) * (1 + percent / 100), step) : num(p.buy),
      }));
      toast(`قیمت ${faNum(targets.length)} کالا به‌روز شد`, 'green');
      ctx.refresh();
      return true;
    },
  });
}

/* ============================== فروش سریع ============================== */

const QUICK_DRAFT_KEY = 'hesabyar.quicksale.v1';

const readQuickDraft = () => {
  try { return JSON.parse(localStorage.getItem(QUICK_DRAFT_KEY) || 'null'); } catch { return null; }
};
const writeQuickDraft = (draft) => {
  try { localStorage.setItem(QUICK_DRAFT_KEY, JSON.stringify(draft)); } catch { /* حافظه پر است */ }
};
export const clearQuickDraft = () => {
  try { localStorage.removeItem(QUICK_DRAFT_KEY); } catch { /* بی‌اهمیت */ }
};

/**
 * فروش سریع: چند ردیف کالا در یک فاکتور، با همان روش‌های پرداخت فاکتور کامل.
 * تا وقتی ثبت نشود، ردیف‌ها به شکل پیش‌نویس روی همین دستگاه می‌مانند.
 */
export function quickSaleForm(ctx, product) {
  const { state, store } = ctx;
  const draft = product ? null : readQuickDraft();
  const draftRows = ((draft && draft.rows) || []).filter((r) => String(r.desc || '').trim());
  const startRows = product
    ? [{ desc: product.name, productId: product.id, qty: 1, price: num(product.sell) }]
    : (draftRows.length ? draftRows : [{}]);

  openDrawer({
    title: 'فروش سریع',
    wide: true,
    submitLabel: 'ثبت فروش',
    extraActions: '<button type="button" class="btn btn-sm" data-clear-draft>پاک کردن پیش‌نویس</button>',
    body: `
      <datalist id="product-list">${state.products.map((p) => `<option value="${esc(p.name)}"></option>`).join('')}</datalist>
      ${draftRows.length ? banner(`<b>${faNum(draftRows.length)} ردیف</b> از پیش‌نویس قبلی بازیابی شد.`, 'blue', icon('info')) + '<div style="height:var(--sp-3)"></div>' : ''}
      <div class="line-head">
        <span>کالا</span><span>تعداد</span><span>قیمت واحد</span><span>تخفیف</span><span></span>
      </div>
      <div id="items">${startRows.map(itemRowHtml).join('')}</div>
      <button type="button" class="btn btn-sm" id="q-add-item">افزودن ردیف</button>

      <div class="form-grid" style="margin-top:var(--sp-4)">
        ${select('contactId', 'مشتری', contactOptions(state), (draft && draft.contactId) || '', { blank: 'مشتری متفرقه' })}
        ${dateField('date', 'تاریخ', (draft && draft.date) || todayIso())}
        ${select('payMethod', 'روش پرداخت', PAY_METHODS, (draft && draft.payMethod) || 'نقد')}
        ${numberField('payAmount', 'مبلغ دریافتی (تومان)', '', { hint: 'خالی = تمام مبلغ فاکتور' })}
      </div>
      <div class="form-grid" id="pay-extra"></div>
      <div class="totals" id="q-total" style="margin-top:var(--sp-3)"></div>`,

    onMount(form) {
      const recalc = () => {
        const rows = readItems(form, state);
        const total = sum(rows, (it) => Math.max(0, num(it.qty) * num(it.price) - num(it.discount)));
        const lines = rows.map((it) => {
          const prod = findProduct(state, it);
          return prod
            ? `<div class="line"><span>${esc(prod.name)}</span><b class="nums">موجودی پس از فروش: ${faNum(num(prod.stock) - num(it.qty))} ${esc(prod.unit || '')}</b></div>`
            : `<div class="line"><span>${esc(it.desc)}</span><b class="nums">در انبار نیست</b></div>`;
        }).join('');
        $('#q-total', form).innerHTML = `${lines}<div class="line grand"><span>مبلغ کل</span><b class="nums">${toman(total)}</b></div>`;
      };

      const saveDraft = debounce(() => {
        if (product) return;
        const rows = $$('[data-item]', form).map((row) => ({
          desc: $('[name=desc]', row).value,
          qty: $('[name=qty]', row).value,
          price: $('[name=price]', row).value,
          discount: $('[name=discount]', row).value,
        })).filter((r) => String(r.desc || '').trim());
        const dateRaw = $('[name=date]', form).value;
        writeQuickDraft({
          rows,
          contactId: $('[name=contactId]', form).value,
          payMethod: $('[name=payMethod]', form).value,
          date: dateRaw ? jalaliToIso(dateRaw) : todayIso(),
          at: Date.now(),
        });
      }, 400);

      form.addEventListener('input', (e) => {
        if (e.target.name === 'desc') {
          const prod = state.products.find((p) => normText(p.name) === normText(e.target.value));
          if (prod) {
            const priceEl = $('[name=price]', e.target.closest('[data-item]'));
            if (!num(priceEl.value)) priceEl.value = num(prod.sell);
          }
        }
        recalc();
        saveDraft();
      });
      form.addEventListener('change', () => { recalc(); saveDraft(); });

      $('#q-add-item', form).addEventListener('click', () => {
        $('#items', form).insertAdjacentHTML('beforeend', itemRowHtml());
        const rows = $$('[data-item]', form);
        $('[name=desc]', rows[rows.length - 1]).focus();
      });

      form.addEventListener('click', (e) => {
        if (e.target.closest('[data-rm]')) {
          const rows = $$('[data-item]', form);
          if (rows.length > 1) e.target.closest('[data-item]').remove();
          else $$('input', rows[0]).forEach((el) => { el.value = ''; });
          recalc();
          saveDraft();
        }
      });

      const drawer = form.closest('.drawer');
      if (drawer) {
        drawer.addEventListener('click', (e) => {
          if (!e.target.closest('[data-clear-draft]')) return;
          clearQuickDraft();
          $('#items', form).innerHTML = itemRowHtml();
          recalc();
          toast('پیش‌نویس پاک شد');
        });
      }

      bindPayPanel(form, state, recalc);
      recalc();
    },

    onSubmit(values, { form }) {
      const items = readItems(form, state);
      if (!items.length) { toast('حداقل یک ردیف کالا با تعداد لازم است.', 'red'); return false; }

      const date = values.date || todayIso();
      const method = values.payMethod || 'نقد';
      let contactId = values.contactId || values.creditContactId || '';
      if (!contactId && String(values.buyerName || '').trim()) {
        contactId = store.put('contact', {
          name: String(values.buyerName).trim(), role: 'مشتری',
          phone: values.buyerPhone || '', nid: '', address: '',
          note: 'ثبت خودکار از فروش سریع',
        }).id;
      }
      if (method === 'اعتباری' && !contactId) {
        toast('برای فروش اعتباری، مشتری را انتخاب کنید یا نام خریدار را بنویسید.', 'red');
        return false;
      }

      const saved = store.put('invoice', {
        no: nextInvoiceNo(state), kind: 'فروش', date, due: date,
        contactId, discount: 0, taxRate: 0, openingPaid: 0, items, note: 'فروش سریع',
      });

      const missing = applyStockChange(store, state, 'فروش', items, 1);
      if (missing) toast(`${faNum(missing)} ردیف در انبار نبود؛ فقط در فاکتور ثبت شد.`, 'orange');

      const total = invoiceTotal(saved);
      const paid = method === 'اعتباری' ? 0 : Math.min(total, num(values.payAmount) || total);

      if (method === 'چک' && paid > 0) {
        store.put('cheque', {
          kind: CHEQUE_KINDS[0], no: values.chequeNo || '', bank: values.chequeBank || '',
          amount: paid, due: values.chequeDue || date, contactId, status: 'در جریان',
          note: `فروش سریع #${saved.no}`, invoiceId: saved.id,
        });
      } else if (method !== 'اعتباری' && paid > 0) {
        store.put('txn', {
          date, type: 'درآمد', cat: CAT_SALE, amount: paid,
          accountId: values.payAccountId, contactId, method,
          note: `فروش سریع #${saved.no}${values.posName ? ` — ${values.posName}` : ''}${values.payRef ? ` — ${values.payRef}` : ''}`,
          invoiceId: saved.id,
        });
      }

      const cashPart = method === 'چک' || method === 'اعتباری' ? 0 : paid;
      ledgerEntry(store, saved, { amount: total - cashPart, contactId, method, date });

      clearQuickDraft();
      toast(`فروش ${faNum(items.length)} ردیفی ثبت شد`, 'green');
      ctx.refresh();
      return true;
    },
  });
}

export const products = {

  title: 'کالاها و موجودی',
  subtitle: () => 'لیست کامل محصولات مغازه با قیمت خرید، فروش و موجودی',
  actions: () => `
    <button class="btn btn-primary" data-quick>فروش سریع</button>
    <button class="btn" data-go="bulk">ورود گروهی</button>
    <button class="btn" data-bump>افزایش گروهی قیمت</button>
    <button class="btn btn-primary" data-new>کالای جدید</button>`,

  render(ctx) {
    const { state, query } = ctx;
    const view = ctx.params.f || 'all';
    const isOut = (p) => num(p.stock) <= 0;
    const isLow = (p) => num(p.stock) <= num(p.min);
    const list = state.products
      .filter((p) => !query || normText(`${p.name || ''} ${p.sku || ''}`).includes(normText(query)))
      .filter((p) => (view === 'out' ? isOut(p) : view === 'low' ? isLow(p) : true))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'fa'));

    const rows = list.map((p) => {
      const out = num(p.stock) <= 0;
      const low = !out && num(p.stock) <= num(p.min);
      return {
        _id: p.id,
        name: `<b>${esc(p.name)}</b>${p.sku ? `<div class="tiny muted">${esc(p.sku)}</div>` : ''}`,
        buy: money(p.buy),
        sell: `<b class="nums">${money(p.sell)}</b>`,
        stock: `${faNum(num(p.stock))} ${esc(p.unit || '')} ${out ? chip('تمام شده', 'red') : low ? chip('کم', 'orange') : ''}`,
        actions: rowActions([
          { icon: icon('invoice'), title: 'فروش سریع', attrs: `data-sell="${p.id}"` },
          { icon: icon('edit'), title: 'ویرایش', attrs: `data-edit="${p.id}"` },
          { icon: icon('trash'), title: 'حذف', attrs: `data-del="${p.id}"`, danger: true },
        ]),
      };
    });

    const outList = state.products.filter(isOut);
    return `
      <div class="grid cols-4" style="margin-bottom:var(--sp-4)">
        ${stat({ label: 'تعداد کالا', value: faNum(state.products.length) })}
        ${stat({ label: 'ارزش انبار (قیمت خرید)', value: moneyShort(stockValue(state)), unit: 'تومان', tone: 'blue' })}
        ${stat({ label: 'رو به اتمام', value: faNum(lowStock(state).length), tone: lowStock(state).length ? 'orange' : '' })}
        ${stat({ label: 'تمام شده', value: faNum(outList.length), tone: outList.length ? 'red' : '' })}
      </div>
      ${tabs([
        { key: 'all', label: `همه کالاها (${faNum(state.products.length)})` },
        { key: 'low', label: `رو به اتمام (${faNum(lowStock(state).length)})` },
        { key: 'out', label: `تمام شده (${faNum(outList.length)})` },
      ], view, 'data-f')}
      <div style="height:var(--sp-3)"></div>
      ${card({
        tight: true,
        body: table([
          { key: 'name', label: 'کالا' },
          { key: 'sell', label: 'فروش', num: true },
          { key: 'buy', label: 'خرید', num: true },
          { key: 'stock', label: 'موجودی', num: true },
          { key: 'actions', label: '' },
        ], rows, { emptyState: empty('کالایی ثبت نشده', 'می‌توانید تکی یا گروهی (اکسل) کالا وارد کنید.', icon('box', 28), '<button class="btn btn-primary btn-sm" data-new>کالای جدید</button> <button class="btn btn-sm" data-go="bulk">ورود گروهی</button>') }),
      })}`;
  },

  mount(root, ctx) {
    root.addEventListener('click', async (e) => {
      if (e.target.closest('[data-new]')) return productForm(ctx);
      if (e.target.closest('[data-bump]')) return priceBumpForm(ctx);
      if (e.target.closest('[data-quick]')) return quickSaleForm(ctx);
      const tab = e.target.closest('[data-f]');
      if (tab) return ctx.setParams({ f: tab.dataset.f });
      const sell = e.target.closest('[data-sell]');
      if (sell) return quickSaleForm(ctx, ctx.state.products.find((p) => p.id === sell.dataset.sell));
      const edit = e.target.closest('[data-edit]');
      if (edit) return productForm(ctx, ctx.state.products.find((p) => p.id === edit.dataset.edit));
      const del = e.target.closest('[data-del]');
      if (del && await confirmDialog({ title: 'حذف کالا؟', message: 'این کالا از لیست حذف می‌شود.' })) {
        ctx.store.remove('product', del.dataset.del);
        toast('حذف شد');
      }
      return undefined;
    });
  },
};

// دکمه‌های سرصفحه خارج از view-root هستند؛ این دو را app.js مدیریت می‌کند.
products.headActions = { bump: priceBumpForm, create: productForm };
products.quickSale = quickSaleForm;

/* ============================== ورود گروهی ============================== */

const BULK_HEADER = 'نام کالا,قیمت فروش,قیمت خرید,موجودی';

/** جدا کردن سلولهای یک سطر با پشتیبانی از گیومه و ویرگول فارسی */
function splitRow(line) {
  const cells = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i += 1; } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',' || ch === '\t' || ch === ';' || ch === '\u060c' || ch === '\u061b') {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

const HEADER_WORDS = ['\u0646\u0627\u0645\u06a9\u0627\u0644\u0627', '\u0646\u0627\u0645', '\u06a9\u0627\u0644\u0627', '\u0634\u0631\u062d', '\u0645\u062d\u0635\u0648\u0644', '\u0646\u0627\u0645\u0645\u062d\u0635\u0648\u0644', 'name', 'productname', 'item', 'title'];

// سلول خالی undefined میماند تا با مقدار صفر اشتباه نشود
const cellText = (v) => (String(v ?? '').trim() === '' ? undefined : String(v).trim());
const cellNum = (v) => (String(v ?? '').trim() === '' ? undefined : num(v));

function isHeaderRow(cells) {
  const first = normText(cells[0] || '').replace(/\s/g, '');
  if (HEADER_WORDS.some((w) => first === normText(w).replace(/\s/g, ''))) return true;
  // اگر ستونهای قیمت متن غیرعددی دارند، این سطر عنوان است نه کالا
  const priced = [cells[1], cells[2]].filter((c) => String(c ?? '').trim() !== '');
  return priced.length > 0 && priced.every((c) => !/[0-9]/.test(enDigits(String(c))));
}

export function parseBulk(raw) {
  const lines = String(raw || '').replace(/^\ufeff/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const rows = lines.map(splitRow);
  if (isHeaderRow(rows[0])) rows.shift();
  return rows.map((cells) => ({
    name: cellText(cells[0]) || '',
    sell: cellNum(cells[1]),
    buy: cellNum(cells[2]),
    stock: cellNum(cells[3]),
  })).filter((p) => p.name);
}

export const bulk = {
  title: 'ورود گروهی کالا',
  subtitle: () => 'فقط نام، قیمت فروش و قیمت خرید — کد کالا خودکار ساخته می‌شود',
  actions: () => '<button class="btn" data-sample>دانلود فایل نمونه</button>',

  render(ctx) {
    return `
      ${banner(`فقط سه ستون لازم است: <b>نام کالا، قیمت فروش، قیمت خرید</b> (ستون چهارم «موجودی» اختیاری است). اگر قیمت خرید خالی بماند، خودکار ${faNum(num(ctx.state.settings.autoMargin))}٪ کمتر از قیمت فروش محاسبه می‌شود و کد کالا هم خودکار ساخته می‌شود.`, 'blue', icon('download', 20))}
      <div class="grid cols-sidebar" style="margin-top:var(--sp-4)">
        ${card({
          title: '۱) داده را وارد کنید',
          body: `<div class="field">
              <label class="lbl" for="bulk-file">فایل CSV یا اکسل (ذخیره‌شده به صورت CSV)</label>
              <input type="file" id="bulk-file" accept=".csv,.txt,text/csv,.xlsx,.xls" />
            </div>
            <div class="field">
              <label class="lbl" for="bulk-text">یا جدول را اینجا پیست کنید</label>
              <textarea id="bulk-text" rows="10" placeholder="دریل بتون‌کن کارتن,4000000,3200000,4"></textarea>
            </div>
            <label class="check"><input type="checkbox" id="bulk-merge" checked /> <span>اگر کالایی با همین نام وجود دارد، به‌روز شود</span></label>
            <div class="cluster" style="margin-top:var(--sp-4)">
              <button class="btn" id="bulk-preview">پیش‌نمایش</button>
              <button class="btn btn-primary" id="bulk-apply">ثبت کالاها</button>
            </div>`,
        })}
        ${card({ title: '۲) پیش‌نمایش', id: 'bulk-preview-box', body: empty('هنوز داده‌ای وارد نشده', 'پس از انتخاب فایل یا پیست، پیش‌نمایش را بزنید.', icon('upload', 28)) })}
      </div>`;
  },

  mount(root, ctx) {
    const textEl = () => $('#bulk-text', root);

    $('#bulk-file', root).addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      // xlsx درواقع یک zip است و متن خوانا ندارد
      const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
      if ((head[0] === 0x50 && head[1] === 0x4b) || /\.(xlsx|xls)$/i.test(file.name)) {
        toast('فایل اکسل مستقیم خوانده نمیشود. در اکسل Save As – CSV UTF-8 بگیرید یا سلولها را کپی و در کادر پیست کنید.', 'red');
        e.target.value = '';
        return;
      }
      textEl().value = (await file.text()).replace(/^\ufeff/, '');
      toast('فایل خوانده شد؛ پیش‌نمایش را بزنید.');
    });

    const preview = () => {
      const items = parseBulk(textEl().value);
      const box = $('#bulk-preview-box .card-body', root);
      box.innerHTML = items.length
        ? table([
          { key: 'name', label: 'کالا' },
          { key: 'sell', label: 'فروش', num: true },
          { key: 'buy', label: 'خرید', num: true },
          { key: 'stock', label: 'موجودی', num: true },
        ], items.map((p) => ({
          name: esc(p.name),
          sell: money(p.sell ?? 0),
          buy: money(p.buy ?? buyFromSell(p.sell ?? 0, ctx.state.settings.autoMargin)),
          stock: faNum(p.stock ?? 0),
        })))
        : empty('داده‌ای شناسایی نشد', 'قالب ستون‌ها را بررسی کنید.', icon('upload', 28));
      return items;
    };

    root.addEventListener('click', (e) => {
      if (e.target.closest('#bulk-preview')) { preview(); return; }

      if (e.target.closest('#bulk-apply')) {
        const items = preview();
        if (!items.length) { toast('داده‌ای برای ثبت نیست.', 'red'); return; }
        const merge = $('#bulk-merge', root).checked;
        const margin = num(ctx.state.settings.autoMargin);
        let skuSeed = Number(String(nextSku(ctx.state.products)).replace(/[^0-9]/g, ''));
        let added = 0;
        let updated = 0;
        items.forEach((p) => {
          const existing = merge && ctx.state.products.find((x) => normText(x.name) === normText(p.name));
          const sell = p.sell ?? (existing ? num(existing.sell) : 0);
          const buy = p.buy ?? (existing ? (num(existing.buy) || buyFromSell(sell, margin)) : buyFromSell(sell, margin));
          if (existing) {
            // فقط فیلدهای پرشده بازنویسی می‌شوند تا اطلاعات قبلی پاک نشود
            ctx.store.put('product', {
              ...existing,
              name: p.name || existing.name,
              sku: existing.sku || `K-${skuSeed + 1}`,
              buy,
              sell,
              stock: p.stock ?? num(existing.stock),
            });
            updated += 1;
          } else {
            ctx.store.put('product', {
              name: p.name,
              sku: `K-${skuSeed + 1}`,
              unit: UNITS[0],
              buy,
              sell,
              stock: p.stock ?? 0,
              min: 1,
              loc: '',
            });
            added += 1;
          }
          skuSeed += 1;
        });
        toast(`${faNum(added)} کالای جدید و ${faNum(updated)} به‌روزرسانی ثبت شد`, 'green');
        textEl().value = '';
        ctx.go('products');
        return;
      }

      if (e.target.closest('[data-sample]')) {
        // سطرها با خط جدید واقعی جدا می‌شوند، نه متن «\n»
        download('hesabyar-nemoone-kala.csv',
          [BULK_HEADER,
            'دریل بتون‌کن کارتن,4000000,3200000,4',
            'پیچ خودکار ۴۰میلی,60000,45000,30'].join('\n'),
          'text/csv;charset=utf-8');
      }
    });
  },
};

export const bulkHeader = BULK_HEADER;
void monthKey;
void productName;
