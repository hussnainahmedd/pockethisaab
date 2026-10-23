import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildPersonStatementCsv, buildPersonStatementText } from '../../lib/finance/statement';
import { at, makeRepo, rs } from './helpers';

async function setup() {
  const ctx = makeRepo();
  const cash = await ctx.repo.getWalletByName('Cash');
  await ctx.repo.setOpeningBalance({ walletId: cash!.id, signedAmountMinor: rs(50000), occurredAt: at('2026-10-01') });
  return { ...ctx, cash: cash! };
}

describe('advanced udhaar', () => {
  it('keeps multiple loans per person separate with independent remaining balances', async () => {
    const { repo, cash } = await setup();
    const l1 = await repo.lend({ personName: 'Ahmed', walletId: cash.id, amountMinor: rs(5000), occurredAt: at('2026-10-02') });
    const l2 = await repo.lend({ personName: 'Ahmed', walletId: cash.id, amountMinor: rs(2000), occurredAt: at('2026-10-05') });
    await repo.recordRepayment({ loanId: l1.id, amountMinor: rs(1000), occurredAt: at('2026-10-06') });
    assert.equal(await repo.getLoanRemainingMinor(l1.id), rs(4000));
    assert.equal(await repo.getLoanRemainingMinor(l2.id), rs(2000));
    const detail = await repo.getLoanDetail(l1.id);
    assert.equal(detail.totalRepaidMinor, rs(1000));
    assert.equal(detail.repayments.length, 1);
    const summaries = await repo.getPersonSummaries();
    assert.equal(summaries[0].lentMinor, rs(6000));
    assert.equal(summaries[0].openCount, 2);
  });

  it('edits a repayment amount up or down within the remaining balance, atomically', async () => {
    const { repo, cash } = await setup();
    const loan = await repo.lend({ personName: 'Ahmed', walletId: cash.id, amountMinor: rs(5000), occurredAt: at('2026-10-02') });
    const repay = await repo.recordRepayment({ loanId: loan.id, amountMinor: rs(1000), occurredAt: at('2026-10-03') });
    const edited = await repo.editRepayment(repay.transaction.id, { amountMinor: rs(1800) });
    assert.equal(edited.transaction.amountMinor, rs(1800));
    assert.equal(await repo.getLoanRemainingMinor(loan.id), rs(3200));
    assert.equal((await repo.getTransaction(repay.transaction.id))?.status, 'reversed');

    // Growing beyond the post-reversal remaining balance is rejected and changes nothing.
    await assert.rejects(() => repo.editRepayment(edited.transaction.id, { amountMinor: rs(5001) }), /exceeds the remaining/);
    assert.equal(await repo.getLoanRemainingMinor(loan.id), rs(3200));
    assert.equal((await repo.verifyIntegrity()).ok, true);
  });

  it('edits loan principal down to the repaid amount but never below it', async () => {
    const { repo, cash } = await setup();
    const loan = await repo.lend({ personName: 'Ahmed', walletId: cash.id, amountMinor: rs(5000), occurredAt: at('2026-10-02') });
    await repo.recordRepayment({ loanId: loan.id, amountMinor: rs(2000), occurredAt: at('2026-10-03') });
    await assert.rejects(() => repo.updateLoan(loan.id, { principalMinor: rs(1500) }), /already repaid/);
    const updated = await repo.updateLoan(loan.id, { principalMinor: rs(2000) });
    assert.equal(updated.principalMinor, rs(2000));
    assert.equal(await repo.getLoanRemainingMinor(loan.id), 0);
    assert.equal((await repo.getLoan(loan.id))?.status, 'settled');
    assert.equal((await repo.verifyIntegrity()).ok, true);
  });

  it('edits loan due date, note and wallet; wallet move shifts the cash effect', async () => {
    const { repo, cash } = await setup();
    const jazz = await repo.getWalletByName('JazzCash');
    await repo.setOpeningBalance({ walletId: jazz!.id, signedAmountMinor: rs(10000), occurredAt: at('2026-10-01') });
    const loan = await repo.lend({ personName: 'Ahmed', walletId: cash.id, amountMinor: rs(3000), occurredAt: at('2026-10-02') });
    const updated = await repo.updateLoan(loan.id, { dueDate: '2026-11-01', note: 'For books', walletId: jazz!.id });
    assert.equal(updated.dueDate, '2026-11-01');
    assert.equal(updated.note, 'For books');
    assert.equal(updated.walletId, jazz!.id);
    const wallets = await repo.listWallets();
    assert.equal(wallets.find((w) => w.name === 'Cash')?.balanceMinor, rs(50000));
    assert.equal(wallets.find((w) => w.name === 'JazzCash')?.balanceMinor, rs(7000));
    assert.equal(await repo.getLoanRemainingMinor(loan.id), rs(3000));
  });

  it('calculates overdue from the due date and remaining balance', async () => {
    const { repo, cash, setClock } = await setup();
    const loan = await repo.lend({
      personName: 'Ahmed', walletId: cash.id, amountMinor: rs(3000),
      occurredAt: at('2026-10-02'), dueDate: '2026-10-10',
    });
    // Clock is 2026-10-15 in the harness: 5 days past due.
    const detail = await repo.getLoanDetail(loan.id);
    assert.equal(detail.overdue, true);
    assert.equal(detail.daysOverdue, 5);

    await repo.recordRepayment({ loanId: loan.id, amountMinor: rs(3000), occurredAt: at('2026-10-15') });
    const settled = await repo.getLoanDetail(loan.id);
    assert.equal(settled.overdue, false);

    // A loan due in the future is not overdue.
    const future = await repo.lend({
      personName: 'Bilal', walletId: cash.id, amountMinor: rs(1000),
      occurredAt: at('2026-10-15'), dueDate: '2026-12-01',
    });
    assert.equal((await repo.getLoanDetail(future.id)).overdue, false);
    setClock(at('2026-12-05'));
    assert.equal((await repo.getLoanDetail(future.id)).daysOverdue, 4);
  });

  it('sets and clears loan reminders', async () => {
    const { repo, cash } = await setup();
    const loan = await repo.lend({ personName: 'Ahmed', walletId: cash.id, amountMinor: rs(1000), occurredAt: at('2026-10-02'), dueDate: '2026-10-20' });
    await repo.setLoanReminder(loan.id, '2026-10-18');
    assert.equal((await repo.getLoan(loan.id))?.reminderDate, '2026-10-18');
    await repo.setLoanReminder(loan.id, null);
    assert.equal((await repo.getLoan(loan.id))?.reminderDate, null);
  });

  it('deleting then restoring a loan reinstates principal and repayments exactly', async () => {
    const { repo, cash } = await setup();
    const loan = await repo.lend({ personName: 'Ahmed', walletId: cash.id, amountMinor: rs(5000), occurredAt: at('2026-10-02') });
    await repo.recordRepayment({ loanId: loan.id, amountMinor: rs(1000), occurredAt: at('2026-10-03') });
    await repo.recordRepayment({ loanId: loan.id, amountMinor: rs(1500), occurredAt: at('2026-10-04') });
    await repo.voidLoan(loan.id);
    assert.equal((await repo.getLoan(loan.id))?.status, 'void');
    let dash = await repo.getDashboard('2026-10');
    assert.equal(dash.receivablesMinor, 0);
    assert.equal(dash.availableCashMinor, rs(50000));

    const restored = await repo.restoreLoan(loan.id);
    assert.equal(restored.status, 'partially_paid');
    assert.equal(await repo.getLoanRemainingMinor(loan.id), rs(2500));
    dash = await repo.getDashboard('2026-10');
    assert.equal(dash.receivablesMinor, rs(2500));
    assert.equal(dash.availableCashMinor, rs(47500));
    const detail = await repo.getLoanDetail(loan.id);
    assert.equal(detail.repayments.filter((r) => r.status === 'posted').length, 2);
    assert.equal((await repo.verifyIntegrity()).ok, true);
  });

  it('a repayment reversed independently before a void is NOT resurrected by restore', async () => {
    const { repo, cash } = await setup();
    const loan = await repo.lend({ personName: 'Ahmed', walletId: cash.id, amountMinor: rs(5000), occurredAt: at('2026-10-02') });
    const r1 = await repo.recordRepayment({ loanId: loan.id, amountMinor: rs(1000), occurredAt: at('2026-10-03') });
    await repo.recordRepayment({ loanId: loan.id, amountMinor: rs(1500), occurredAt: at('2026-10-04') });
    await repo.reverseTransaction(r1.transaction.id, { note: 'Wrong entry' });
    assert.equal(await repo.getLoanRemainingMinor(loan.id), rs(3500));
    await repo.voidLoan(loan.id);
    await repo.restoreLoan(loan.id);
    // Only the Rs 1,500 repayment (reversed by the void) comes back.
    assert.equal(await repo.getLoanRemainingMinor(loan.id), rs(3500));
  });

  it('produces a correct person statement (data, text and CSV)', async () => {
    const { repo, cash } = await setup();
    const ahmed = await repo.findOrCreatePerson('Ahmed');
    const l1 = await repo.lend({ personName: 'Ahmed', walletId: cash.id, amountMinor: rs(5000), occurredAt: at('2026-10-02'), dueDate: '2026-11-02' });
    await repo.borrow({ personName: 'Ahmed', walletId: cash.id, amountMinor: rs(1000), occurredAt: at('2026-10-03') });
    await repo.recordRepayment({ loanId: l1.id, amountMinor: rs(2000), occurredAt: at('2026-10-04') });

    const data = await repo.getPersonStatementData(ahmed.id);
    assert.equal(data.totalLentMinor, rs(5000));
    assert.equal(data.totalBorrowedMinor, rs(1000));
    assert.equal(data.totalRepaidMinor, rs(2000));
    assert.equal(data.remainingReceivableMinor, rs(3000));
    assert.equal(data.remainingPayableMinor, rs(1000));

    const text = buildPersonStatementText(
      {
        personName: data.person.name,
        loans: data.loans.map((d) => ({
          direction: d.loan.direction, principalMinor: d.loan.principalMinor,
          repaidMinor: d.repaidMinor, remainingMinor: d.remainingMinor,
          status: d.loan.status, localDate: d.loan.localDate, dueDate: d.loan.dueDate, note: d.loan.note,
        })),
        totalLentMinor: data.totalLentMinor, totalBorrowedMinor: data.totalBorrowedMinor,
        totalRepaidMinor: data.totalRepaidMinor,
        remainingReceivableMinor: data.remainingReceivableMinor,
        remainingPayableMinor: data.remainingPayableMinor,
      },
      '2026-10-15',
    );
    assert.ok(text.includes('Ahmed'));
    assert.ok(text.includes('They still owe you: Rs 3,000'));
    assert.ok(text.includes('You still owe them: Rs 1,000'));

    const csv = buildPersonStatementCsv({
      personName: data.person.name,
      loans: data.loans.map((d) => ({
        direction: d.loan.direction, principalMinor: d.loan.principalMinor,
        repaidMinor: d.repaidMinor, remainingMinor: d.remainingMinor,
        status: d.loan.status, localDate: d.loan.localDate, dueDate: d.loan.dueDate, note: d.loan.note,
      })),
      totalLentMinor: data.totalLentMinor, totalBorrowedMinor: data.totalBorrowedMinor,
      totalRepaidMinor: data.totalRepaidMinor,
      remainingReceivableMinor: data.remainingReceivableMinor,
      remainingPayableMinor: data.remainingPayableMinor,
    });
    assert.ok(csv.includes('Remaining receivable (PKR),3000.00'));
    assert.ok(csv.includes('lent,5000.00,2000.00,3000.00'));
  });
});
