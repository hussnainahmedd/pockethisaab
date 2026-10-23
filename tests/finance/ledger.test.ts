import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { summarizePostings } from '../../lib/finance/engine';
import { CONTROLLED_RESET_CONFIRMATION } from '../../lib/finance/repository';
import type { SqlDriver } from '../../lib/finance/types';
import { at, makeRepo, rs } from './helpers';

const OCT = '2026-10';

describe('fresh v2 initialization', () => {
  it('seeds Cash, JazzCash, Easypaisa and Bank wallets with ZERO balances and no transactions', async () => {
    const { repo } = makeRepo();
    const wallets = await repo.listWallets();
    assert.deepEqual(wallets.map((w) => w.name), ['Bank Account', 'Cash', 'Easypaisa', 'JazzCash']);
    for (const w of wallets) assert.equal(w.balanceMinor, 0);
    const dash = await repo.getDashboard(OCT);
    assert.equal(dash.availableCashMinor, 0);
    assert.equal(dash.receivablesMinor, 0);
    assert.equal(dash.payablesMinor, 0);
    assert.equal(dash.netWorthMinor, 0);
    assert.deepEqual(await repo.listTransactions(), []);
    assert.equal((await repo.verifyIntegrity()).ok, true);
  });

  it('init is idempotent and never wipes existing data', async () => {
    const { repo } = makeRepo();
    const cash = await repo.getWalletByName('Cash');
    await repo.setOpeningBalance({ walletId: cash!.id, signedAmountMinor: rs(1000), occurredAt: at('2026-10-01') });
    await repo.init();
    await repo.init();
    const dash = await repo.getDashboard(OCT);
    assert.equal(dash.availableCashMinor, rs(1000));
    assert.equal((await repo.listWallets()).length, 4);
  });
});

describe('the six master-prompt financial examples', () => {
  it('Example 1: opening 10,000, expense 2,000, lent 3,000 -> cash 5,000, NW 8,000', async () => {
    const { repo } = makeRepo();
    const cash = await repo.getWalletByName('Cash');
    await repo.setOpeningBalance({ walletId: cash!.id, signedAmountMinor: rs(10000), occurredAt: at('2026-10-01') });
    await repo.addExpense({ walletId: cash!.id, amountMinor: rs(2000), occurredAt: at('2026-10-02') });
    await repo.lend({ personName: 'Ahmed', walletId: cash!.id, amountMinor: rs(3000), occurredAt: at('2026-10-03') });
    const dash = await repo.getDashboard(OCT);
    assert.equal(dash.availableCashMinor, rs(5000));
    assert.equal(dash.receivablesMinor, rs(3000));
    assert.equal(dash.payablesMinor, 0);
    assert.equal(dash.netWorthMinor, rs(8000));
  });

  it('Example 2: lending is not an expense — monthly expenses stay 2,000', async () => {
    const { repo } = makeRepo();
    const cash = await repo.getWalletByName('Cash');
    await repo.setOpeningBalance({ walletId: cash!.id, signedAmountMinor: rs(10000), occurredAt: at('2026-10-01') });
    await repo.addExpense({ walletId: cash!.id, amountMinor: rs(2000), occurredAt: at('2026-10-02') });
    await repo.lend({ personName: 'Ahmed', walletId: cash!.id, amountMinor: rs(3000), occurredAt: at('2026-10-03') });
    const dash = await repo.getDashboard(OCT);
    assert.equal(dash.monthExpensesMinor, rs(2000));
    assert.equal(dash.monthIncomeMinor, 0);
  });

  it('Example 3: someone repays 1,000 -> receivable drops, repayment is NOT income', async () => {
    const { repo } = makeRepo();
    const cash = await repo.getWalletByName('Cash');
    await repo.setOpeningBalance({ walletId: cash!.id, signedAmountMinor: rs(10000), occurredAt: at('2026-10-01') });
    const loan = await repo.lend({ personName: 'Ahmed', walletId: cash!.id, amountMinor: rs(3000), occurredAt: at('2026-10-03') });
    await repo.recordRepayment({ loanId: loan.id, amountMinor: rs(1000), occurredAt: at('2026-10-04') });
    const dash = await repo.getDashboard(OCT);
    assert.equal(dash.availableCashMinor, rs(8000));
    assert.equal(dash.receivablesMinor, rs(2000));
    assert.equal(dash.netWorthMinor, rs(10000));
    assert.equal(dash.monthIncomeMinor, 0);
  });

  it('Example 4: borrowing 5,000 raises cash to 10,000, payable 5,000, NW stays 8,000 (the v1 bug)', async () => {
    const { repo } = makeRepo();
    const cash = await repo.getWalletByName('Cash');
    await repo.setOpeningBalance({ walletId: cash!.id, signedAmountMinor: rs(10000), occurredAt: at('2026-10-01') });
    await repo.addExpense({ walletId: cash!.id, amountMinor: rs(2000), occurredAt: at('2026-10-02') });
    await repo.lend({ personName: 'Ahmed', walletId: cash!.id, amountMinor: rs(3000), occurredAt: at('2026-10-03') });
    await repo.borrow({ personName: 'Bilal', walletId: cash!.id, amountMinor: rs(5000), occurredAt: at('2026-10-05') });
    const dash = await repo.getDashboard(OCT);
    assert.equal(dash.availableCashMinor, rs(10000)); // v1 showed 0
    assert.equal(dash.payablesMinor, rs(5000));
    assert.equal(dash.netWorthMinor, rs(8000));
  });

  it('Example 5: repaying borrowed money cuts cash AND payable; NW unchanged', async () => {
    const { repo } = makeRepo();
    const cash = await repo.getWalletByName('Cash');
    await repo.setOpeningBalance({ walletId: cash!.id, signedAmountMinor: rs(10000), occurredAt: at('2026-10-01') });
    const loan = await repo.borrow({ personName: 'Bilal', walletId: cash!.id, amountMinor: rs(5000), occurredAt: at('2026-10-02') });
    await repo.recordRepayment({ loanId: loan.id, amountMinor: rs(2000), occurredAt: at('2026-10-03') });
    const dash = await repo.getDashboard(OCT);
    assert.equal(dash.availableCashMinor, rs(13000));
    assert.equal(dash.payablesMinor, rs(3000));
    assert.equal(dash.netWorthMinor, rs(10000));
  });

  it('Example 6: wallet transfer moves money, total cash and NW unchanged', async () => {
    const { repo } = makeRepo();
    const jazz = await repo.getWalletByName('JazzCash');
    const easy = await repo.getWalletByName('Easypaisa');
    await repo.setOpeningBalance({ walletId: jazz!.id, signedAmountMinor: rs(3000), occurredAt: at('2026-10-01') });
    await repo.transfer({ fromWalletId: jazz!.id, toWalletId: easy!.id, amountMinor: rs(1200), occurredAt: at('2026-10-02') });
    const wallets = await repo.listWallets();
    assert.equal(wallets.find((w) => w.name === 'JazzCash')?.balanceMinor, rs(1800));
    assert.equal(wallets.find((w) => w.name === 'Easypaisa')?.balanceMinor, rs(1200));
    const dash = await repo.getDashboard(OCT);
    assert.equal(dash.availableCashMinor, rs(3000));
    assert.equal(dash.netWorthMinor, rs(3000));
  });
});

describe('partial udhaar repayments', () => {
  it('tracks remaining balance and status through partial payments; rejects overpayment', async () => {
    const { repo } = makeRepo();
    const cash = await repo.getWalletByName('Cash');
    await repo.setOpeningBalance({ walletId: cash!.id, signedAmountMinor: rs(10000), occurredAt: at('2026-10-01') });
    const loan = await repo.lend({ personName: 'Ahmed', walletId: cash!.id, amountMinor: rs(5000), occurredAt: at('2026-10-02') });
    assert.equal(await repo.getLoanRemainingMinor(loan.id), rs(5000));
    assert.equal((await repo.getLoan(loan.id))?.status, 'open');

    await repo.recordRepayment({ loanId: loan.id, amountMinor: rs(1000), occurredAt: at('2026-10-03') });
    assert.equal(await repo.getLoanRemainingMinor(loan.id), rs(4000));
    assert.equal((await repo.getLoan(loan.id))?.status, 'partially_paid');

    await repo.recordRepayment({ loanId: loan.id, amountMinor: rs(1500), occurredAt: at('2026-10-04') });
    assert.equal(await repo.getLoanRemainingMinor(loan.id), rs(2500));

    await assert.rejects(() => repo.recordRepayment({ loanId: loan.id, amountMinor: rs(2501) }), /exceeds the remaining/);
    assert.equal(await repo.getLoanRemainingMinor(loan.id), rs(2500)); // unchanged after rejection

    await repo.recordRepayment({ loanId: loan.id, amountMinor: rs(2500), occurredAt: at('2026-10-05') });
    assert.equal(await repo.getLoanRemainingMinor(loan.id), 0);
    const settled = await repo.getLoan(loan.id);
    assert.equal(settled?.status, 'settled');
    assert.ok(settled?.settlementTransactionId);
    assert.equal((await repo.verifyIntegrity()).ok, true);
  });

  it('reversing a repayment restores the remaining balance and reopens the loan', async () => {
    const { repo } = makeRepo();
    const cash = await repo.getWalletByName('Cash');
    await repo.setOpeningBalance({ walletId: cash!.id, signedAmountMinor: rs(10000), occurredAt: at('2026-10-01') });
    const loan = await repo.lend({ personName: 'Ahmed', walletId: cash!.id, amountMinor: rs(5000), occurredAt: at('2026-10-02') });
    const repay = await repo.recordRepayment({ loanId: loan.id, amountMinor: rs(5000), occurredAt: at('2026-10-03') });
    assert.equal((await repo.getLoan(loan.id))?.status, 'settled');
    await repo.reverseTransaction(repay.transaction.id);
    assert.equal(await repo.getLoanRemainingMinor(loan.id), rs(5000));
    assert.equal((await repo.getLoan(loan.id))?.status, 'open');
    assert.equal((await repo.verifyIntegrity()).ok, true);
  });
});

describe('refunds, fees, adjustments', () => {
  it('refunds are not income; fees count as expenses; adjustments move cash only', async () => {
    const { repo } = makeRepo();
    const cash = await repo.getWalletByName('Cash');
    await repo.setOpeningBalance({ walletId: cash!.id, signedAmountMinor: rs(5000), occurredAt: at('2026-10-01') });
    await repo.addExpense({ walletId: cash!.id, amountMinor: rs(1000), occurredAt: at('2026-10-02') });
    await repo.addRefundReceived({ walletId: cash!.id, amountMinor: rs(250), occurredAt: at('2026-10-03') });
    await repo.addFee({ walletId: cash!.id, amountMinor: rs(100), occurredAt: at('2026-10-04') });
    await repo.adjustBalance({ walletId: cash!.id, signedAmountMinor: -rs(300), occurredAt: at('2026-10-05') });
    const dash = await repo.getDashboard(OCT);
    assert.equal(dash.availableCashMinor, rs(3850)); // 5000 -1000 +250 -100 -300
    assert.equal(dash.monthIncomeMinor, 0);
    assert.equal(dash.monthExpensesMinor, rs(1100));
    assert.equal(dash.monthNetCashFlowMinor, -rs(1150)); // -1000 +250 -100 -300
  });

  it('records negative wallet balances instead of inventing money', async () => {
    const { repo } = makeRepo();
    const cash = await repo.getWalletByName('Cash');
    await repo.setOpeningBalance({ walletId: cash!.id, signedAmountMinor: rs(100), occurredAt: at('2026-10-01') });
    await repo.addExpense({ walletId: cash!.id, amountMinor: rs(250), occurredAt: at('2026-10-02') });
    const dash = await repo.getDashboard(OCT);
    assert.equal(dash.availableCashMinor, -rs(150));
  });
});

describe('duplicate prevention and idempotency', () => {
  it('same idempotency key posts exactly once', async () => {
    const { repo } = makeRepo();
    const cash = await repo.getWalletByName('Cash');
    const first = await repo.addIncome({ walletId: cash!.id, amountMinor: rs(500), idempotencyKey: 'k-1', occurredAt: at('2026-10-02') });
    const second = await repo.addIncome({ walletId: cash!.id, amountMinor: rs(500), idempotencyKey: 'k-1', occurredAt: at('2026-10-02') });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.transaction.id, second.transaction.id);
    assert.equal((await repo.getDashboard(OCT)).availableCashMinor, rs(500));
  });

  it('external identity is unique per scope but reusable across scopes', async () => {
    const { repo } = makeRepo();
    const cash = await repo.getWalletByName('Cash');
    const ext = { scope: 'faysal:acct8588', identity: '366002' };
    const a = await repo.addExpense({ walletId: cash!.id, amountMinor: rs(76), externalIdentity: ext, occurredAt: at('2026-10-06') });
    const b = await repo.addExpense({ walletId: cash!.id, amountMinor: rs(76), externalIdentity: ext, occurredAt: at('2026-10-06') });
    assert.equal(a.created, true);
    assert.equal(b.created, false); // the same bank transaction can never post twice
    const c = await repo.addExpense({
      walletId: cash!.id, amountMinor: rs(76),
      externalIdentity: { scope: 'hbl:acct1234', identity: '366002' }, occurredAt: at('2026-10-06'),
    });
    assert.equal(c.created, true); // same reference number at another bank is a different transaction
    const d = await repo.addExpense({
      walletId: cash!.id, amountMinor: rs(76),
      externalIdentity: { scope: 'faysal:acct8588', identity: '366003' }, occurredAt: at('2026-10-06'),
    });
    assert.equal(d.created, true); // same amount + day, different reference: NOT a duplicate
    assert.equal((await repo.getDashboard(OCT)).monthExpensesMinor, rs(228));
  });

  it('observations are recorded exactly once per fingerprint', async () => {
    const { repo } = makeRepo();
    const a = await repo.recordObservation({ source: 'sms', fingerprint: 'fp-1' });
    const b = await repo.recordObservation({ source: 'sms', fingerprint: 'fp-1' });
    assert.equal(a.created, true);
    assert.equal(b.created, false);
    assert.equal(a.id, b.id);
  });
});

describe('atomicity', () => {
  it('a failure mid-operation rolls back the whole operation — no partial rows', async () => {
    const { repo, driver } = makeRepo();
    const cash = await repo.getWalletByName('Cash');
    await repo.setOpeningBalance({ walletId: cash!.id, signedAmountMinor: rs(1000), occurredAt: at('2026-10-01') });
    const revBefore = await repo.getLedgerRevision();
    const countBefore = (await repo.listTransactions({ includeReversed: true, limit: 500 })).length;

    // Fault injection: fail the second posting insert of the next operation.
    const originalRun = driver.run.bind(driver);
    let postingInserts = 0;
    driver.run = async (sql: string, params?: readonly unknown[]) => {
      if (sql.startsWith('INSERT INTO postings')) {
        postingInserts += 1;
        if (postingInserts === 2) throw new Error('injected failure');
      }
      return originalRun(sql, params);
    };
    await assert.rejects(() => repo.addExpense({ walletId: cash!.id, amountMinor: rs(100), occurredAt: at('2026-10-02') }), /injected failure/);
    driver.run = originalRun;

    const countAfter = (await repo.listTransactions({ includeReversed: true, limit: 500 })).length;
    assert.equal(countAfter, countBefore); // transaction row rolled back too
    assert.equal(await repo.getLedgerRevision(), revBefore);
    assert.equal((await repo.getDashboard(OCT)).availableCashMinor, rs(1000));
    assert.equal((await repo.verifyIntegrity()).ok, true);
  });

  it('rejects invalid amounts at the repository boundary', async () => {
    const { repo } = makeRepo();
    const cash = await repo.getWalletByName('Cash');
    await assert.rejects(() => repo.addIncome({ walletId: cash!.id, amountMinor: 0 }));
    await assert.rejects(() => repo.addExpense({ walletId: cash!.id, amountMinor: -100 }));
    await assert.rejects(() => repo.lend({ personName: 'Ahmed', walletId: cash!.id, amountMinor: 0 }));
    await assert.rejects(() => repo.transfer({ fromWalletId: cash!.id, toWalletId: cash!.id, amountMinor: rs(1) }));
  });
});

describe('schema-level enforcement (raw SQL cannot corrupt the ledger)', () => {
  it('CHECK constraints reject negative amounts, zero postings and bad classifications', async () => {
    const { repo, driver } = makeRepo();
    await repo.init();
    await assert.rejects(() =>
      driver.run(
        `INSERT INTO transactions (id, classification, status, amount_minor, occurred_at, local_date, origin, created_at, updated_at)
         VALUES ('bad-1', 'expense', 'posted', -500, 0, '2026-10-01', 'manual', 0, 0)`,
      ),
    );
    await assert.rejects(() =>
      driver.run(
        `INSERT INTO transactions (id, classification, status, amount_minor, occurred_at, local_date, origin, created_at, updated_at)
         VALUES ('bad-2', 'loot', 'posted', 500, 0, '2026-10-01', 'manual', 0, 0)`,
      ),
    );
    await assert.rejects(() =>
      driver.run(
        `INSERT INTO postings (id, transaction_id, account_id, amount_minor, created_at)
         VALUES ('bad-3', 'whatever', 'account:external', 0, 0)`,
      ),
    );
  });

  it('foreign keys are enforced', async () => {
    const { repo, driver } = makeRepo();
    await repo.init();
    await assert.rejects(() =>
      driver.run(
        `INSERT INTO postings (id, transaction_id, account_id, amount_minor, created_at)
         VALUES ('bad-fk', 'no-such-txn', 'account:external', 100, 0)`,
      ),
    );
  });
});

describe('reporting consistency', () => {
  it('repository dashboard equals the pure engine over raw postings', async () => {
    const { repo, driver } = makeRepo();
    const cash = await repo.getWalletByName('Cash');
    const jazz = await repo.getWalletByName('JazzCash');
    await repo.setOpeningBalance({ walletId: cash!.id, signedAmountMinor: rs(10000), occurredAt: at('2026-10-01') });
    await repo.addIncome({ walletId: jazz!.id, amountMinor: rs(2000), occurredAt: at('2026-10-02') });
    await repo.addExpense({ walletId: cash!.id, amountMinor: rs(2000), occurredAt: at('2026-10-02') });
    const loan = await repo.lend({ personName: 'Ahmed', walletId: cash!.id, amountMinor: rs(3000), occurredAt: at('2026-10-03') });
    await repo.borrow({ personName: 'Bilal', walletId: jazz!.id, amountMinor: rs(5000), occurredAt: at('2026-10-04') });
    await repo.recordRepayment({ loanId: loan.id, amountMinor: rs(1200), occurredAt: at('2026-10-05') });
    await repo.transfer({ fromWalletId: cash!.id, toWalletId: jazz!.id, amountMinor: rs(700), occurredAt: at('2026-10-06') });

    const rows = await driver.getAll<{ kind: 'wallet' | 'receivable' | 'payable' | 'external'; amount_minor: number }>(
      'SELECT a.kind AS kind, p.amount_minor AS amount_minor FROM postings p JOIN accounts a ON a.id = p.account_id',
    );
    const engineTotals = summarizePostings(rows.map((r) => ({ accountKind: r.kind, amountMinor: r.amount_minor })));
    const dash = await repo.getDashboard(OCT);
    assert.equal(dash.availableCashMinor, engineTotals.availableCashMinor);
    assert.equal(dash.receivablesMinor, engineTotals.receivablesMinor);
    assert.equal(dash.payablesMinor, engineTotals.payablesMinor);
    assert.equal(dash.netWorthMinor, engineTotals.netWorthMinor);
    assert.equal((await repo.verifyIntegrity()).ok, true);
  });

  it('monthly boundaries are respected and stats agree with the dashboard', async () => {
    const { repo } = makeRepo();
    const cash = await repo.getWalletByName('Cash');
    await repo.addIncome({ walletId: cash!.id, amountMinor: rs(1000), occurredAt: at('2026-09-30') });
    await repo.addIncome({ walletId: cash!.id, amountMinor: rs(2000), occurredAt: at('2026-10-01') });
    await repo.addExpense({ walletId: cash!.id, amountMinor: rs(300), occurredAt: at('2026-09-30') });
    await repo.addExpense({ walletId: cash!.id, amountMinor: rs(400), occurredAt: at('2026-10-01') });
    const sep = await repo.getDashboard('2026-09');
    const oct = await repo.getDashboard(OCT);
    assert.equal(sep.monthIncomeMinor, rs(1000));
    assert.equal(sep.monthExpensesMinor, rs(300));
    assert.equal(oct.monthIncomeMinor, rs(2000));
    assert.equal(oct.monthExpensesMinor, rs(400));
    const stats = await repo.getMonthlyStats(2, at('2026-10-15'));
    assert.deepEqual(stats.map((s) => s.month), ['2026-09', '2026-10']);
    assert.equal(stats[1].incomeMinor, oct.monthIncomeMinor);
    assert.equal(stats[1].expensesMinor, oct.monthExpensesMinor);
  });

  it('history is newest-first and reversals disappear from it', async () => {
    const { repo } = makeRepo();
    const cash = await repo.getWalletByName('Cash');
    await repo.addIncome({ walletId: cash!.id, amountMinor: rs(100), occurredAt: at('2026-10-01') });
    const middle = await repo.addExpense({ walletId: cash!.id, amountMinor: rs(40), occurredAt: at('2026-10-02') });
    await repo.addIncome({ walletId: cash!.id, amountMinor: rs(200), occurredAt: at('2026-10-03') });
    let history = await repo.listTransactions();
    assert.deepEqual(history.map((t) => t.amountMinor), [rs(200), rs(40), rs(100)]);
    await repo.reverseTransaction(middle.transaction.id);
    history = await repo.listTransactions();
    assert.deepEqual(history.map((t) => t.amountMinor), [rs(200), rs(100)]);
    await assert.rejects(() => repo.reverseTransaction(middle.transaction.id), /already reversed/);
    assert.equal((await repo.getDashboard(OCT)).availableCashMinor, rs(300));
  });

  it('per-person summaries use remaining balances, netted per person', async () => {
    const { repo } = makeRepo();
    const cash = await repo.getWalletByName('Cash');
    await repo.setOpeningBalance({ walletId: cash!.id, signedAmountMinor: rs(20000), occurredAt: at('2026-10-01') });
    const l1 = await repo.lend({ personName: 'Ahmed', walletId: cash!.id, amountMinor: rs(3000), occurredAt: at('2026-10-02') });
    await repo.borrow({ personName: 'Ahmed', walletId: cash!.id, amountMinor: rs(1000), occurredAt: at('2026-10-03') });
    await repo.recordRepayment({ loanId: l1.id, amountMinor: rs(1000), occurredAt: at('2026-10-04') });
    const summaries = await repo.getPersonSummaries();
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].person.name, 'Ahmed');
    assert.equal(summaries[0].lentMinor, rs(2000));
    assert.equal(summaries[0].borrowedMinor, rs(1000));
    assert.equal(summaries[0].netMinor, rs(1000));
    assert.equal(summaries[0].openCount, 2);
  });
});

describe('controlled reset', () => {
  it('refuses without the exact token, and with it clears ONLY v2 data and reseeds zero balances', async () => {
    const { repo } = makeRepo();
    const cash = await repo.getWalletByName('Cash');
    await repo.setOpeningBalance({ walletId: cash!.id, signedAmountMinor: rs(5000), occurredAt: at('2026-10-01') });
    await assert.rejects(() => repo.performControlledReset('yes'), /refused/);
    await assert.rejects(() => repo.performControlledReset(''), /refused/);
    assert.equal((await repo.getDashboard(OCT)).availableCashMinor, rs(5000)); // untouched

    await repo.performControlledReset(CONTROLLED_RESET_CONFIRMATION);
    const dash = await repo.getDashboard(OCT);
    assert.equal(dash.availableCashMinor, 0);
    assert.equal(dash.netWorthMinor, 0);
    assert.deepEqual(await repo.listTransactions({ includeReversed: true }), []);
    assert.deepEqual(await repo.listLoans(), []);
    const wallets = await repo.listWallets();
    assert.equal(wallets.length, 4);
    for (const w of wallets) assert.equal(w.balanceMinor, 0);
    assert.equal((await repo.verifyIntegrity()).ok, true);
  });
});

describe('legacy numeric ID mapping (facade support)', () => {
  it('assigns stable, distinct, remappable aliases', async () => {
    const { repo } = makeRepo();
    const a1 = await repo.legacyId('transaction', 'uuid-a');
    const a2 = await repo.legacyId('transaction', 'uuid-a');
    const b = await repo.legacyId('transaction', 'uuid-b');
    const loanA = await repo.legacyId('loan', 'uuid-a');
    assert.equal(a1, a2);
    assert.notEqual(a1, b);
    assert.equal(loanA, 1); // per-entity numbering
    assert.equal(await repo.refForLegacyId('transaction', a1), 'uuid-a');
    await repo.remapLegacyId('transaction', a1, 'uuid-a2');
    assert.equal(await repo.refForLegacyId('transaction', a1), 'uuid-a2');
  });
});
