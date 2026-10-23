import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { at, makeRepo, rs } from './helpers';

describe('wallet management', () => {
  it('creates, updates, archives and restores wallets', async () => {
    const { repo } = makeRepo();
    const wallet = await repo.createWallet('Meezan Bank', 'bank');
    assert.equal(wallet.name, 'Meezan Bank');
    const renamed = await repo.updateWallet(wallet.id, { name: 'Meezan Current', icon: '🏦' });
    assert.equal(renamed.name, 'Meezan Current');
    assert.equal(renamed.icon, '🏦');
    await repo.setWalletArchived(wallet.id, true);
    assert.equal((await repo.listWallets()).some((w) => w.id === wallet.id), false);
    assert.equal((await repo.listWallets({ includeArchived: true })).some((w) => w.id === wallet.id), true);
    await repo.setWalletArchived(wallet.id, false);
    assert.equal((await repo.listWallets()).some((w) => w.id === wallet.id), true);
  });

  it('deletes an unused wallet but refuses to delete a wallet with transactions', async () => {
    const { repo } = makeRepo();
    const empty = await repo.createWallet('Temp', 'custom');
    await repo.deleteWallet(empty.id);
    assert.equal((await repo.listWallets({ includeArchived: true })).some((w) => w.id === empty.id), false);

    const cash = await repo.getWalletByName('Cash');
    await repo.setOpeningBalance({ walletId: cash!.id, signedAmountMinor: rs(100), occurredAt: at('2026-10-01') });
    await assert.rejects(() => repo.deleteWallet(cash!.id), /has transactions/);
  });

  it('reconciles: first actual balance becomes the opening balance, later differences become adjustments', async () => {
    const { repo } = makeRepo();
    const jazz = await repo.getWalletByName('JazzCash');
    const first = await repo.reconcileWallet(jazz!.id, rs(5000), { occurredAt: at('2026-10-01') });
    assert.equal(first.adjusted, true);
    assert.equal(first.transaction?.classification, 'opening_balance');
    assert.equal((await repo.getWalletDetail(jazz!.id)).wallet.balanceMinor, rs(5000));

    await repo.addExpense({ walletId: jazz!.id, amountMinor: rs(500), occurredAt: at('2026-10-02') });
    const second = await repo.reconcileWallet(jazz!.id, rs(4200), { occurredAt: at('2026-10-03') });
    assert.equal(second.deltaMinor, -rs(300));
    assert.equal(second.transaction?.classification, 'balance_adjustment');
    assert.equal((await repo.getWalletDetail(jazz!.id)).wallet.balanceMinor, rs(4200));

    const third = await repo.reconcileWallet(jazz!.id, rs(4200));
    assert.equal(third.adjusted, false);
    assert.equal(third.transaction, null);
  });

  it('wallet detail reports balance, count and history', async () => {
    const { repo } = makeRepo();
    const cash = await repo.getWalletByName('Cash');
    await repo.setOpeningBalance({ walletId: cash!.id, signedAmountMinor: rs(1000), occurredAt: at('2026-10-01') });
    await repo.addExpense({ walletId: cash!.id, amountMinor: rs(200), occurredAt: at('2026-10-02') });
    const detail = await repo.getWalletDetail(cash!.id);
    assert.equal(detail.wallet.balanceMinor, rs(800));
    assert.equal(detail.transactionCount, 2);
    assert.equal(detail.hasOpeningBalance, true);
    assert.equal(detail.recent.length, 2);
  });
});

describe('people management', () => {
  it('updates names and phones, rejects duplicate names, archives and deletes safely', async () => {
    const { repo } = makeRepo();
    const cash = await repo.getWalletByName('Cash');
    await repo.setOpeningBalance({ walletId: cash!.id, signedAmountMinor: rs(10000), occurredAt: at('2026-10-01') });
    await repo.lend({ personName: 'Ahmed', walletId: cash!.id, amountMinor: rs(1000), occurredAt: at('2026-10-02') });
    await repo.lend({ personName: 'Bilal', walletId: cash!.id, amountMinor: rs(500), occurredAt: at('2026-10-02') });

    const people = await repo.listPeople();
    const ahmed = people.find((p) => p.name === 'Ahmed');
    assert.ok(ahmed);
    const updated = await repo.updatePerson(ahmed!.id, { name: 'Ahmed Raza', phone: '03001234567' });
    assert.equal(updated.name, 'Ahmed Raza');
    assert.equal(updated.phone, '03001234567');
    // The loan now resolves to the renamed person.
    const summaries = await repo.getPersonSummaries();
    assert.equal(summaries.some((s) => s.person.name === 'Ahmed Raza'), true);

    // Duplicate name rejected.
    await assert.rejects(() => repo.updatePerson(ahmed!.id, { name: 'Bilal' }), /already uses this name/);
    // Person with loans cannot be deleted, only archived.
    await assert.rejects(() => repo.deletePerson(ahmed!.id), /udhaar records/);
    await repo.setPersonArchived(ahmed!.id, true);
    assert.equal((await repo.listPeople()).some((p) => p.id === ahmed!.id), false);

    // A person with no records deletes cleanly.
    const temp = await repo.findOrCreatePerson('Temp Person');
    await repo.deletePerson(temp.id);
    assert.equal((await repo.listPeople({ includeArchived: true })).some((p) => p.id === temp.id), false);
  });

  it('searches people by name', async () => {
    const { repo } = makeRepo();
    await repo.findOrCreatePerson('Ahmed Raza');
    await repo.findOrCreatePerson('Bilal Ahmed');
    await repo.findOrCreatePerson('Sara Khan');
    const hits = await repo.listPeople({ search: 'ahmed' });
    assert.deepEqual(hits.map((p) => p.name), ['Ahmed Raza', 'Bilal Ahmed']);
  });
});

describe('category management', () => {
  it('creates custom categories, updates and deletes unused ones; system categories are delete-protected', async () => {
    const { repo } = makeRepo();
    const cat = await repo.createCategory({ name: 'University', kind: 'expense', icon: '🎓' });
    assert.equal(cat.system, false);
    const updated = await repo.updateCategory(cat.id, { name: 'University Fees' });
    assert.equal(updated.name, 'University Fees');
    await assert.rejects(() => repo.createCategory({ name: 'University Fees', kind: 'expense' }), /already exists/);

    const cash = await repo.getWalletByName('Cash');
    await repo.addExpense({ walletId: cash!.id, amountMinor: rs(300), categoryId: cat.id, occurredAt: at('2026-10-02') });
    await assert.rejects(() => repo.deleteCategory(cat.id), /used by transactions/);
    await repo.setCategoryArchived(cat.id, true);
    assert.equal((await repo.listCategories()).some((c) => c.id === cat.id), false);

    const food = await repo.getCategoryByName('Food', 'expense');
    await assert.rejects(() => repo.deleteCategory(food!.id), /Built-in categories/);

    const unused = await repo.createCategory({ name: 'Scratch', kind: 'expense' });
    await repo.deleteCategory(unused.id);
    assert.equal((await repo.listCategories({ includeArchived: true })).some((c) => c.id === unused.id), false);
  });
});

describe('transaction search, filter, sort and pagination', () => {
  it('combines structured filters, text search, sorting and pages', async () => {
    const { repo } = makeRepo();
    const cash = await repo.getWalletByName('Cash');
    const jazz = await repo.getWalletByName('JazzCash');
    const food = await repo.getCategoryByName('Food', 'expense');
    await repo.setOpeningBalance({ walletId: cash!.id, signedAmountMinor: rs(20000), occurredAt: at('2026-10-01') });
    await repo.addExpense({ walletId: cash!.id, amountMinor: rs(450), categoryId: food!.id, note: 'Burger at cafe', occurredAt: at('2026-10-02') });
    await repo.addExpense({ walletId: jazz!.id, amountMinor: rs(1200), note: 'Shoes', occurredAt: at('2026-10-03') });
    await repo.addIncome({ walletId: cash!.id, amountMinor: rs(3000), counterparty: 'Father', note: 'Monthly pocket money', occurredAt: at('2026-10-04') });
    await repo.addExpense({ walletId: cash!.id, amountMinor: rs(150), note: 'Bus fare', occurredAt: at('2026-09-30') });

    // Classification + month.
    const octoberExpenses = await repo.listTransactions({ classification: 'expense', monthPrefix: '2026-10' });
    assert.equal(octoberExpenses.length, 2);
    // Wallet filter.
    const jazzTxns = await repo.listTransactions({ walletId: jazz!.id });
    assert.equal(jazzTxns.length, 1);
    // Text search hits note and counterparty.
    assert.equal((await repo.listTransactions({ search: 'burger' })).length, 1);
    assert.equal((await repo.listTransactions({ search: 'father' })).length, 1);
    assert.equal((await repo.listTransactions({ search: 'food' })).length, 1);
    // Date range.
    const range = await repo.listTransactions({ dateFrom: '2026-10-02', dateTo: '2026-10-03' });
    assert.equal(range.length, 2);
    // Amount sort.
    const byAmount = await repo.listTransactions({ sort: 'amount_desc', limit: 3 });
    assert.deepEqual(byAmount.map((t) => t.amountMinor), [rs(20000), rs(3000), rs(1200)]);
    // Pagination + count agreement.
    const page1 = await repo.listTransactions({ limit: 2, offset: 0 });
    const page2 = await repo.listTransactions({ limit: 2, offset: 2 });
    assert.equal(page1.length, 2);
    assert.equal(page2.length, 2);
    assert.notEqual(page1[0].id, page2[0].id);
    assert.equal(await repo.countTransactions({}), 5);
    assert.equal(await repo.countTransactions({ classification: 'expense' }), 3);
  });
});

describe('transaction corrections', () => {
  it('edits metadata without touching postings or balances', async () => {
    const { repo } = makeRepo();
    const cash = await repo.getWalletByName('Cash');
    const food = await repo.getCategoryByName('Food', 'expense');
    const created = await repo.addExpense({ walletId: cash!.id, amountMinor: rs(500), note: 'old note', occurredAt: at('2026-10-02') });
    const before = await repo.getDashboard('2026-10');
    const updated = await repo.updateTransactionMetadata(created.transaction.id, { note: 'team lunch', categoryId: food!.id });
    assert.equal(updated.note, 'team lunch');
    assert.equal(updated.categoryId, food!.id);
    const after = await repo.getDashboard('2026-10');
    assert.equal(after.availableCashMinor, before.availableCashMinor);
    assert.equal(after.monthExpensesMinor, before.monthExpensesMinor);
  });

  it('edits amount and wallet through reversal + correction, atomically', async () => {
    const { repo } = makeRepo();
    const cash = await repo.getWalletByName('Cash');
    const jazz = await repo.getWalletByName('JazzCash');
    await repo.setOpeningBalance({ walletId: cash!.id, signedAmountMinor: rs(5000), occurredAt: at('2026-10-01') });
    await repo.setOpeningBalance({ walletId: jazz!.id, signedAmountMinor: rs(1000), occurredAt: at('2026-10-01') });
    const created = await repo.addExpense({ walletId: cash!.id, amountMinor: rs(500), occurredAt: at('2026-10-02') });
    const edited = await repo.editSimpleTransaction(created.transaction.id, { amountMinor: rs(650), walletId: jazz!.id });
    assert.equal(edited.transaction.amountMinor, rs(650));
    assert.equal((await repo.getTransaction(created.transaction.id))?.status, 'reversed');
    const wallets = await repo.listWallets();
    assert.equal(wallets.find((w) => w.name === 'Cash')?.balanceMinor, rs(5000)); // expense moved off Cash
    assert.equal(wallets.find((w) => w.name === 'JazzCash')?.balanceMinor, rs(350)); // 1000 - 650
    assert.equal((await repo.verifyIntegrity()).ok, true);
  });

  it('duplicates and restores simple transactions', async () => {
    const { repo } = makeRepo();
    const cash = await repo.getWalletByName('Cash');
    await repo.setOpeningBalance({ walletId: cash!.id, signedAmountMinor: rs(5000), occurredAt: at('2026-10-01') });
    const created = await repo.addExpense({ walletId: cash!.id, amountMinor: rs(200), occurredAt: at('2026-10-02') });
    const copy = await repo.duplicateTransaction(created.transaction.id);
    assert.equal(copy.created, true);
    assert.notEqual(copy.transaction.id, created.transaction.id);
    assert.equal((await repo.getDashboard('2026-10')).monthExpensesMinor, rs(400));

    await repo.reverseTransaction(copy.transaction.id);
    assert.equal((await repo.getDashboard('2026-10')).monthExpensesMinor, rs(200));
    const restored = await repo.restoreTransaction(copy.transaction.id);
    assert.equal(restored.transaction.amountMinor, rs(200));
    assert.equal((await repo.getDashboard('2026-10')).monthExpensesMinor, rs(400));
    await assert.rejects(() => repo.restoreTransaction(restored.transaction.id), /Only a reversed/);
  });

  it('refuses to edit loan-linked transactions through the simple path', async () => {
    const { repo } = makeRepo();
    const cash = await repo.getWalletByName('Cash');
    await repo.setOpeningBalance({ walletId: cash!.id, signedAmountMinor: rs(5000), occurredAt: at('2026-10-01') });
    const loan = await repo.lend({ personName: 'Ahmed', walletId: cash!.id, amountMinor: rs(1000), occurredAt: at('2026-10-02') });
    await assert.rejects(() => repo.editSimpleTransaction(loan.principalTransactionId, { amountMinor: rs(900) }), /Loan-linked/);
    await assert.rejects(() => repo.duplicateTransaction(loan.principalTransactionId), /Loan-linked/);
  });
});

describe('bulk operations', () => {
  it('bulk delete reverses all selected entries and updates balances', async () => {
    const { repo } = makeRepo();
    const cash = await repo.getWalletByName('Cash');
    await repo.setOpeningBalance({ walletId: cash!.id, signedAmountMinor: rs(10000), occurredAt: at('2026-10-01') });
    const a = await repo.addExpense({ walletId: cash!.id, amountMinor: rs(100), occurredAt: at('2026-10-02') });
    const b = await repo.addExpense({ walletId: cash!.id, amountMinor: rs(200), occurredAt: at('2026-10-03') });
    const c = await repo.addExpense({ walletId: cash!.id, amountMinor: rs(300), occurredAt: at('2026-10-04') });
    const summary = await repo.summarizeTransactions([a.transaction.id, b.transaction.id, c.transaction.id]);
    assert.equal(summary.count, 3);
    assert.equal(summary.totalMinor, rs(600));
    const result = await repo.bulkReverseTransactions([a.transaction.id, b.transaction.id, c.transaction.id]);
    assert.equal(result.reversed, 3);
    const dash = await repo.getDashboard('2026-10');
    assert.equal(dash.availableCashMinor, rs(10000));
    assert.equal(dash.monthExpensesMinor, 0);
  });

  it('bulk delete is atomic: one invalid item aborts the whole batch', async () => {
    const { repo } = makeRepo();
    const cash = await repo.getWalletByName('Cash');
    await repo.setOpeningBalance({ walletId: cash!.id, signedAmountMinor: rs(10000), occurredAt: at('2026-10-01') });
    const a = await repo.addExpense({ walletId: cash!.id, amountMinor: rs(100), occurredAt: at('2026-10-02') });
    const b = await repo.addExpense({ walletId: cash!.id, amountMinor: rs(200), occurredAt: at('2026-10-03') });
    await assert.rejects(() => repo.bulkReverseTransactions([a.transaction.id, b.transaction.id, 'missing-id']), /Nothing was changed/);
    assert.equal((await repo.getTransaction(a.transaction.id))?.status, 'posted');
    assert.equal((await repo.getTransaction(b.transaction.id))?.status, 'posted');
    assert.equal((await repo.getDashboard('2026-10')).monthExpensesMinor, rs(300));
  });

  it('bulk delete refuses loan principals so repayments are never orphaned', async () => {
    const { repo } = makeRepo();
    const cash = await repo.getWalletByName('Cash');
    await repo.setOpeningBalance({ walletId: cash!.id, signedAmountMinor: rs(10000), occurredAt: at('2026-10-01') });
    const loan = await repo.lend({ personName: 'Ahmed', walletId: cash!.id, amountMinor: rs(1000), occurredAt: at('2026-10-02') });
    await assert.rejects(() => repo.bulkReverseTransactions([loan.principalTransactionId]), /loan screen/);
    assert.equal(await repo.getLoanRemainingMinor(loan.id), rs(1000));
  });

  it('bulk category change applies to income/expenses only, atomically', async () => {
    const { repo } = makeRepo();
    const cash = await repo.getWalletByName('Cash');
    const food = await repo.getCategoryByName('Food', 'expense');
    const bills = await repo.getCategoryByName('Bills', 'expense');
    const a = await repo.addExpense({ walletId: cash!.id, amountMinor: rs(100), categoryId: food!.id, occurredAt: at('2026-10-02') });
    const b = await repo.addExpense({ walletId: cash!.id, amountMinor: rs(200), categoryId: food!.id, occurredAt: at('2026-10-03') });
    const loan = await repo.lend({ personName: 'Ahmed', walletId: cash!.id, amountMinor: rs(1000), occurredAt: at('2026-10-04') });
    await assert.rejects(() => repo.bulkSetCategory([a.transaction.id, loan.principalTransactionId], bills!.id), /Nothing was changed/);
    assert.equal((await repo.getTransaction(a.transaction.id))?.categoryId, food!.id); // unchanged after abort
    const result = await repo.bulkSetCategory([a.transaction.id, b.transaction.id], bills!.id);
    assert.equal(result.updated, 2);
    assert.equal((await repo.getTransaction(a.transaction.id))?.categoryId, bills!.id);
    assert.equal((await repo.getTransaction(b.transaction.id))?.categoryId, bills!.id);
  });

  it('bulk void loans reverses principals and repayments together', async () => {
    const { repo } = makeRepo();
    const cash = await repo.getWalletByName('Cash');
    await repo.setOpeningBalance({ walletId: cash!.id, signedAmountMinor: rs(20000), occurredAt: at('2026-10-01') });
    const l1 = await repo.lend({ personName: 'Ahmed', walletId: cash!.id, amountMinor: rs(2000), occurredAt: at('2026-10-02') });
    const l2 = await repo.lend({ personName: 'Bilal', walletId: cash!.id, amountMinor: rs(3000), occurredAt: at('2026-10-02') });
    await repo.recordRepayment({ loanId: l1.id, amountMinor: rs(500), occurredAt: at('2026-10-03') });
    const result = await repo.bulkVoidLoans([l1.id, l2.id]);
    assert.equal(result.voided, 2);
    assert.equal((await repo.getLoan(l1.id))?.status, 'void');
    assert.equal((await repo.getLoan(l2.id))?.status, 'void');
    const dash = await repo.getDashboard('2026-10');
    assert.equal(dash.availableCashMinor, rs(20000));
    assert.equal(dash.receivablesMinor, 0);
    assert.equal((await repo.verifyIntegrity()).ok, true);
  });
});
