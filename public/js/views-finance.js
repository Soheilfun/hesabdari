/**
 * views-finance.js — درآمد/هزینه، حساب‌ها، طرف حساب‌ها، چک‌ها،
 * بودجه، اسناد، گزارش‌ها و تنظیمات.
 */

import {
  ACCOUNT_TYPES, CHEQUE_KINDS, CHEQUE_STATUS, CONTACT_ROLES, DOC_TYPES,
  EXPENSE_CATS, INCOME_CATS, MONTHS, PAY_METHODS,
  accountBalance, cashTotal, currentMonthKey, esc, faNum, invoiceBalance, invoiceProfit,
  isoPlusDays, isoToJalali, lastMonthKeys, money, moneyShort, monthExpense, monthIncome,
  monthKey, monthKeyLabel, monthSalesProfit, monthTxns, num, openCheques, payable,
  normText, receivable, stockValue, todayIso, toman, uniq,
  CAT_COLLECT, CAT_PAY_DEBT, contactBalance, contactCheques, contactInvoices,
  contactOpenInvoices, contactTxns, invoiceStatus, invoiceTotal, sum,
} from './core.js';
import {
  $, banner, card, chip, confirmDialog, dateField, download, empty, icon,
  number as numberField, openDrawer, rowActions, select, stat, table, text, textarea, toast,
} from './ui.js';
import { api, auth, store as dataStore } from './data.js';

const contactOptions = (state) => state.contacts.map((c) => ({ v: c.id, t: c.name }));
const accountOptions = (state) => state.accounts.map((a) => ({ v: a.id, t: a.name }));
const contactName = (state, id) => state.contacts.find((c) => c.id === id)?.name || '—';
const accountName = (state, id) => state.accounts.find((a) => a.id === id)?.name || '—';

/** ایمن‌سازی مقدار برای CSV (کاما، گیومه و خط جدید) */
const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/* ========================= درآمد و هزینه ========================= */

function txnForm(ctx, txn, preset = {}) {
  const { state, store } = ctx;
  const t = txn || { date: todayIso(), type: preset.type || 'هزینه', cat: '', amount: '', accountId: state.accounts[0]?.id || '', toAccountId: '', contactId: '', method: 'نقد', note: '' };
  const catsFor = (type) => (type === 'درآمد' ? INCOME_CATS : EXPENSE_CATS);

  openDrawer({
    title: txn ? 'ویرایش تراکنش' : 'ثبت تراکنش',
    body: `<div class="form-grid">
      ${select('type', 'نوع', ['هزینه', 'درآمد', 'انتقال'], t.type)}
      ${dateField('date', 'تاریخ', t.date)}
      ${select('cat', 'دسته', catsFor(t.type), t.cat, { blank: '—' })}
      ${numberField('amount', 'مبلغ (تومان)', t.amount)}
      ${select('accountId', 'از حساب / به حساب', accountOptions(state), t.accountId, { blank: '—' })}
      ${select('toAccountId', 'حساب مقصد (فقط انتقال)', accountOptions(state), t.toAccountId, { blank: '—' })}
      ${select('contactId', 'طرف حساب', contactOptions(state), t.contactId, { blank: '—' })}
      ${select('method', 'روش پرداخت', PAY_METHODS, t.method)}
      ${textarea('note', 'توضیح', t.note || '')}
    </div>`,
    onMount(form) {
      const typeEl = $('[name=type]', form);
      const catEl = $('[name=cat]', form);
      typeEl.addEventListener('change', () => {
        const options = typeEl.value === 'انتقال' ? [] : catsFor(typeEl.value);
        catEl.innerHTML = `<option value="">—</option>${options.map((c) => `<option>${esc(c)}</option>`).join('')}`;
      });
    },
    onSubmit(values) {
      if (num(values.amount) <= 0) { toast('مبلغ را وارد کنید.', 'red'); return false; }
      store.put('txn', {
        id: t.id, date: values.date || todayIso(), type: values.type, cat: values.cat,
        amount: num(values.amount), accountId: values.accountId, toAccountId: values.toAccountId,
        contactId: values.contactId, method: values.method, note: values.note, invoiceId: t.invoiceId || '',
        accrual: !!t.accrual, settle: !!t.settle,
      });
      toast('تراکنش ذخیره شد', 'green');
      ctx.refresh();
      return true;
    },
  });
}

export const money_ = {
  title: 'درآمد و هزینه',
  subtitle: () => 'دفتر روزانه دخل و خرج مغازه',
  actions: () => `
    <button class="btn" data-new="درآمد">ثبت درآمد</button>
    <button class="btn btn-primary" data-new="هزینه">ثبت هزینه</button>`,

  render(ctx) {
    const { state, query } = ctx;
    const key = ctx.params.month || currentMonthKey();
    const months = lastMonthKeys(12);
    const list = state.txns
      .filter((t) => monthKey(t.date) === key)
      .filter((t) => !query || normText(`${t.cat || ''} ${t.note || ''} ${contactName(state, t.contactId)}`).includes(normText(query)))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    const rows = list.map((t) => ({
      _id: t.id,
      date: isoToJalali(t.date),
      type: `${chip(t.type, t.type === 'درآمد' ? 'green' : t.type === 'هزینه' ? 'red' : 'blue')}${t.accrual ? ` ${chip('نسیه', 'orange')}` : ''}${t.settle ? ` ${chip('تسویه', 'blue')}` : ''}`,
      cat: esc(t.cat || '—'),
      party: esc(contactName(state, t.contactId)),
      account: t.accrual ? '<span class="muted">—</span>' : esc(accountName(state, t.accountId) + (t.toAccountId ? ` ← ${accountName(state, t.toAccountId)}` : '')),
      amount: money(t.amount),
      actions: rowActions([
        { icon: icon('edit'), title: 'ویرایش', attrs: `data-edit="${t.id}"` },
        { icon: icon('trash'), title: 'حذف', attrs: `data-del="${t.id}"`, danger: true },
      ]),
    }));

    const income = monthIncome(state, key);
    const expense = monthExpense(state, key);
    const salesIncome = sum(monthTxns(state, key).filter((t) => t.type === 'درآمد' && !t.settle && t.cat === 'فروش کالا'), (t) => t.amount);
    const creditPart = sum(monthTxns(state, key).filter((t) => t.accrual && t.type === 'درآمد'), (t) => t.amount);

    return `
      ${banner('فروش کالاها خودکار در همین دفتر ثبت می‌شود؛ فروش نسیه با برچسب «نسیه» می‌آید و روی موجودی صندوق اثر ندارد. وقتی مشتری تسویه کند، با برچسب «تسویه» ثبت می‌شود و دوباره درآمد حساب نمی‌شود.', 'blue', icon('info'))}
      <div class="grid cols-4" style="margin:var(--sp-4) 0">
        ${stat({ label: `درآمد ${monthKeyLabel(key)}`, value: moneyShort(income), unit: 'تومان', tone: 'green' })}
        ${stat({ label: `هزینه ${monthKeyLabel(key)}`, value: moneyShort(expense), unit: 'تومان', tone: 'red' })}
        ${stat({ label: 'خالص ماه', value: moneyShort(income - expense), unit: 'تومان', tone: income - expense >= 0 ? 'blue' : 'orange' })}
        ${stat({ label: 'فروش کالا در این ماه', value: moneyShort(salesIncome), unit: 'تومان', tone: 'blue', hint: creditPart ? `شامل ${money(creditPart)} نسیه` : '' })}
      </div>
      <div class="field" style="max-width:260px">
        <label class="lbl" for="month-pick">ماه</label>
        <div class="select-wrap"><select id="month-pick">${months.map((m) => `<option value="${m}"${m === key ? ' selected' : ''}>${esc(monthKeyLabel(m))}</option>`).join('')}</select></div>
      </div>
      ${card({
        body: table([
          { key: 'date', label: 'تاریخ' },
          { key: 'type', label: 'نوع' },
          { key: 'cat', label: 'دسته' },
          { key: 'party', label: 'طرف حساب' },
          { key: 'account', label: 'حساب' },
          { key: 'amount', label: 'مبلغ', num: true },
          { key: 'actions', label: '' },
        ], rows, { emptyState: empty('در این ماه تراکنشی ثبت نشده', 'اولین درآمد یا هزینه را ثبت کنید.', icon('swap', 28)) }),
        tight: true,
      })}`;
  },

  mount(root, ctx) {
    root.addEventListener('change', (e) => {
      if (e.target.id === 'month-pick') ctx.setParams({ month: e.target.value });
    });
    root.addEventListener('click', async (e) => {
      const add = e.target.closest('[data-new]');
      if (add) return txnForm(ctx, null, { type: add.dataset.new });
      const edit = e.target.closest('[data-edit]');
      if (edit) return txnForm(ctx, ctx.state.txns.find((t) => t.id === edit.dataset.edit));
      const del = e.target.closest('[data-del]');
      if (del && await confirmDialog({ title: 'حذف تراکنش؟', message: 'این تراکنش از همه دستگاه‌ها حذف می‌شود.' })) {
        ctx.store.remove('txn', del.dataset.del);
        toast('حذف شد');
      }
      return undefined;
    });
  },
};

/* ============================== حساب‌ها ============================== */

function accountForm(ctx, account) {
  const a = account || { name: '', type: 'صندوق مغازه', opening: 0, note: '' };
  openDrawer({
    title: account ? 'ویرایش حساب' : 'حساب جدید',
    body: `<div class="form-grid">
      ${text('name', 'نام حساب', a.name, { span: true })}
      ${select('type', 'نوع', ACCOUNT_TYPES, a.type)}
      ${numberField('opening', 'مانده اولیه (تومان)', a.opening)}
      ${textarea('note', 'توضیح', a.note || '')}
    </div>`,
    onSubmit(values) {
      if (!values.name) { toast('نام حساب الزامی است.', 'red'); return false; }
      ctx.store.put('account', { id: a.id, name: values.name, type: values.type, opening: num(values.opening), note: values.note });
      toast('حساب ذخیره شد', 'green');
      ctx.refresh();
      return true;
    },
  });
}

export const accounts = {
  title: 'حساب‌ها و موجودی',
  subtitle: () => 'صندوق مغازه، حساب بانکی و کیف پول',
  actions: () => '<button class="btn btn-primary" data-new>حساب جدید</button>',

  render(ctx) {
    const { state } = ctx;
    const rows = state.accounts.map((a) => ({
      _id: a.id,
      name: `<b>${esc(a.name)}</b>${a.note ? `<div class="tiny muted">${esc(a.note)}</div>` : ''}`,
      type: esc(a.type),
      opening: money(a.opening),
      balance: `<b class="nums">${money(accountBalance(a.id, state))}</b>`,
      actions: rowActions([
        { icon: icon('edit'), title: 'ویرایش', attrs: `data-edit="${a.id}"` },
        { icon: icon('trash'), title: 'حذف', attrs: `data-del="${a.id}"`, danger: true },
      ]),
    }));

    return `
      <div class="grid cols-2" style="margin-bottom:var(--sp-4)">
        ${stat({ label: 'جمع موجودی نقد و بانک', value: money(cashTotal(state)), unit: 'تومان', tone: 'blue' })}
        ${stat({ label: 'دارایی کل (نقد + انبار + طلب)', value: moneyShort(cashTotal(state) + stockValue(state) + receivable(state)), unit: 'تومان', tone: 'green' })}
      </div>
      ${card({
        body: table([
          { key: 'name', label: 'حساب' },
          { key: 'type', label: 'نوع' },
          { key: 'opening', label: 'مانده اولیه', num: true },
          { key: 'balance', label: 'مانده فعلی', num: true },
          { key: 'actions', label: '' },
        ], rows, { emptyState: empty('حسابی ثبت نشده', 'مثلاً «صندوق مغازه» و «حساب بانک ملت».', icon('wallet', 28), '<button class="btn btn-primary btn-sm" data-new>حساب جدید</button>') }),
        tight: true,
      })}`;
  },

  mount(root, ctx) {
    root.addEventListener('click', async (e) => {
      if (e.target.closest('[data-new]')) return accountForm(ctx);
      const edit = e.target.closest('[data-edit]');
      if (edit) return accountForm(ctx, ctx.state.accounts.find((a) => a.id === edit.dataset.edit));
      const del = e.target.closest('[data-del]');
      if (del && await confirmDialog({ title: 'حذف حساب؟', message: 'تراکنش‌های ثبت‌شده باقی می‌مانند ولی بدون حساب نمایش داده می‌شوند.' })) {
        ctx.store.remove('account', del.dataset.del);
        toast('حذف شد');
      }
      return undefined;
    });
  },
};

/* ============================ طرف حساب‌ها ============================ */

function contactForm(ctx, contact) {
  const c = contact || { name: '', role: 'مشتری', phone: '', nid: '', address: '', note: '' };
  openDrawer({
    title: contact ? 'ویرایش طرف حساب' : 'طرف حساب جدید',
    body: `<div class="form-grid">
      ${text('name', 'نام', c.name)}
      ${select('role', 'نوع', CONTACT_ROLES, c.role)}
      ${text('phone', 'تلفن', c.phone)}
      ${text('nid', 'کد ملی / اقتصادی', c.nid)}
      ${text('address', 'آدرس', c.address, { span: true })}
      ${textarea('note', 'توضیح', c.note || '')}
    </div>`,
    onSubmit(values) {
      if (!values.name) { toast('نام الزامی است.', 'red'); return false; }
      ctx.store.put('contact', { id: c.id, ...values });
      toast('ذخیره شد', 'green');
      ctx.refresh();
      return true;
    },
  });
}

const settleAccounts = (state) => state.accounts.map((a) => ({ v: a.id, t: a.name }));

/** تسویه یا پرداخت با یک طرف حساب؛ مبلغ به قدیمی‌ترین فاکتورهای باز تخصیص می‌یابد */
function contactSettleForm(ctx, contact) {
  if (!contact) return;
  const { state, store } = ctx;
  const balance = contactBalance(state, contact.id);
  const owesUs = balance > 0;
  const open = contactOpenInvoices(state, contact.id, owesUs ? 1 : -1);

  openDrawer({
    title: `تسویه با ${contact.name}`,
    submitLabel: 'ثبت تسویه',
    body: `
      ${banner(balance === 0
        ? 'حساب این شخص تسویه است؛ مبلغ ثبت‌شده به عنوان علی‌الحساب ذخیره می‌شود.'
        : `مانده حساب: <b>${money(Math.abs(balance))} تومان</b> — ${owesUs ? 'او به ما بدهکار است' : 'ما به او بدهکار هستیم'}`,
        owesUs ? 'green' : 'orange', icon('wallet'))}
      <div class="form-grid" style="margin-top:var(--sp-3)">
        ${select('dir', 'نوع عملیات', ['دریافت از این شخص', 'پرداخت به این شخص'], owesUs ? 'دریافت از این شخص' : 'پرداخت به این شخص', { span: true })}
        ${numberField('amount', 'مبلغ (تومان)', Math.abs(balance) || '')}
        ${dateField('date', 'تاریخ', todayIso())}
        ${select('accountId', 'صندوق / حساب', settleAccounts(state), state.accounts[0]?.id || '', { blank: '—' })}
        ${select('method', 'روش', PAY_METHODS.filter((m) => m !== 'اعتباری'), 'نقد')}
        ${textarea('note', 'توضیح', '')}
      </div>
      ${open.length ? `<h4 style="margin:var(--sp-4) 0 var(--sp-2)">فاکتورهای باز</h4>${table([
        { key: 'no', label: 'فاکتور' },
        { key: 'date', label: 'تاریخ' },
        { key: 'total', label: 'مبلغ', num: true },
        { key: 'balance', label: 'مانده', num: true },
      ], open.map((i) => ({
        no: `<span class="nums">#${faNum(i.no || '')}</span> ${esc(i.kind)}`,
        date: isoToJalali(i.date),
        total: money(invoiceTotal(i)),
        balance: `<b class="nums">${money(invoiceBalance(i, state.txns))}</b>`,
      })))}<p class="small muted">مبلغ واردشده از قدیمی‌ترین فاکتور باز به بعد تسویه می‌شود و باقیمانده علی‌الحساب ثبت می‌شود.</p>` : ''}`,

    onSubmit(values) {
      const amount = num(values.amount);
      if (amount <= 0) { toast('مبلغ را وارد کنید.', 'red'); return false; }
      const receive = values.dir === 'دریافت از این شخص';
      const date = values.date || todayIso();
      const targets = contactOpenInvoices(state, contact.id, receive ? 1 : -1);
      let left = amount;
      let touched = 0;
      targets.forEach((inv) => {
        if (left <= 0) return;
        const part = Math.min(left, invoiceBalance(inv, state.txns));
        if (part <= 0) return;
        left -= part;
        touched += 1;
        store.put('txn', {
          date,
          type: receive ? 'درآمد' : 'هزینه',
          cat: receive ? CAT_COLLECT : CAT_PAY_DEBT,
          amount: part, accountId: values.accountId, contactId: contact.id,
          method: values.method || 'نقد',
          note: `تسویه فاکتور #${inv.no || ''}${values.note ? ` — ${values.note}` : ''}`,
          invoiceId: inv.id, settle: true,
        });
      });
      if (left > 0) {
        store.put('txn', {
          date,
          type: receive ? 'درآمد' : 'هزینه',
          cat: receive ? CAT_COLLECT : CAT_PAY_DEBT,
          amount: left, accountId: values.accountId, contactId: contact.id,
          method: values.method || 'نقد',
          note: `${receive ? 'دریافت' : 'پرداخت'} علی‌الحساب${values.note ? ` — ${values.note}` : ''}`,
          invoiceId: '', settle: true,
        });
      }
      toast(touched ? `${faNum(touched)} فاکتور تسویه شد` : 'مبلغ علی‌الحساب ثبت شد', 'green');
      ctx.refresh();
      return true;
    },
  });
}

/** پروندهٔ کامل یک طرف حساب: فاکتورها، پرداخت‌ها، تراکنش‌ها و چک‌ها */
function contactSheet(ctx, contact) {
  if (!contact) return;
  const { state } = ctx;
  const balance = contactBalance(state, contact.id);
  const invs = contactInvoices(state, contact.id).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const txns = contactTxns(state, contact.id).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const chqs = contactCheques(state, contact.id);
  const bought = sum(invs.filter((i) => i.kind === 'فروش'), (i) => invoiceTotal(i));
  const received = sum(txns.filter((t) => t.type === 'درآمد' && !t.accrual), (t) => t.amount);
  const paidOut = sum(txns.filter((t) => t.type === 'هزینه' && !t.accrual), (t) => t.amount);

  openDrawer({
    title: contact.name,
    wide: true,
    extraActions: '<button type="button" class="btn btn-primary btn-sm" data-sheet-settle>تسویه / پرداخت</button><button type="button" class="btn btn-sm" data-sheet-edit>ویرایش اطلاعات</button>',
    body: `
      <div class="grid cols-4">
        ${stat({
          label: 'مانده حساب', value: money(Math.abs(balance)), unit: 'تومان',
          tone: balance > 0 ? 'green' : (balance < 0 ? 'red' : ''),
          hint: balance === 0 ? 'تسویه' : (balance > 0 ? 'او به ما بدهکار است' : 'ما به او بدهکاریم'),
        })}
        ${stat({ label: 'جمع فاکتورهای فروش', value: moneyShort(bought), unit: 'تومان', tone: 'blue' })}
        ${stat({ label: 'جمع دریافت از او', value: moneyShort(received), unit: 'تومان', tone: 'green' })}
        ${stat({ label: 'جمع پرداخت به او', value: moneyShort(paidOut), unit: 'تومان', tone: 'orange' })}
      </div>
      <p class="small muted" style="margin-top:var(--sp-3)">${esc(contact.role || '')}${contact.phone ? ` — تلفن: ${esc(contact.phone)}` : ''}${contact.address ? ` — ${esc(contact.address)}` : ''}${contact.nid ? ` — کد: ${esc(contact.nid)}` : ''}</p>

      <h4 style="margin:var(--sp-4) 0 var(--sp-2)">فاکتورها</h4>
      ${table([
        { key: 'no', label: 'شماره' },
        { key: 'kind', label: 'نوع' },
        { key: 'date', label: 'تاریخ' },
        { key: 'total', label: 'مبلغ', num: true },
        { key: 'balance', label: 'مانده', num: true },
        { key: 'status', label: 'وضعیت' },
      ], invs.map((i) => {
        const st = invoiceStatus(i, state.txns);
        return {
          no: `<span class="nums">#${faNum(i.no || '')}</span>`,
          kind: esc(i.kind),
          date: isoToJalali(i.date),
          total: money(invoiceTotal(i)),
          balance: money(invoiceBalance(i, state.txns)),
          status: chip(st.label, st.tone === 'neutral' ? '' : st.tone),
        };
      }), { emptyState: empty('فاکتوری برای این شخص ثبت نشده', '', icon('invoice', 28)) })}

      <h4 style="margin:var(--sp-4) 0 var(--sp-2)">پرداخت‌ها و تراکنش‌ها</h4>
      ${table([
        { key: 'date', label: 'تاریخ' },
        { key: 'type', label: 'نوع' },
        { key: 'cat', label: 'دسته' },
        { key: 'method', label: 'روش' },
        { key: 'amount', label: 'مبلغ', num: true },
        { key: 'note', label: 'شرح' },
      ], txns.map((t) => ({
        date: isoToJalali(t.date),
        type: chip(t.type, t.type === 'درآمد' ? 'green' : (t.type === 'هزینه' ? 'red' : 'blue')),
        cat: esc(t.cat || '—'),
        method: `${esc(t.method || '—')}${t.accrual ? ` ${chip('نسیه', 'orange')}` : ''}${t.settle ? ` ${chip('تسویه', 'blue')}` : ''}`,
        amount: money(t.amount),
        note: esc(t.note || ''),
      })), { emptyState: empty('تراکنشی برای این شخص ثبت نشده', '', icon('swap', 28)) })}

      ${chqs.length ? `<h4 style="margin:var(--sp-4) 0 var(--sp-2)">چک‌ها</h4>${table([
        { key: 'no', label: 'شماره' },
        { key: 'bank', label: 'بانک' },
        { key: 'due', label: 'سررسید' },
        { key: 'amount', label: 'مبلغ', num: true },
        { key: 'status', label: 'وضعیت' },
      ], chqs.map((c) => ({
        no: `<span class="nums">${esc(c.no || '—')}</span>`,
        bank: esc(c.bank || '—'),
        due: isoToJalali(c.due),
        amount: money(c.amount),
        status: chip(c.status, c.status === 'پاس شده' ? 'green' : (c.status === 'برگشتی' ? 'red' : 'blue')),
      })))}` : ''}`,

    onMount(form, api2) {
      const drawer = form.closest('.drawer');
      if (!drawer) return;
      drawer.addEventListener('click', (e) => {
        if (e.target.closest('[data-sheet-settle]')) { api2.close(); contactSettleForm(ctx, contact); }
        if (e.target.closest('[data-sheet-edit]')) { api2.close(); contactForm(ctx, contact); }
      });
    },
  });
}

export const contacts = {

  title: 'مشتریان و تأمین‌کنندگان',
  subtitle: () => 'دفترچه طرف حساب‌ها با مانده حساب',
  actions: () => '<button class="btn btn-primary" data-new>طرف حساب جدید</button>',

  render(ctx) {
    const { state, query } = ctx;
    const list = state.contacts.filter((c) => !query
      || normText(`${c.name || ''} ${c.phone || ''} ${c.role || ''}`).includes(normText(query)));

    // مانده = فاکتورهای باز + دریافت/پرداخت علی‌الحساب (مثبت: او به ما بدهکار است)
    const balanceOf = (id) => contactBalance(state, id);

    const rows = list.map((c) => {
      const balance = balanceOf(c.id);
      return {
        _id: c.id,
        name: `<button type="button" class="link-btn" data-view="${c.id}">${esc(c.name)}</button>${c.address ? `<div class="tiny muted">${esc(c.address)}</div>` : ''}`,
        role: chip(c.role, c.role === 'مشتری' ? 'green' : c.role === 'تأمین‌کننده' ? 'blue' : ''),
        phone: `<span class="nums">${esc(c.phone || '—')}</span>`,
        balance: balance === 0 ? chip('تسویه', '') : `<b class="nums">${money(Math.abs(balance))}</b> ${balance > 0 ? chip('بدهکار', 'green') : chip('بستانکار', 'red')}`,
        actions: rowActions([
          { icon: icon('doc'), title: 'پروندهٔ حساب', attrs: `data-view="${c.id}"` },
          { icon: icon('wallet'), title: 'تسویه / پرداخت', attrs: `data-settle="${c.id}"` },
          { icon: icon('edit'), title: 'ویرایش', attrs: `data-edit="${c.id}"` },
          { icon: icon('trash'), title: 'حذف', attrs: `data-del="${c.id}"`, danger: true },
        ]),
      };
    });

    const totalDebtor = list.reduce((a, c) => (balanceOf(c.id) > 0 ? a + balanceOf(c.id) : a), 0);
    const totalCreditor = list.reduce((a, c) => (balanceOf(c.id) < 0 ? a - balanceOf(c.id) : a), 0);

    return `<div class="grid cols-3" style="margin-bottom:var(--sp-4)">
      ${stat({ label: 'جمع بدهکاران (طلب ما)', value: moneyShort(totalDebtor), unit: 'تومان', tone: 'green' })}
      ${stat({ label: 'جمع بستانکاران (بدهی ما)', value: moneyShort(totalCreditor), unit: 'تومان', tone: 'red' })}
      ${stat({ label: 'تعداد طرف حساب', value: faNum(list.length) })}
    </div>` + banner('روی نام هر شخص بزنید تا پروندهٔ پرداخت‌ها و تراکنش‌هایش باز شود؛ با دکمهٔ کیف پول می‌توانید با او تسویه کنید یا پرداختی داشته باشید.', 'blue', icon('info')) + '<div style="height:var(--sp-4)"></div>' + card({
      body: table([
        { key: 'name', label: 'نام' },
        { key: 'role', label: 'نوع' },
        { key: 'phone', label: 'تلفن' },
        { key: 'balance', label: 'مانده حساب', num: true },
        { key: 'actions', label: '' },
      ], rows, { emptyState: empty('طرف حسابی ثبت نشده', 'مشتریان دائم و تأمین‌کنندگان را اضافه کنید.', icon('users', 28), '<button class="btn btn-primary btn-sm" data-new>طرف حساب جدید</button>') }),
      tight: true,
    });
  },

  mount(root, ctx) {
    root.addEventListener('click', async (e) => {
      if (e.target.closest('[data-new]')) return contactForm(ctx);
      const view = e.target.closest('[data-view]');
      if (view) return contactSheet(ctx, ctx.state.contacts.find((c) => c.id === view.dataset.view));
      const settle = e.target.closest('[data-settle]');
      if (settle) return contactSettleForm(ctx, ctx.state.contacts.find((c) => c.id === settle.dataset.settle));
      const edit = e.target.closest('[data-edit]');
      if (edit) return contactForm(ctx, ctx.state.contacts.find((c) => c.id === edit.dataset.edit));
      const del = e.target.closest('[data-del]');
      if (del && await confirmDialog({ title: 'حذف طرف حساب؟', message: 'فاکتورهای مرتبط حذف نمی‌شوند.' })) {
        ctx.store.remove('contact', del.dataset.del);
        toast('حذف شد');
      }
      return undefined;
    });
  },
};

/* ================================ چک‌ها ================================ */

function chequeForm(ctx, cheque) {
  const { state } = ctx;
  const c = cheque || { kind: CHEQUE_KINDS[0], no: '', bank: '', amount: '', due: isoPlusDays(30), contactId: '', status: 'در جریان', note: '' };

  openDrawer({
    title: cheque ? 'ویرایش چک' : 'ثبت چک',
    body: `<div class="form-grid">
      ${select('kind', 'نوع چک', CHEQUE_KINDS, c.kind, { span: true })}
      ${text('no', 'شماره چک', c.no)}
      ${text('bank', 'بانک', c.bank)}
      ${numberField('amount', 'مبلغ (تومان)', c.amount)}
      ${dateField('due', 'تاریخ سررسید', c.due)}
      ${select('contactId', 'طرف حساب', contactOptions(state), c.contactId, { blank: '—' })}
      ${select('status', 'وضعیت', CHEQUE_STATUS, c.status)}
      ${textarea('note', 'توضیح', c.note || '')}
    </div>`,
    onSubmit(values) {
      if (num(values.amount) <= 0) { toast('مبلغ چک را وارد کنید.', 'red'); return false; }
      ctx.store.put('cheque', { id: c.id, ...values, amount: num(values.amount) });
      toast('چک ذخیره شد', 'green');
      ctx.refresh();
      return true;
    },
  });
}

function chequeSettle(ctx, cheque) {
  const { state, store } = ctx;
  const incoming = cheque.kind === CHEQUE_KINDS[0];
  openDrawer({
    title: 'پاس کردن چک',
    submitLabel: 'ثبت پاس شدن',
    body: `<p class="muted small">مبلغ ${toman(cheque.amount)} به عنوان ${incoming ? 'درآمد' : 'هزینه'} ثبت می‌شود.</p>
      <div class="form-grid">
        ${dateField('date', 'تاریخ پاس شدن', todayIso())}
        ${select('accountId', 'حساب', accountOptions(state), state.accounts[0]?.id || '', { blank: '—' })}
      </div>`,
    onSubmit(values) {
      const txn = store.put('txn', {
        date: values.date || todayIso(),
        type: incoming ? 'درآمد' : 'هزینه',
        cat: incoming ? 'وصول چک' : 'پرداخت چک',
        amount: num(cheque.amount), accountId: values.accountId, contactId: cheque.contactId,
        method: 'چک', note: `چک شماره ${cheque.no || ''}`,
      });
      store.put('cheque', { ...cheque, status: 'پاس شده', txnId: txn.id });
      toast('چک پاس شد', 'green');
      ctx.refresh();
      return true;
    },
  });
}

export const cheques = {
  title: 'چک‌ها',
  subtitle: () => 'چک‌های دریافتی و پرداختی به تفکیک سررسید',
  actions: () => `
    <button class="btn" data-export>خروجی CSV</button>
    <button class="btn btn-primary" data-new>ثبت چک</button>`,

  render(ctx) {
    const { state } = ctx;
    const filter = ctx.params.status || 'در جریان';
    const soon = isoPlusDays(7);
    const list = state.cheques
      .filter((c) => filter === 'همه' || c.status === filter)
      .sort((a, b) => (a.due || '').localeCompare(b.due || ''));

    const rows = list.map((c) => ({
      _id: c.id,
      kind: chip(c.kind.startsWith('دریافت') ? 'دریافتی' : 'پرداختی', c.kind.startsWith('دریافت') ? 'green' : 'orange'),
      no: `<span class="nums">${esc(c.no || '—')}</span>`,
      bank: esc(c.bank || '—'),
      party: esc(contactName(state, c.contactId)),
      due: `${isoToJalali(c.due)}${c.status === 'در جریان' && c.due <= soon ? ' ' + chip('نزدیک', 'red') : ''}`,
      amount: money(c.amount),
      status: chip(c.status, c.status === 'پاس شده' ? 'green' : c.status === 'برگشتی' ? 'red' : c.status === 'باطل شده' ? '' : 'blue'),
      actions: rowActions([
        ...(c.status === 'در جریان' ? [{ icon: icon('check'), title: 'پاس شد', attrs: `data-settle="${c.id}"` }] : []),
        { icon: icon('edit'), title: 'ویرایش', attrs: `data-edit="${c.id}"` },
        { icon: icon('trash'), title: 'حذف', attrs: `data-del="${c.id}"`, danger: true },
      ]),
    }));

    const inSum = openCheques(state, CHEQUE_KINDS[0]).reduce((a, c) => a + num(c.amount), 0);
    const outSum = openCheques(state, CHEQUE_KINDS[1]).reduce((a, c) => a + num(c.amount), 0);
    const dueSoon = state.cheques.filter((c) => c.status === 'در جریان' && c.due && c.due <= soon);

    return `
      ${dueSoon.length ? banner(`<b>${faNum(dueSoon.length)} چک</b> تا ۷ روز آینده سررسید می‌شود.`, 'orange', icon('alert')) + '<div style="height:var(--sp-4)"></div>' : ''}
      <div class="grid cols-2" style="margin-bottom:var(--sp-4)">
        ${stat({ label: 'چک‌های دریافتی در جریان', value: money(inSum), unit: 'تومان', tone: 'green' })}
        ${stat({ label: 'چک‌های پرداختی در جریان', value: money(outSum), unit: 'تومان', tone: 'red' })}
      </div>
      <div class="cluster" style="margin-bottom:var(--sp-4)">
        ${['در جریان', ...CHEQUE_STATUS.filter((s) => s !== 'در جریان'), 'همه'].map((s) =>
          `<button class="chip" data-status="${esc(s)}"${s === filter ? ' data-tone="blue"' : ''}>${esc(s)}</button>`).join('')}
      </div>
      ${card({
        body: table([
          { key: 'kind', label: 'نوع' },
          { key: 'no', label: 'شماره' },
          { key: 'bank', label: 'بانک' },
          { key: 'party', label: 'طرف حساب' },
          { key: 'due', label: 'سررسید' },
          { key: 'amount', label: 'مبلغ', num: true },
          { key: 'status', label: 'وضعیت' },
          { key: 'actions', label: '' },
        ], rows, { emptyState: empty('چکی ثبت نشده', 'چک‌های دریافتی و پرداختی را اینجا مدیریت کنید.', icon('cheque', 28)) }),
        tight: true,
      })}`;
  },

  mount(root, ctx) {
    root.addEventListener('click', async (e) => {
      if (e.target.closest('[data-new]')) return chequeForm(ctx);
      const s = e.target.closest('[data-status]');
      if (s) return ctx.setParams({ status: s.dataset.status });
      const settle = e.target.closest('[data-settle]');
      if (settle) return chequeSettle(ctx, ctx.state.cheques.find((c) => c.id === settle.dataset.settle));
      const edit = e.target.closest('[data-edit]');
      if (edit) return chequeForm(ctx, ctx.state.cheques.find((c) => c.id === edit.dataset.edit));
      if (e.target.closest('[data-export]')) {
        const lines = ['نوع,شماره,بانک,طرف حساب,سررسید,مبلغ,وضعیت'];
        ctx.state.cheques.forEach((c) => lines.push([c.kind, c.no, c.bank, contactName(ctx.state, c.contactId), isoToJalali(c.due), num(c.amount), c.status].map(csvCell).join(',')));
        download('hesabyar-cheques.csv', lines.join('\n'), 'text/csv;charset=utf-8');
        return undefined;
      }
      const del = e.target.closest('[data-del]');
      if (del && await confirmDialog({ title: 'حذف چک؟', message: 'این چک از فهرست حذف می‌شود.' })) {
        ctx.store.remove('cheque', del.dataset.del);
        toast('حذف شد');
      }
      return undefined;
    });
  },
};

/* ================================ بودجه ================================ */

export const budgets = {
  title: 'بودجه ماهانه',
  subtitle: () => 'سقف هزینه هر دسته و مقایسه با عملکرد',
  actions: () => '<button class="btn btn-primary" data-new>تعیین بودجه</button>',

  render(ctx) {
    const { state } = ctx;
    const key = ctx.params.month || currentMonthKey();
    const list = state.budgets.filter((b) => b.month === key);
    const spentOf = (cat) => monthTxns(state, key)
      .filter((t) => t.type === 'هزینه' && t.cat === cat)
      .reduce((a, t) => a + num(t.amount), 0);

    const meters = list.length ? `<div class="meters">${list.map((b) => {
      const spent = spentOf(b.cat);
      const pct = Math.min(100, (spent / Math.max(1, num(b.amount))) * 100);
      const tone = pct >= 100 ? 'red' : pct >= 80 ? 'orange' : 'green';
      return `<div class="meter">
        <span class="name">${esc(b.cat)}</span>
        <span class="track"><span class="fill" data-tone="${tone}" style="width:${pct}%"></span></span>
        <span class="nums small">${money(spent)} / ${money(b.amount)}
          <button class="btn btn-sm btn-icon btn-danger" data-del="${b.id}" title="حذف" aria-label="حذف">${icon('close')}</button></span>
      </div>`;
    }).join('')}</div>` : empty('برای این ماه بودجه‌ای تعیین نشده', 'مثلاً سقف هزینه «اجاره مغازه» را مشخص کنید.', icon('budget', 28));

    const months = lastMonthKeys(12);
    return `
      <div class="field" style="max-width:260px">
        <label class="lbl" for="month-pick">ماه</label>
        <div class="select-wrap"><select id="month-pick">${months.map((m) => `<option value="${m}"${m === key ? ' selected' : ''}>${esc(monthKeyLabel(m))}</option>`).join('')}</select></div>
      </div>
      ${card({ title: `بودجه ${monthKeyLabel(key)}`, body: meters })}`;
  },

  mount(root, ctx) {
    root.addEventListener('change', (e) => {
      if (e.target.id === 'month-pick') ctx.setParams({ month: e.target.value });
    });
    root.addEventListener('click', async (e) => {
      if (e.target.closest('[data-new]')) {
        const key = ctx.params.month || currentMonthKey();
        openDrawer({
          title: 'تعیین بودجه',
          body: `<div class="form-grid">
            ${select('cat', 'دسته هزینه', EXPENSE_CATS, EXPENSE_CATS[1])}
            ${numberField('amount', 'سقف ماهانه (تومان)', '')}
          </div>`,
          onSubmit(values) {
            if (num(values.amount) <= 0) { toast('مبلغ را وارد کنید.', 'red'); return false; }
            const existing = ctx.state.budgets.find((b) => b.month === key && b.cat === values.cat);
            ctx.store.put('budget', { id: existing?.id, month: key, cat: values.cat, amount: num(values.amount) });
            toast('بودجه ثبت شد', 'green');
            ctx.refresh();
            return true;
          },
        });
        return;
      }
      const del = e.target.closest('[data-del]');
      if (del && await confirmDialog({ title: 'حذف بودجه؟', message: 'این سقف هزینه حذف می‌شود.' })) {
        ctx.store.remove('budget', del.dataset.del);
      }
    });
  },
};

/* ================================ اسناد ================================ */

export const docs = {
  title: 'اسناد و مالیات',
  subtitle: () => 'فاکتورهای رسمی، رسیدها و اسناد مالیاتی',
  actions: () => '<button class="btn btn-primary" data-new>ثبت سند</button>',

  render(ctx) {
    const { state } = ctx;
    const year = String(ctx.params.year || monthKey(todayIso()).split('-')[0]);
    const list = state.docs.filter((d) => monthKey(d.date).startsWith(year))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const years = uniq(state.docs.map((d) => monthKey(d.date).split('-')[0])).concat(year);

    const rows = list.map((d) => ({
      _id: d.id,
      title: `<b>${esc(d.title)}</b>${d.no ? `<div class="tiny muted">${esc(d.no)}</div>` : ''}`,
      type: esc(d.type),
      date: isoToJalali(d.date),
      amount: money(d.amount),
      tax: money(d.tax),
      actions: rowActions([{ icon: icon('trash'), title: 'حذف', attrs: `data-del="${d.id}"`, danger: true }]),
    }));

    return `
      <div class="grid cols-2" style="margin-bottom:var(--sp-4)">
        ${stat({ label: `جمع مبلغ اسناد ${faNum(year)}`, value: moneyShort(list.reduce((a, d) => a + num(d.amount), 0)), unit: 'تومان', tone: 'blue' })}
        ${stat({ label: 'جمع مالیات اسناد', value: moneyShort(list.reduce((a, d) => a + num(d.tax), 0)), unit: 'تومان', tone: 'orange' })}
      </div>
      <div class="cluster" style="margin-bottom:var(--sp-4)">
        ${[...new Set(years)].map((y) => `<button class="chip" data-year="${esc(y)}"${y === year ? ' data-tone="blue"' : ''}>${faNum(y)}</button>`).join('')}
      </div>
      ${card({
        body: table([
          { key: 'title', label: 'عنوان' },
          { key: 'type', label: 'نوع' },
          { key: 'date', label: 'تاریخ' },
          { key: 'amount', label: 'مبلغ', num: true },
          { key: 'tax', label: 'مالیات', num: true },
          { key: 'actions', label: '' },
        ], rows, { emptyState: empty('سندی ثبت نشده', 'فاکتورهای رسمی و رسیدهای مالیاتی را بایگانی کنید.', icon('doc', 28)) }),
        tight: true,
      })}`;
  },

  mount(root, ctx) {
    root.addEventListener('click', async (e) => {
      const y = e.target.closest('[data-year]');
      if (y) return ctx.setParams({ year: y.dataset.year });
      if (e.target.closest('[data-new]')) {
        openDrawer({
          title: 'ثبت سند',
          body: `<div class="form-grid">
            ${text('title', 'عنوان سند', '', { span: true })}
            ${select('type', 'نوع', DOC_TYPES, DOC_TYPES[0])}
            ${dateField('date', 'تاریخ', todayIso())}
            ${text('no', 'شماره سند', '')}
            ${numberField('amount', 'مبلغ (تومان)', '')}
            ${numberField('tax', 'مالیات (تومان)', '')}
            ${textarea('note', 'توضیح', '')}
          </div>`,
          onSubmit(values) {
            if (!values.title) { toast('عنوان الزامی است.', 'red'); return false; }
            ctx.store.put('doc', { ...values, amount: num(values.amount), tax: num(values.tax) });
            toast('سند ذخیره شد', 'green');
            ctx.refresh();
            return true;
          },
        });
        return undefined;
      }
      const del = e.target.closest('[data-del]');
      if (del && await confirmDialog({ title: 'حذف سند؟', message: 'این سند حذف می‌شود.' })) {
        ctx.store.remove('doc', del.dataset.del);
        toast('حذف شد');
      }
      return undefined;
    });
  },
};

/* =============================== گزارش‌ها =============================== */

export const reports = {
  title: 'گزارش‌ها',
  subtitle: () => 'سود و زیان، پرفروش‌ترین‌ها و تحلیل هزینه',
  actions: () => '<button class="btn" data-csv>خروجی کامل CSV</button>',

  render(ctx) {
    const { state } = ctx;
    const months = lastMonthKeys(6);
    const key = currentMonthKey();

    const rows = months.map((m) => ({
      month: monthKeyLabel(m),
      income: money(monthIncome(state, m)),
      expense: money(monthExpense(state, m)),
      net: money(monthIncome(state, m) - monthExpense(state, m)),
      profit: money(monthSalesProfit(state, m)),
    }));

    // پرفروش‌ترین کالاها
    const sales = new Map();
    state.invoices.filter((i) => i.kind === 'فروش').forEach((inv) => {
      (inv.items || []).forEach((it) => {
        const name = it.desc || '—';
        const prev = sales.get(name) || { qty: 0, amount: 0 };
        sales.set(name, { qty: prev.qty + num(it.qty), amount: prev.amount + num(it.qty) * num(it.price) });
      });
    });
    const top = [...sales.entries()].sort((a, b) => b[1].amount - a[1].amount).slice(0, 8);

    // ترکیب هزینه ماه جاری
    const byCat = new Map();
    monthTxns(state, key).filter((t) => t.type === 'هزینه').forEach((t) => {
      byCat.set(t.cat || 'متفرقه', (byCat.get(t.cat || 'متفرقه') || 0) + num(t.amount));
    });
    const catList = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
    const maxCat = Math.max(1, ...catList.map((c) => c[1]));

    return `
      <div class="grid cols-4" style="margin-bottom:var(--sp-4)">
        ${stat({ label: 'سود ناخالص ماه جاری', value: moneyShort(monthSalesProfit(state, key)), unit: 'تومان', tone: 'green' })}
        ${stat({ label: 'طلب از مشتریان', value: moneyShort(receivable(state)), unit: 'تومان', tone: 'blue' })}
        ${stat({ label: 'بدهی به تأمین‌کنندگان', value: moneyShort(payable(state)), unit: 'تومان', tone: 'red' })}
        ${stat({ label: 'ارزش انبار', value: moneyShort(stockValue(state)), unit: 'تومان', tone: 'orange' })}
      </div>
      <div class="grid cols-sidebar">
        ${card({ title: 'عملکرد شش ماه اخیر', tight: true, body: table([
          { key: 'month', label: 'ماه' },
          { key: 'income', label: 'درآمد', num: true },
          { key: 'expense', label: 'هزینه', num: true },
          { key: 'net', label: 'خالص', num: true },
          { key: 'profit', label: 'سود فروش', num: true },
        ], rows) })}
        ${card({ title: `ترکیب هزینه ${monthKeyLabel(key)}`, body: catList.length ? `<div class="meters">${catList.map(([cat, amount]) => `
          <div class="meter">
            <span class="name">${esc(cat)}</span>
            <span class="track"><span class="fill" data-tone="orange" style="width:${(amount / maxCat) * 100}%"></span></span>
            <span class="nums small">${money(amount)}</span>
          </div>`).join('')}</div>` : empty('هزینه‌ای ثبت نشده', '', icon('swap', 28)) })}
      </div>
      <div style="margin-top:var(--sp-4)">
        ${card({ title: 'پرفروش‌ترین کالاها', tight: true, body: table([
          { key: 'name', label: 'کالا' },
          { key: 'qty', label: 'تعداد فروش', num: true },
          { key: 'amount', label: 'مبلغ فروش', num: true },
        ], top.map(([name, v]) => ({ name: esc(name), qty: faNum(v.qty), amount: money(v.amount) })),
        { emptyState: empty('هنوز فروشی ثبت نشده', '', icon('invoice', 28)) }) })}
      </div>`;
  },

  mount(root, ctx) {
    root.addEventListener('click', (e) => {
      if (!e.target.closest('[data-csv]')) return;
      const { state } = ctx;
      const lines = ['نوع رکورد,تاریخ,شرح,طرف حساب,مبلغ'];
      state.txns.forEach((t) => lines.push([t.type, isoToJalali(t.date), t.cat || t.note || '', contactName(state, t.contactId), num(t.amount)].map(csvCell).join(',')));
      state.invoices.forEach((i) => lines.push([`فاکتور ${i.kind}`, isoToJalali(i.date), `#${i.no}`, contactName(state, i.contactId), invoiceProfit(i, state.products)].map(csvCell).join(',')));
      download(`hesabyar-full-${isoToJalali(todayIso()).replace(/\//g, '-')}.csv`, lines.join('\n'), 'text/csv;charset=utf-8');
      toast('خروجی آماده شد');
    });
  },
};

/* =============================== تنظیمات =============================== */

export const settings = {
  title: 'تنظیمات',
  subtitle: () => 'مشخصات مغازه، قواعد قیمت‌گذاری و پشتیبان‌گیری',

  render(ctx) {
    const s = ctx.state.settings;
    return `
      <div class="grid cols-sidebar">
        <div class="stack">
          ${card({
            title: 'مشخصات مغازه',
            body: `<form id="settings-form"><div class="form-grid">
              ${text('shop', 'نام مغازه', s.shop)}
              ${text('owner', 'نام مالک', s.owner)}
              ${text('phone', 'تلفن', s.phone)}
              ${numberField('taxRate', 'درصد مالیات پیش‌فرض', s.taxRate)}
              ${text('address', 'آدرس', s.address, { span: true })}
            </div>
            <div class="form-grid">
              ${numberField('buyMarkup', 'درصد سود فاکتور خرید', s.buyMarkup, { hint: 'برای کالای جدیدی که از فاکتور خرید ساخته می‌شود' })}
              ${numberField('autoMargin', 'درصد سود پیش‌فرض کالا', s.autoMargin, { hint: 'قیمت خرید = قیمت فروش منهای این درصد' })}
            </div>
            ${'<label class="check"><input type="checkbox" name="addNewFromPurchase"' + (s.addNewFromPurchase ? ' checked' : '') + ' /> <span>کالاهای فاکتور خرید به صورت پیش‌فرض به لیست محصولات اضافه شود</span></label>'}
            ${'<label class="check"><input type="checkbox" name="shopReserveStock"' + (s.shopReserveStock !== false ? ' checked' : '') + ' /> <span>با ثبت سفارش در سایت، موجودی کالا بلافاصله کم شود</span></label>'}
            <div class="cluster" style="margin-top:var(--sp-4)"><button type="button" class="btn btn-primary" id="save-settings">ذخیره تنظیمات</button></div>
            </form>`,
          })}
          ${card({
            title: 'پشتیبان‌گیری و داده‌ها',
            body: `<p class="small muted">داده‌ها روی سرور ذخیره می‌شوند؛ با این دکمه می‌توانید یک نسخه کامل روی گوشی/کامپیوتر ذخیره کنید.</p>
              <div class="cluster">
                <button class="btn" id="backup">دانلود پشتیبان کامل</button>
                <button class="btn" id="force-sync">همگام‌سازی کامل مجدد</button>
                <button class="btn btn-danger" id="wipe">پاک کردن همه داده‌ها</button>
              </div>`,
          })}
        </div>
        ${card({
          title: 'راهنمای سریع',
          body: `<ul class="small muted" style="padding-inline-start:18px;line-height:2">
            <li>در فرم‌ها با کلید Enter به فیلد بعدی می‌روید و در آخرین فیلد ذخیره می‌شود.</li>
            <li>تاریخ‌ها شمسی و به شکل ۱۴۰۵/۰۵/۰۶ وارد می‌شوند.</li>
            <li>فاکتور خرید، کالای جدید را خودکار می‌سازد و موجودی را بالا می‌برد.</li>
            <li>اگر اینترنت قطع شود، ثبت‌ها در صف می‌مانند و پس از اتصال خودکار ارسال می‌شوند.</li>
            <li>هر فروش و خرید خودکار در تب «درآمد و هزینه» ثبت می‌شود؛ نسیه با برچسب «نسیه».</li>
            <li>در «طرف حساب‌ها» روی نام هر شخص بزنید تا پرونده و دکمهٔ تسویهٔ او باز شود.</li>
            <li>پیش‌نویس «فروش سریع» تا ثبت نهایی روی همین دستگاه می‌ماند.</li>
          </ul>
          <div class="cluster" style="margin-top:var(--sp-4)">
            <span class="chip">نسخه ۱.۹ بتا</span>
          </div>
          <p class="small muted" style="margin-top:var(--sp-2)">حساب‌یار ۱.۹ بتا — دفتر یکپارچهٔ فروش، تسویهٔ طرف حساب‌ها و فروشگاه اینترنتی.</p>`,
        })}
      </div>`;
  },

  mount(root, ctx) {
    root.addEventListener('click', async (e) => {
      if (e.target.closest('#save-settings')) {
        const form = $('#settings-form', root);
        const values = {};
        form.querySelectorAll('input, select, textarea').forEach((el) => {
          if (!el.name) return;
          values[el.name] = el.type === 'checkbox' ? el.checked : el.value.trim();
        });
        ctx.store.put('settings', {
          ...ctx.state.settings, ...values,
          taxRate: num(values.taxRate), buyMarkup: num(values.buyMarkup), autoMargin: num(values.autoMargin),
        });
        toast('تنظیمات ذخیره شد', 'green');
        ctx.refresh();
      }

      if (e.target.closest('#backup')) {
        try {
          const data = await api.exportAll();
          download(`hesabyar-backup-${isoToJalali(todayIso()).replace(/\//g, '-')}.json`, JSON.stringify(data, null, 2));
          toast('پشتیبان دانلود شد', 'green');
        } catch {
          download(`hesabyar-backup-local-${isoToJalali(todayIso()).replace(/\//g, '-')}.json`, JSON.stringify(ctx.state, null, 2));
          toast('سرور در دسترس نبود؛ نسخه محلی دانلود شد');
        }
      }

      if (e.target.closest('#force-sync')) {
        await dataStore.bootstrap();
        toast('همگام‌سازی کامل انجام شد', 'green');
      }

      if (e.target.closest('#wipe') && await confirmDialog({
        title: 'پاک کردن همه داده‌ها؟',
        message: 'تمام فاکتورها، کالاها و تراکنش‌ها روی سرور حذف می‌شوند. پیش از این کار پشتیبان بگیرید.',
        confirmLabel: 'بله، پاک کن',
      })) {
        await api.reset();
        dataStore.clearLocal();
        await dataStore.bootstrap();
        toast('داده‌ها پاک شد');
      }
    });
  },
};

export const _refs = { MONTHS, auth, invoiceBalance };
