/**
 * Domain types for the PocketHisaab v2 ledger.
 *
 * Accounting model (strict double-entry):
 * - Every posted transaction owns two or more postings.
 * - The postings of one transaction always sum to exactly zero (paisa).
 * - Account kinds:
 *   - wallet      (asset, debit-normal)     balance =  SUM(postings)
 *   - receivable  (asset, debit-normal)     balance =  SUM(postings)
 *   - payable     (liability, credit-normal) balance = -SUM(postings)
 *   - external    (outside world / equity)  not part of net worth
 * - Net worth = sum(wallet balances) + sum(receivables) - sum(payables).
 */

export type Classification =
  | 'income'
  | 'expense'
  | 'fee'
  | 'transfer'
  | 'loan_lent'
  | 'loan_borrowed'
  | 'repayment_received'
  | 'repayment_made'
  | 'refund_received'
  | 'refund_issued'
  | 'balance_adjustment'
  | 'opening_balance';

export type TransactionStatus = 'posted' | 'pending' | 'failed' | 'reversed';
export type TransactionOrigin = 'manual' | 'auto' | 'import' | 'system';
export type AccountKind = 'wallet' | 'receivable' | 'payable' | 'external';
export type WalletKind = 'cash' | 'mobile' | 'bank' | 'custom';
export type LoanDirection = 'lent' | 'borrowed';
export type LoanStatus = 'open' | 'partially_paid' | 'settled' | 'void';

export interface Wallet {
  id: string;
  name: string;
  kind: WalletKind;
  icon: string | null;
  color: string | null;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Person {
  id: string;
  name: string;
  phone: string | null;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Category {
  id: string;
  name: string;
  kind: 'income' | 'expense' | 'both';
  icon: string | null;
  color: string | null;
  archived: boolean;
  system: boolean;
}

export interface Transaction {
  id: string;
  classification: Classification;
  status: TransactionStatus;
  /** Principal amount in paisa, always positive. Direction lives in postings. */
  amountMinor: number;
  currency: 'PKR';
  categoryId: string | null;
  personId: string | null;
  loanId: string | null;
  counterparty: string | null;
  note: string | null;
  reference: string | null;
  /** Epoch milliseconds when the transaction occurred. */
  occurredAt: number;
  /** Local calendar date (YYYY-MM-DD) used for monthly reporting. */
  localDate: string;
  origin: TransactionOrigin;
  idempotencyKey: string | null;
  reversesTransactionId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Posting {
  id: string;
  transactionId: string;
  accountId: string;
  accountKind: AccountKind;
  /** Signed paisa. See the accounting model above. */
  amountMinor: number;
  createdAt: number;
}

export interface Loan {
  id: string;
  personId: string;
  personName: string;
  direction: LoanDirection;
  principalMinor: number;
  walletId: string;
  principalTransactionId: string;
  settlementTransactionId: string | null;
  occurredAt: number;
  localDate: string;
  dueDate: string | null;
  reminderDate: string | null;
  note: string | null;
  status: LoanStatus;
  createdAt: number;
  updatedAt: number;
}

export type ImportSource = 'sms' | 'notification' | 'statement' | 'manual' | 'share' | 'paste';
export type ImportStatus = 'new' | 'needs_review' | 'imported' | 'ignored' | 'duplicate';
export type ParseStatus = 'completed' | 'pending' | 'failed';

export interface ImportObservation {
  id: string;
  source: ImportSource;
  fingerprint: string;
  institution: string | null;
  externalScope: string | null;
  externalIdentity: string | null;
  status: ImportStatus;
  transactionId: string | null;
  amountMinor: number | null;
  direction: 'in' | 'out' | null;
  counterparty: string | null;
  reference: string | null;
  occurredAt: number;
  localDate: string | null;
  suggestedClassification: Classification | null;
  suggestedWalletId: string | null;
  suggestedCategoryId: string | null;
  /** 0–100 import confidence score (not money). */
  confidencePct: number;
  parseStatus: ParseStatus;
  /** Why this needs review / was marked duplicate. */
  reason: string | null;
  candidateTransactionId: string | null;
  candidateObservationId: string | null;
  /** Short sanitized excerpt for the inbox UI (never a full message body). */
  excerpt: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface DashboardSummaryV2 {
  /** Sum of all active wallet balances (paisa). */
  availableCashMinor: number;
  /** Outstanding amounts other people owe the user (paisa). */
  receivablesMinor: number;
  /** Outstanding amounts the user owes other people (paisa). */
  payablesMinor: number;
  /** availableCash + receivables - payables (paisa). */
  netWorthMinor: number;
  monthIncomeMinor: number;
  monthExpensesMinor: number;
  /** income - expenses for the month (loans/transfers/adjustments excluded). */
  monthNetMinor: number;
  /** All external inflows - all external outflows for the month. */
  monthNetCashFlowMinor: number;
  /** Current ledger revision: increments on every committed change. */
  ledgerRevision: number;
}

export interface MonthlyStatV2 {
  month: string; // YYYY-MM
  incomeMinor: number;
  expensesMinor: number;
  netCashFlowMinor: number;
}

/* ------------------------------------------------------------------ */
/* Infrastructure interfaces (implemented by the Expo driver in the   */
/* app and by a node:sqlite driver in tests — same repository code).  */
/* ------------------------------------------------------------------ */

export interface SqlDriver {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: readonly unknown[]): Promise<{ changes: number; lastInsertRowId: number }>;
  getAll<T>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  getFirst<T>(sql: string, params?: readonly unknown[]): Promise<T | null>;
  /** Run fn inside a database transaction; roll back on any throw. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

/**
 * Field protection for identity-bearing text (person names, notes,
 * counterparties). The app implementation uses the existing AES field
 * encryption; find-or-create lookups use the deterministic keyed hash.
 */
export interface TextProtector {
  encrypt(plain: string | null): Promise<string | null>;
  decrypt(cipher: string | null): Promise<string | null>;
  /** Deterministic lookup key for a normalized person name. */
  personKey(normalizedName: string): Promise<string>;
}

export type IdGenerator = () => string;
