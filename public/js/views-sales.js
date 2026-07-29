/**
 * views-sales.js — داشبورد، فاکتورها، کالاها و ورود گروهی کالا.
 */

import {
  INVOICE_KINDS, PAY_METHODS, PRODUCT_CATS, UNITS,
  cashTotal, chequesDueSoon, currentMonthKey, esc, faNum, invoiceBalance, invoicePaid,
  invoiceProfit, invoiceStatus, invoiceSubtotal, invoiceTax, invoiceTotal, isoPlusDays,
  isoToJalali, jalaliLong, lastMonthKeys, lowStock, money, moneyShort, monthExpense,
  monthIncome, monthKey, monthKeyLabel, monthSalesProfit, num, payable, receivable,
  enDigits, normText, roundTo, stockValue, todayIso, toman, uniq,
} from './core.js';
import {
  $, $$, banner, card, chip, confirmDialog, dateField, download, empty, icon,
  number as numberField, openDrawer, rowActions, select, stat, table, text, textarea, toast,
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
    <button class="btn btn-primary" data-new-invoice>فاکتور جدید</button>`,

  render(ctx) {
    const { state } = ctx;
    const key = currentMonthKey();
    const months = lastMonthKeys(6);

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

    const maxBar = Math.max(1, ...months.flatMap((m) => [monthIncome(state, m), monthExpense(state, m)]));
    const chart = `<div class="chart" role="img" aria-label="نمودار درآمد و هزینه شش ماه اخیر">
      ${months.map((m) => {
        const inc = monthIncome(state, m);
        const exp = monthExpense(state, m);
        return `<div class="col">
          <div class="pair">
            <span class="b income" style="height:${(inc / maxBar) * 100}%" title="درآمد ${money(inc)}"></span>
            <span class="b expense" style="height:${(exp / maxBar) * 100}%" title="هزینه ${money(exp)}"></span>
          </div>
          <span class="cl">${esc(monthKeyLabel(m).split(' ')[0])}</span>
        </div>`;
      }).join('')}
    </div>
    <div class="cluster" style="margin-top:var(--sp-3)">${chip('درآمد', 'green')}${chip('هزینه', 'red')}</div>`;

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
      <div class="grid cols-4" style="margin:var(--sp-4) 0">
        ${stat({ label: `فروش ${monthKeyLabel(key)}`, value: moneyShort(monthIncome(state, key)), unit: 'تومان', tone: 'green', icon: icon('up') })}
        ${stat({ label: `هزینه ${monthKeyLabel(key)}`, value: moneyShort(monthExpense(state, key)), unit: 'تومان', tone: 'red', icon: icon('down') })}
        ${stat({ label: 'موجودی نقد و بانک', value: moneyShort(cashTotal(state)), unit: 'تومان', tone: 'blue', icon: icon('wallet') })}
        ${stat({ label: 'سود ناخالص ماه', value: moneyShort(monthSalesProfit(state, key)), unit: 'تومان', tone: 'orange', icon: icon('report') })}
      </div>
      <div class="grid cols-sidebar">
        ${card({ title: 'درآمد و هزینه شش ماه اخیر', body: chart })}
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
    const product = state.products.find((p) => p.name === desc);
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

function openInvoiceForm(ctx, invoice) {
  const { state, store } = ctx;
  const settings = state.settings;
  const inv = invoice || {
    no: nextInvoiceNo(state), kind: 'فروش', date: todayIso(), due: todayIso(),
    contactId: '', discount: 0, taxRate: 0, openingPaid: 0, items: [{}], note: '',
  };
  const isEdit = !!invoice;

  openDrawer({
    title: invoice ? `ویرایش فاکتور #${faNum(inv.no)}` : 'فاکتور جدید',
    wide: true,
    submitLabel: 'ذخیره فاکتور',
    body: `
      <datalist id="product-list">${state.products.map((p) => `<option value="${esc(p.name)}"></option>`).join('')}</datalist>
      ${isEdit ? `<div class="banner" data-tone="blue" style="margin-bottom:var(--sp-3)"><span class="ico" aria-hidden="true">${icon('info')}</span><div>در حالت ویرایش، موجودی کالاها دوباره تغییر نمی‌کند و پرداخت‌های ثبت‌شده حفظ می‌شود.</div></div>` : ''}
      <div class="form-grid">
        ${select('kind', 'نوع فاکتور', INVOICE_KINDS, inv.kind)}
        ${text('no', 'شماره فاکتور', inv.no)}
        ${select('contactId', 'طرف حساب', contactOptions(state), inv.contactId, { blank: 'مشتری متفرقه' })}
        ${dateField('date', 'تاریخ', inv.date)}
        ${dateField('due', 'مهلت پرداخت', inv.due || inv.date)}
        ${numberField('taxRate', 'درصد مالیات', inv.taxRate ?? settings.taxRate)}
      </div>

      <h4 style="margin:var(--sp-4) 0 var(--sp-2)">ردیف‌های کالا</h4>
      <div class="line-head">
        <span>کالا</span><span>تعداد</span><span>قیمت واحد</span><span>تخفیف</span><span></span>
      </div>
      <div id="items">${(inv.items?.length ? inv.items : [{}]).map(itemRowHtml).join('')}</div>
      <button type="button" class="btn btn-sm" id="add-item">افزودن ردیف</button>

      <div class="form-grid" style="margin-top:var(--sp-4)">
        ${numberField('discount', 'تخفیف کل (تومان)', inv.discount || '')}
        ${numberField('openingPaid', 'پرداخت همین الان (تومان)', inv.openingPaid || '')}
        ${select('payAccountId', 'واریز به حساب', accountOptions(state), state.accounts[0]?.id || '', { blank: '—' })}
        ${select('payMethod', 'روش پرداخت', PAY_METHODS, 'نقد')}
        ${textarea('note', 'توضیح', inv.note || '')}
      </div>

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

      const recalc = () => {
        const draft = {
          items: readItems(form, state),
          discount: num($('[name=discount]', form).value),
          taxRate: num($('[name=taxRate]', form).value),
        };
        const subtotal = invoiceSubtotal(draft);
        const tax = invoiceTax(draft);
        const total = invoiceTotal(draft);
        const paid = num($('[name=openingPaid]', form).value);
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

      // افزودن/به‌روزرسانی کالاها از فاکتور خرید
      if (isPurchase && values.addToProducts && !isEdit) {
        items.forEach((it) => {
          const existing = state.products.find((p) => p.name === it.desc);
          if (existing) {
            store.put('product', {
              ...existing,
              buy: it.price || num(existing.buy),
              sell: num(existing.sell) || roundTo(it.price * (1 + markup / 100)),
              stock: num(existing.stock) + it.qty,
            });
          } else {
            store.put('product', {
              name: it.desc, sku: '', brand: '', cat: PRODUCT_CATS[0], unit: UNITS[0], loc: '',
              buy: it.price, sell: roundTo(it.price * (1 + markup / 100)), stock: it.qty, min: 1,
            });
          }
        });
      }

      // کسر موجودی در فروش
      if ((values.kind === 'فروش' || values.kind === 'مرجوعی فروش') && !isEdit) {
        const sign = values.kind === 'فروش' ? -1 : 1;
        items.forEach((it) => {
          const product = state.products.find((p) => p.id === it.productId);
          if (product) store.put('product', { ...product, stock: num(product.stock) + sign * it.qty });
        });
      }

      const saved = store.put('invoice', {
        id: inv.id, no: values.no || nextInvoiceNo(state), kind: values.kind,
        date: values.date || todayIso(), due: values.due || values.date,
        contactId: values.contactId, discount: num(values.discount), taxRate: num(values.taxRate),
        // پرداخت‌های قبلی (تراکنش‌های مرتبط) حفظ می‌شود؛ openingPaid فقط برای صدور جدید است
        openingPaid: isEdit ? num(invoice.openingPaid) : 0, items, note: values.note,
      });

      const paid = num(values.openingPaid);
      if (paid > 0 && !isEdit) {
        // مرجوعی فروش یعنی برگشت وجه به مشتری (هزینه) و مرجوعی خرید یعنی بازپس‌گیری وجه (درآمد)
        const isExpense = values.kind === 'خرید' || values.kind === 'مرجوعی فروش';
        store.put('txn', {
          date: values.date || todayIso(),
          type: isExpense ? 'هزینه' : 'درآمد',
          cat: isPurchase ? 'خرید کالا' : 'فروش کالا',
          amount: paid, accountId: values.payAccountId, contactId: values.contactId,
          method: values.payMethod, note: `فاکتور #${saved.no}`, invoiceId: saved.id,
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
        no: `<span class="nums">#${faNum(inv.no || '')}</span>`,
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
      if (edit) return openInvoiceForm(ctx, ctx.state.invoices.find((i) => i.id === edit.dataset.edit));
      const print = e.target.closest('[data-print]');
      if (print) return printInvoice(ctx.state, ctx.state.invoices.find((i) => i.id === print.dataset.print));
      const del = e.target.closest('[data-del]');
      if (del && await confirmDialog({ title: 'حذف فاکتور؟', message: 'فاکتور حذف می‌شود؛ موجودی کالاها برنمی‌گردد.' })) {
        ctx.store.remove('invoice', del.dataset.del);
        toast('حذف شد');
      }
      return undefined;
    });
  },
};

/* ================================= کالاها ================================= */

function productForm(ctx, product) {
  const { state, store } = ctx;
  const p = product || { name: '', sku: '', brand: '', cat: PRODUCT_CATS[0], unit: UNITS[0], loc: '', buy: '', sell: '', stock: 0, min: 1 };

  openDrawer({
    title: product ? 'ویرایش کالا' : 'کالای جدید',
    body: `<div class="form-grid">
      ${text('name', 'نام کالا', p.name, { span: true })}
      ${text('sku', 'کد کالا', p.sku)}
      ${text('brand', 'برند', p.brand)}
      ${select('cat', 'دسته', PRODUCT_CATS, p.cat)}
      ${select('unit', 'واحد', UNITS, p.unit)}
      ${numberField('buy', 'قیمت خرید (تومان)', p.buy)}
      ${numberField('sell', 'قیمت فروش (تومان)', p.sell, { hint: `خالی بماند: خودکار ${faNum(state.settings.autoMargin)}٪ سود` })}
      ${numberField('stock', 'موجودی', p.stock)}
      ${numberField('min', 'حداقل موجودی', p.min)}
      ${text('loc', 'محل نگهداری', p.loc)}
    </div>`,
    onMount(form) {
      const buyEl = $('[name=buy]', form);
      const sellEl = $('[name=sell]', form);
      buyEl.addEventListener('input', () => {
        if (!num(sellEl.value)) sellEl.placeholder = String(roundTo(num(buyEl.value) * (1 + num(state.settings.autoMargin) / 100)));
      });
    },
    onSubmit(values) {
      if (!values.name) { toast('نام کالا الزامی است.', 'red'); return false; }
      const buy = num(values.buy);
      const sell = num(values.sell) || roundTo(buy * (1 + num(state.settings.autoMargin) / 100));
      store.put('product', { id: p.id, ...values, buy, sell, stock: num(values.stock), min: num(values.min) });
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
        ${select('cat', 'فقط دسته', PRODUCT_CATS, '', { blank: 'همه دسته‌ها' })}
        ${select('round', 'گرد کردن به', [{ v: '1', t: 'بدون گرد کردن' }, { v: '1000', t: 'هزار تومان' }, { v: '5000', t: '۵ هزار تومان' }], '1000')}
      </div>
      <label class="check"><input type="checkbox" name="alsoBuy" /> <span>قیمت خرید هم افزایش پیدا کند</span></label>`,
    onSubmit(values) {
      const percent = num(values.percent);
      if (!percent) { toast('درصد را وارد کنید.', 'red'); return false; }
      const step = num(values.round) || 1;
      const targets = state.products.filter((p) => !values.cat || p.cat === values.cat);
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

export const products = {
  title: 'کالاها و موجودی',
  subtitle: () => 'لیست کامل محصولات مغازه با قیمت خرید، فروش و موجودی',
  actions: () => `
    <button class="btn" data-go="bulk">ورود گروهی</button>
    <button class="btn" data-bump>افزایش گروهی قیمت</button>
    <button class="btn btn-primary" data-new>کالای جدید</button>`,

  render(ctx) {
    const { state, query } = ctx;
    const cat = ctx.params.cat || 'همه';
    const list = state.products
      .filter((p) => cat === 'همه' || p.cat === cat)
      .filter((p) => !query || normText(`${p.name || ''} ${p.sku || ''} ${p.brand || ''}`).includes(normText(query)))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'fa'));

    const rows = list.map((p) => {
      const low = num(p.stock) <= num(p.min);
      return {
        _id: p.id,
        name: `<b>${esc(p.name)}</b>${p.brand || p.sku ? `<div class="tiny muted">${esc([p.brand, p.sku].filter(Boolean).join(' • '))}</div>` : ''}`,
        cat: esc(p.cat || '—'),
        buy: money(p.buy),
        sell: `<b class="nums">${money(p.sell)}</b>`,
        stock: `${faNum(num(p.stock))} ${esc(p.unit || '')} ${low ? chip('کم', 'red') : ''}`,
        actions: rowActions([
          { icon: icon('edit'), title: 'ویرایش', attrs: `data-edit="${p.id}"` },
          { icon: icon('trash'), title: 'حذف', attrs: `data-del="${p.id}"`, danger: true },
        ]),
      };
    });

    const cats = ['همه', ...uniq(state.products.map((p) => p.cat))];

    return `
      <div class="grid cols-3" style="margin-bottom:var(--sp-4)">
        ${stat({ label: 'تعداد کالا', value: faNum(state.products.length) })}
        ${stat({ label: 'ارزش انبار (قیمت خرید)', value: moneyShort(stockValue(state)), unit: 'تومان', tone: 'blue' })}
        ${stat({ label: 'کالای رو به اتمام', value: faNum(lowStock(state).length), tone: lowStock(state).length ? 'red' : '' })}
      </div>
      <div class="cluster" style="margin-bottom:var(--sp-4)">
        ${cats.map((c) => `<button class="chip" data-cat="${esc(c)}"${c === cat ? ' data-tone="blue"' : ''}>${esc(c)}</button>`).join('')}
      </div>
      ${card({
        tight: true,
        body: table([
          { key: 'name', label: 'کالا' },
          { key: 'cat', label: 'دسته' },
          { key: 'buy', label: 'خرید', num: true },
          { key: 'sell', label: 'فروش', num: true },
          { key: 'stock', label: 'موجودی', num: true },
          { key: 'actions', label: '' },
        ], rows, { emptyState: empty('کالایی ثبت نشده', 'می‌توانید تکی یا گروهی (اکسل) کالا وارد کنید.', icon('box', 28), '<button class="btn btn-primary btn-sm" data-new>کالای جدید</button> <button class="btn btn-sm" data-go="bulk">ورود گروهی</button>') }),
      })}`;
  },

  mount(root, ctx) {
    root.addEventListener('click', async (e) => {
      if (e.target.closest('[data-new]')) return productForm(ctx);
      if (e.target.closest('[data-bump]')) return priceBumpForm(ctx);
      const c = e.target.closest('[data-cat]');
      if (c) return ctx.setParams({ cat: c.dataset.cat });
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

/* ============================== ورود گروهی ============================== */

const BULK_HEADER = 'نام کالا,کد,دسته,واحد,قیمت خرید,قیمت فروش,موجودی,حداقل';

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
  const priced = [cells[4], cells[5]].filter((c) => String(c ?? '').trim() !== '');
  return priced.length > 0 && priced.every((c) => !/[0-9]/.test(enDigits(String(c))));
}

export function parseBulk(raw) {
  const lines = String(raw || '').replace(/^\ufeff/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const rows = lines.map(splitRow);
  if (isHeaderRow(rows[0])) rows.shift();
  return rows.map((cells) => ({
    name: cellText(cells[0]) || '',
    sku: cellText(cells[1]),
    cat: cellText(cells[2]),
    unit: cellText(cells[3]),
    buy: cellNum(cells[4]),
    sell: cellNum(cells[5]),
    stock: cellNum(cells[6]),
    min: cellNum(cells[7]),
  })).filter((p) => p.name);
}

export const bulk = {
  title: 'ورود گروهی کالا',
  subtitle: () => 'افزودن ده‌ها کالا با فایل اکسل/CSV یا کپی از جدول',
  actions: () => '<button class="btn" data-sample>دانلود فایل نمونه</button>',

  render(ctx) {
    return `
      ${banner('ستون‌ها به ترتیب: <b>نام کالا، کد، دسته، واحد، قیمت خرید، قیمت فروش، موجودی، حداقل</b>. در اکسل می‌توانید سلول‌ها را کپی کنید و مستقیم در کادر پایین Paste کنید.', 'blue', icon('download', 20))}
      <div class="grid cols-sidebar" style="margin-top:var(--sp-4)">
        ${card({
          title: '۱) داده را وارد کنید',
          body: `<div class="field">
              <label class="lbl" for="bulk-file">فایل CSV یا اکسل (ذخیره‌شده به صورت CSV)</label>
              <input type="file" id="bulk-file" accept=".csv,.txt,text/csv,.xlsx,.xls" />
            </div>
            <div class="field">
              <label class="lbl" for="bulk-text">یا جدول را اینجا پیست کنید</label>
              <textarea id="bulk-text" rows="10" placeholder="دریل بتون‌کن کارتن,DR-100,ابزار برقی,عدد,3200000,4000000,4,1"></textarea>
            </div>
            <label class="check"><input type="checkbox" id="bulk-merge" checked /> <span>اگر کالایی با همین نام/کد وجود دارد، به‌روز شود</span></label>
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
          { key: 'cat', label: 'دسته' },
          { key: 'buy', label: 'خرید', num: true },
          { key: 'sell', label: 'فروش', num: true },
          { key: 'stock', label: 'موجودی', num: true },
        ], items.map((p) => ({
          name: esc(p.name), cat: esc(p.cat || PRODUCT_CATS[0]), buy: money(p.buy ?? 0),
          sell: money(p.sell ?? roundTo((p.buy ?? 0) * (1 + num(ctx.state.settings.autoMargin) / 100))),
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
        let added = 0;
        let updated = 0;
        items.forEach((p) => {
          const existing = merge && ctx.state.products.find((x) => normText(x.name) === normText(p.name)
            || (p.sku && x.sku && normText(x.sku) === normText(p.sku)));
          const buy = p.buy ?? (existing ? num(existing.buy) : 0);
          const sell = p.sell ?? (existing ? (num(existing.sell) || roundTo(buy * (1 + margin / 100)))
            : roundTo(buy * (1 + margin / 100)));
          if (existing) {
            // فقط فیلدهای پرشده بازنویسی می‌شوند تا اطلاعات قبلی پاک نشود
            ctx.store.put('product', {
              ...existing,
              name: p.name || existing.name,
              sku: p.sku ?? existing.sku,
              cat: p.cat ?? existing.cat,
              unit: p.unit ?? existing.unit,
              buy,
              sell,
              stock: p.stock ?? num(existing.stock),
              min: p.min ?? num(existing.min),
            });
            updated += 1;
          } else {
            ctx.store.put('product', {
              name: p.name,
              sku: p.sku || '',
              cat: p.cat || PRODUCT_CATS[0],
              unit: p.unit || UNITS[0],
              buy,
              sell,
              stock: p.stock ?? 0,
              min: p.min ?? 1,
              brand: '',
              loc: '',
            });
            added += 1;
          }
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
            'دریل بتون‌کن کارتن,DR-100,ابزار برقی,عدد,3200000,4000000,4,1',
            'پیچ خودکار ۴۰میلی,SC-40,پیچ و مهره,بسته,45000,60000,30,5'].join('\n'),
          'text/csv;charset=utf-8');
      }
    });
  },
};

export const bulkHeader = BULK_HEADER;
void monthKey;
void productName;
