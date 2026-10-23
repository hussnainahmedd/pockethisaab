import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loanRemainingMinor, planPostings, reversePostings, summarizePostings } from '../../lib/finance/engine';
import { MoneyError } from '../../lib/finance/money';
import { rs } from './helpers';

const W1 = 'account:wallet:w1';
const W2 = 'account:wallet:w2';
const LOAN = 'account:loan:l1';
const EXT = 'account:external';

describe('planPostings', () => {
  it('balances every operation kind to exactly zero', () => {
    const ops = [
      { kind: 'income', walletAccountId: W1, amountMinor: rs(100) },
      { kind: 'expense', walletAccountId: W1, amountMinor: rs(100) },
      { kind: 'fee', walletAccountId: W1, amountMinor: rs(100) },
      { kind: 'refund_received', walletAccountId: W1, amountMinor: rs(100) },
      { kind: 'refund_issued', walletAccountId: W1, amountMinor: rs(100) },
      { kind: 'transfer', fromWalletAccountId: W1, toWalletAccountId: W2, amountMinor: rs(100) },
      { kind: 'loan_lent', walletAccountId: W1, loanAccountId: LOAN, amountMinor: rs(100) },
      { kind: 'loan_borrowed', walletAccountId: W1, loanAccountId: LOAN, amountMinor: rs(100) },
      { kind: 'repayment_received', walletAccountId: W1, loanAccountId: LOAN, amountMinor: rs(100) },
      { kind: 'repayment_made', walletAccountId: W1, loanAccountId: LOAN, amountMinor: rs(100) },
      { kind: 'opening_balance', walletAccountId: W1, signedAmountMinor: rs(100) },
      { kind: 'opening_balance', walletAccountId: W1, signedAmountMinor: -rs(100) },
      { kind: 'balance_adjustment', walletAccountId: W1, signedAmountMinor: -rs(100) },
    ] as const;
    for (const op of ops) {
      const planned = planPostings(op);
      const sum = planned.postings.reduce((a, p) => a + p.amountMinor, 0);
      assert.equal(sum, 0, `${op.kind} must balance`);
      assert.ok(planned.postings.length >= 2);
      assert.ok(planned.amountMinor > 0);
    }
  });

  it('rejects zero/negative principals and same-wallet transfers', () => {
    assert.throws(() => planPostings({ kind: 'income', walletAccountId: W1, amountMinor: 0 }), MoneyError);
    assert.throws(() => planPostings({ kind: 'expense', walletAccountId: W1, amountMinor: -5 }), MoneyError);
    assert.throws(
      () => planPostings({ kind: 'transfer', fromWalletAccountId: W1, toWalletAccountId: W1, amountMinor: rs(1) }),
      MoneyError,
    );
    assert.throws(() => planPostings({ kind: 'balance_adjustment', walletAccountId: W1, signedAmountMinor: 0 }), MoneyError);
  });

  it('borrowing posts credit-normal to the payable account', () => {
    const planned = planPostings({ kind: 'loan_borrowed', walletAccountId: W1, loanAccountId: LOAN, amountMinor: rs(5000) });
    const walletPosting = planned.postings.find((p) => p.accountKind === 'wallet');
    const payablePosting = planned.postings.find((p) => p.accountKind === 'payable');
    assert.equal(walletPosting?.amountMinor, rs(5000)); // cash increases
    assert.equal(payablePosting?.amountMinor, -rs(5000)); // balance = -SUM -> +5,000 owed
  });
});

describe('balance mathematics', () => {
  it('summarizePostings: borrowed money raises cash, not net worth', () => {
    const postings = [
      { accountKind: 'wallet' as const, amountMinor: rs(10000) },
      { accountKind: 'external' as const, amountMinor: -rs(10000) },
      { accountKind: 'wallet' as const, amountMinor: rs(5000) },
      { accountKind: 'payable' as const, amountMinor: -rs(5000) },
    ];
    const totals = summarizePostings(postings);
    assert.equal(totals.availableCashMinor, rs(15000));
    assert.equal(totals.payablesMinor, rs(5000));
    assert.equal(totals.netWorthMinor, rs(10000));
  });

  it('loanRemainingMinor respects direction', () => {
    const lentPostings = [{ amountMinor: rs(3000) }, { amountMinor: -rs(1000) }];
    assert.equal(loanRemainingMinor('lent', lentPostings), rs(2000));
    const borrowedPostings = [{ amountMinor: -rs(3000) }, { amountMinor: rs(1000) }];
    assert.equal(loanRemainingMinor('borrowed', borrowedPostings), rs(2000));
  });

  it('reversePostings negates every posting and stays balanced', () => {
    const planned = planPostings({ kind: 'expense', walletAccountId: W1, amountMinor: rs(42) });
    const reversed = reversePostings(planned.postings);
    assert.equal(reversed.reduce((a, p) => a + p.amountMinor, 0), 0);
    assert.equal(reversed.find((p) => p.accountId === EXT)?.amountMinor, -rs(42));
    assert.equal(reversed.find((p) => p.accountId === W1)?.amountMinor, rs(42));
  });
});
