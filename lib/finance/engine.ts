/**
 * Pure double-entry posting engine.
 *
 * Given a financial operation and the resolved account IDs, the planner
 * returns the transaction classification, the positive principal amount,
 * and the balanced postings. These functions are side-effect free and are
 * exercised directly by the automated test suite; the SQLite repository
 * persists exactly what the planner returns.
 */
import { assertMinor, MoneyError } from './money';
import type { AccountKind, Classification, Posting } from './types';
import { EXTERNAL_ACCOUNT_ID } from './schema';

export interface PostingSpec {
  accountId: string;
  accountKind: AccountKind;
  amountMinor: number;
}

export type Operation =
  | { kind: 'income'; walletAccountId: string; amountMinor: number }
  | { kind: 'expense'; walletAccountId: string; amountMinor: number }
  | { kind: 'fee'; walletAccountId: string; amountMinor: number }
  | { kind: 'refund_received'; walletAccountId: string; amountMinor: number }
  | { kind: 'refund_issued'; walletAccountId: string; amountMinor: number }
  | { kind: 'transfer'; fromWalletAccountId: string; toWalletAccountId: string; amountMinor: number }
  | { kind: 'loan_lent'; walletAccountId: string; loanAccountId: string; amountMinor: number }
  | { kind: 'loan_borrowed'; walletAccountId: string; loanAccountId: string; amountMinor: number }
  | { kind: 'repayment_received'; walletAccountId: string; loanAccountId: string; amountMinor: number }
  | { kind: 'repayment_made'; walletAccountId: string; loanAccountId: string; amountMinor: number }
  | { kind: 'opening_balance'; walletAccountId: string; signedAmountMinor: number }
  | { kind: 'balance_adjustment'; walletAccountId: string; signedAmountMinor: number };

const CLASSIFICATION: Record<Operation['kind'], Classification> = {
  income: 'income',
  expense: 'expense',
  fee: 'fee',
  refund_received: 'refund_received',
  refund_issued: 'refund_issued',
  transfer: 'transfer',
  loan_lent: 'loan_lent',
  loan_borrowed: 'loan_borrowed',
  repayment_received: 'repayment_received',
  repayment_made: 'repayment_made',
  opening_balance: 'opening_balance',
  balance_adjustment: 'balance_adjustment',
};

function wallet(id: string, amountMinor: number): PostingSpec {
  return { accountId: id, accountKind: 'wallet', amountMinor };
}

/** A transaction principal must be a positive integer number of paisa. */
function positivePrincipal(value: number): number {
  const a = assertMinor(value, { field: 'amount' });
  if (a <= 0) throw new MoneyError('Amount must be more than zero.');
  return a;
}
function external(amountMinor: number): PostingSpec {
  return { accountId: EXTERNAL_ACCOUNT_ID, accountKind: 'external', amountMinor };
}
function loanAccount(id: string, kind: 'receivable' | 'payable', amountMinor: number): PostingSpec {
  return { accountId: id, accountKind: kind, amountMinor };
}

export interface PlannedTransaction {
  classification: Classification;
  /** Positive principal in paisa. */
  amountMinor: number;
  postings: PostingSpec[];
}

/**
 * Plan the postings for an operation. Throws MoneyError on any invalid
 * input. The returned postings always sum to exactly zero.
 */
export function planPostings(op: Operation): PlannedTransaction {
  let postings: PostingSpec[];
  let principal: number;

  switch (op.kind) {
    case 'income': {
      const a = positivePrincipal(op.amountMinor);
      postings = [wallet(op.walletAccountId, a), external(-a)];
      principal = a;
      break;
    }
    case 'expense':
    case 'fee': {
      const a = positivePrincipal(op.amountMinor);
      postings = [wallet(op.walletAccountId, -a), external(a)];
      principal = a;
      break;
    }
    case 'refund_received': {
      const a = positivePrincipal(op.amountMinor);
      postings = [wallet(op.walletAccountId, a), external(-a)];
      principal = a;
      break;
    }
    case 'refund_issued': {
      const a = positivePrincipal(op.amountMinor);
      postings = [wallet(op.walletAccountId, -a), external(a)];
      principal = a;
      break;
    }
    case 'transfer': {
      const a = positivePrincipal(op.amountMinor);
      if (op.fromWalletAccountId === op.toWalletAccountId) {
        throw new MoneyError('A transfer needs two different wallets.');
      }
      postings = [wallet(op.fromWalletAccountId, -a), wallet(op.toWalletAccountId, a)];
      principal = a;
      break;
    }
    case 'loan_lent': {
      const a = positivePrincipal(op.amountMinor);
      postings = [wallet(op.walletAccountId, -a), loanAccount(op.loanAccountId, 'receivable', a)];
      principal = a;
      break;
    }
    case 'loan_borrowed': {
      const a = positivePrincipal(op.amountMinor);
      // Payable is credit-normal: borrowing posts negative to the payable
      // account so its balance (-SUM) rises.
      postings = [wallet(op.walletAccountId, a), loanAccount(op.loanAccountId, 'payable', -a)];
      principal = a;
      break;
    }
    case 'repayment_received': {
      const a = positivePrincipal(op.amountMinor);
      postings = [wallet(op.walletAccountId, a), loanAccount(op.loanAccountId, 'receivable', -a)];
      principal = a;
      break;
    }
    case 'repayment_made': {
      const a = positivePrincipal(op.amountMinor);
      postings = [wallet(op.walletAccountId, -a), loanAccount(op.loanAccountId, 'payable', a)];
      principal = a;
      break;
    }
    case 'opening_balance':
    case 'balance_adjustment': {
      const d = assertMinor(op.signedAmountMinor, { field: 'signedAmountMinor' });
      if (d > 0) postings = [wallet(op.walletAccountId, d), external(-d)];
      else postings = [wallet(op.walletAccountId, d), external(-d)];
      principal = Math.abs(d);
      break;
    }
    default: {
      const _exhaustive: never = op;
      throw new MoneyError(`Unknown operation: ${JSON.stringify(_exhaustive)}`);
    }
  }

  assertBalanced(postings);
  return { classification: CLASSIFICATION[op.kind], amountMinor: principal, postings };
}

/** Verify that a set of postings sums to exactly zero paisa. */
export function assertBalanced(postings: readonly PostingSpec[]): void {
  let sum = 0;
  for (const p of postings) {
    assertMinor(p.amountMinor, { field: 'posting amount' });
    sum += p.amountMinor;
  }
  if (sum !== 0) throw new MoneyError(`Postings are not balanced (sum = ${sum} paisa).`);
}

/** Reverse a set of postings (negate every amount). Used for corrections. */
export function reversePostings(postings: readonly PostingSpec[]): PostingSpec[] {
  return postings.map((p) => ({ ...p, amountMinor: -p.amountMinor }));
}

/* ------------------------------------------------------------------ */
/* Balance mathematics over posting rows (pure; mirrors the SQL        */
/* reporting in the repository and is cross-checked against it in      */
/* tests).                                                             */
/* ------------------------------------------------------------------ */

export interface AccountTotals {
  availableCashMinor: number;
  receivablesMinor: number;
  payablesMinor: number;
  netWorthMinor: number;
}

export function summarizePostings(postings: readonly Pick<Posting, 'accountKind' | 'amountMinor'>[]): AccountTotals {
  let cash = 0;
  let receivables = 0;
  let payableSum = 0;
  for (const p of postings) {
    if (p.accountKind === 'wallet') cash += p.amountMinor;
    else if (p.accountKind === 'receivable') receivables += p.amountMinor;
    else if (p.accountKind === 'payable') payableSum += p.amountMinor;
  }
  const payables = -payableSum;
  return {
    availableCashMinor: cash,
    receivablesMinor: receivables,
    payablesMinor: payables,
    netWorthMinor: cash + receivables - payables,
  };
}

/** Remaining balance of one loan from its account postings. */
export function loanRemainingMinor(
  direction: 'lent' | 'borrowed',
  postings: readonly Pick<Posting, 'amountMinor'>[],
): number {
  let sum = 0;
  for (const p of postings) sum += p.amountMinor;
  return direction === 'lent' ? sum : -sum;
}

/** Classifications counted as monthly income. Repayments/refunds/loans are NOT income. */
export const INCOME_CLASSIFICATIONS: readonly string[] = ['income'];
/** Classifications counted as monthly expenses. Fees are expenses. */
export const EXPENSE_CLASSIFICATIONS: readonly string[] = ['expense', 'fee'];
