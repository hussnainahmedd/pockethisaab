/**
 * PocketHisaab data layer — v2 compatibility facade.
 *
 * Screens built for v1 keep importing this module with the same function
 * signatures, but every financial read and write now runs on the v2
 * double-entry ledger (lib/finance):
 *
 * - Amounts cross this boundary in rupees (legacy UI convention) and are
 *   converted to integer paisa immediately; nothing inside the ledger
 *   uses floats.
 * - Deletes and edits are append-only REVERSALS in the ledger; history
 *   is never destroyed.
 * - Dashboard "balance" is now true net worth (cash + receivables -
 *   payables) computed by the single reporting service every screen
 *   shares, so Home, Expenses and Stats can no longer disagree.
 * - v1 numeric IDs are durable aliases for v2 UUIDs (legacy_refs), so
 *   edit screens that pass IDs through route params keep working.
 * - App meta (update prompts, auto-fetch settings/dedup) still lives in
 *   the legacy store; the legacy FINANCIAL tables are no longer read or
 *   written. The legacy database file itself is never deleted by this
 *   module — discarding it is a separate owner-approved procedure.
 */
import { localMonthPrefix } from './format';
import { getLedger } from './finance/appLedger';
import { minorToRupees, rupeesToMinor } from './finance/money';
import { monthPrefixOfDate } from './finance/repository';
import type { Loan, Transaction } from './finance/types';
import {
  CATEGORIES,
  INCOME_SOURCES,
  categoryLabel,
  getDb,
  getMetaValue,
  hasSeenAutofetch,
  initDatabase as initLegacyDatabase,
  markAutofetchSeen,
  purgeLegacyRecordsOnce,
  setMetaValue,
  type ActivityItem,
  type CategoryKey,
  type DashboardSummary,
  type Expense,
  type Income,
  type PersonSummary,
  type UdhaarDirection,
  type UdhaarEntry,
} from './legacyDb';

export {
  CATEGORIES,
  INCOME_SOURCES,
  categoryLabel,
  getDb,
  getMetaValue,
  hasSeenAutofetch,
  markAutofetchSeen,
  setMetaValue,
};
export type {
  ActivityItem,
  CategoryKey,
  DashboardSummary,
  Expense,
  Income,
  PersonSummary,
  UdhaarDirection,
  UdhaarEntry,
};
export { categoryEmoji } from './legacyDb';

/* ------------------------------------------------------------------ */
/* Init: legacy meta store (settings/update state) + v2 ledger.        */
/* The v2 ledger starts empty by design; on the first v2 launch the    */
/* legacy v1 record tables are purged (owner's fresh-start directive)  */
/* — the purge is fail-safe and never blocks startup.                  */
/* ------------------------------------------------------------------ */

export async function initDatabase(): Promise<void> {
  await initLegacyDatabase();
  await purgeLegacyRecordsOnce();
  await getLedger().init();
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const ledger = () => getLedger();

/** Local date (YYYY-MM-DD) at noon — avoids timezone edges at midnight. */
function dateToMs(date: string): number {
  return new Date(`${date}T12:00:00`).getTime();
}

function categoryKeyForName(name: string | null | undefined): string {
  if (!name) return 'other';
  const found = CATEGORIES.find((c) => c.label.toLowerCase() === name.toLowerCase());
  return found?.key ?? 'other';
}

async function expenseCategoryId(categoryKey: string): Promise<string | null> {
  const cat = CATEGORIES.find((c) => c.key === categoryKey);
  const label = cat?.label ?? categoryLabel(categoryKey);
  const found = await ledger().getCategoryByName(label, 'expense');
  return found?.id ?? null;
}

async function incomeCategoryId(source: string): Promise<string | null> {
  const label = source === 'Other' ? 'Other Income' : source;
  const found = await ledger().getCategoryByName(label, 'income');
  return found?.id ?? null;
}

async function categoryName(categoryId: string | null): Promise<string | null> {
  if (!categoryId) return null;
  const cats = await ledger().listCategories();
  return cats.find((c) => c.id === categoryId)?.name ?? null;
}

function asOrigin(origin: string): 'manual' | 'auto' {
  return origin === 'auto' ? 'auto' : 'manual';
}

async function txnToExpense(t: Transaction): Promise<Expense> {
  return {
    id: await ledger().legacyId('transaction', t.id),
    amount: minorToRupees(t.amountMinor),
    category: categoryKeyForName(await categoryName(t.categoryId)),
    note: t.note,
    date: t.localDate,
    origin: t.origin,
  };
}

async function txnToIncome(t: Transaction): Promise<Income> {
  const name = await categoryName(t.categoryId);
  return {
    id: await ledger().legacyId('transaction', t.id),
    amount: minorToRupees(t.amountMinor),
    source: name ?? t.counterparty ?? 'Other',
    note: t.note,
    date: t.localDate,
    origin: t.origin,
  };
}

async function loanToEntry(loan: Loan): Promise<UdhaarEntry> {
  return {
    id: await ledger().legacyId('loan', loan.id),
    person: loan.personName,
    amount: minorToRupees(loan.principalMinor),
    direction: loan.direction,
    note: loan.note,
    date: loan.localDate,
    settled: loan.status === 'settled' ? 1 : 0,
  };
}

async function resolveTxnId(legacyId: number): Promise<string> {
  const id = await ledger().refForLegacyId('transaction', legacyId);
  if (!id) throw new Error('Entry not found.');
  return id;
}

async function resolveLoanId(legacyId: number): Promise<string> {
  const id = await ledger().refForLegacyId('loan', legacyId);
  if (!id) throw new Error('Udhaar entry not found.');
  return id;
}

/* ------------------------------------------------------------------ */
/* Income                                                              */
/* ------------------------------------------------------------------ */

export async function addIncome(
  source: string,
  amount: number,
  note: string,
  date: string,
  origin: string = 'manual',
): Promise<void> {
  const wallet = await ledger().getDefaultWallet();
  await ledger().addIncome({
    walletId: wallet.id,
    amountMinor: rupeesToMinor(amount),
    categoryId: await incomeCategoryId(source),
    counterparty: source,
    note: note || null,
    occurredAt: dateToMs(date),
    origin: asOrigin(origin),
  });
}

export async function getAllIncome(): Promise<Income[]> {
  const txns = await ledger().listTransactions({ classification: 'income', limit: 500 });
  const out: Income[] = [];
  for (const t of txns) out.push(await txnToIncome(t));
  return out;
}

export async function updateIncome(
  id: number,
  source: string,
  amount: number,
  note: string,
  date: string,
): Promise<void> {
  const originalId = await resolveTxnId(id);
  const original = await ledger().getTransaction(originalId);
  await ledger().reverseTransaction(originalId, { note: 'Edited' });
  const wallet = await ledger().getDefaultWallet();
  const created = await ledger().addIncome({
    walletId: wallet.id,
    amountMinor: rupeesToMinor(amount),
    categoryId: await incomeCategoryId(source),
    counterparty: source,
    note: note || null,
    occurredAt: dateToMs(date),
    origin: original?.origin === 'auto' ? 'auto' : 'manual',
  });
  await ledger().remapLegacyId('transaction', id, created.transaction.id);
}

export async function deleteIncome(id: number): Promise<void> {
  await ledger().reverseTransaction(await resolveTxnId(id), { note: 'Deleted' });
}

export async function deleteAllIncome(): Promise<void> {
  for (;;) {
    const txns = await ledger().listTransactions({ classification: 'income', limit: 200 });
    if (txns.length === 0) return;
    for (const t of txns) await ledger().reverseTransaction(t.id, { note: 'Reset all income' });
  }
}

/* ------------------------------------------------------------------ */
/* Expenses                                                            */
/* ------------------------------------------------------------------ */

export async function addExpense(
  amount: number,
  category: string,
  note: string,
  date: string,
  origin: string = 'manual',
): Promise<void> {
  const wallet = await ledger().getDefaultWallet();
  await ledger().addExpense({
    walletId: wallet.id,
    amountMinor: rupeesToMinor(amount),
    categoryId: await expenseCategoryId(category),
    counterparty: null,
    note: note || null,
    occurredAt: dateToMs(date),
    origin: asOrigin(origin),
  });
}

export async function getExpenseById(id: number): Promise<Expense | null> {
  const ref = await ledger().refForLegacyId('transaction', id);
  if (!ref) return null;
  const t = await ledger().getTransaction(ref);
  if (!t || t.status !== 'posted' || t.reversesTransactionId) return null;
  return txnToExpense(t);
}

export async function updateExpense(
  id: number,
  amount: number,
  category: string,
  note: string,
  date: string,
): Promise<void> {
  const originalId = await resolveTxnId(id);
  const original = await ledger().getTransaction(originalId);
  await ledger().reverseTransaction(originalId, { note: 'Edited' });
  const wallet = await ledger().getDefaultWallet();
  const created = await ledger().addExpense({
    walletId: wallet.id,
    amountMinor: rupeesToMinor(amount),
    categoryId: await expenseCategoryId(category),
    note: note || null,
    occurredAt: dateToMs(date),
    origin: original?.origin === 'auto' ? 'auto' : 'manual',
  });
  await ledger().remapLegacyId('transaction', id, created.transaction.id);
}

export async function deleteExpense(id: number): Promise<void> {
  await ledger().reverseTransaction(await resolveTxnId(id), { note: 'Deleted' });
}

export async function deleteAllExpenses(): Promise<void> {
  for (const classification of ['expense', 'fee'] as const) {
    for (;;) {
      const txns = await ledger().listTransactions({ classification, limit: 200 });
      if (txns.length === 0) break;
      for (const t of txns) await ledger().reverseTransaction(t.id, { note: 'Reset all expenses' });
    }
  }
}

export async function getExpenses(monthPrefix: string, category: string | null): Promise<Expense[]> {
  const [expenses, fees] = await Promise.all([
    ledger().listTransactions({ classification: 'expense', monthPrefix, limit: 500 }),
    ledger().listTransactions({ classification: 'fee', monthPrefix, limit: 500 }),
  ]);
  const merged = [...expenses, ...fees].sort((a, b) => b.occurredAt - a.occurredAt || b.createdAt - a.createdAt);
  const out: Expense[] = [];
  for (const t of merged) {
    const e = await txnToExpense(t);
    if (category && e.category !== category) continue;
    out.push(e);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Udhaar (loans)                                                      */
/* ------------------------------------------------------------------ */

export async function addUdhaar(
  person: string,
  amount: number,
  direction: UdhaarDirection,
  note: string,
  date: string,
): Promise<void> {
  // Slashes would break the /person/[name] route, so flatten them.
  const cleanPerson = person.trim().replace(/\//g, ' ');
  const wallet = await ledger().getDefaultWallet();
  const input = {
    personName: cleanPerson,
    walletId: wallet.id,
    amountMinor: rupeesToMinor(amount),
    note: note || null,
    occurredAt: dateToMs(date),
  };
  if (direction === 'lent') await ledger().lend(input);
  else await ledger().borrow(input);
}

export async function getUdhaarById(id: number): Promise<UdhaarEntry | null> {
  const ref = await ledger().refForLegacyId('loan', id);
  if (!ref) return null;
  const loan = await ledger().getLoan(ref);
  if (!loan || loan.status === 'void') return null;
  return loanToEntry(loan);
}

export async function updateUdhaar(
  id: number,
  person: string,
  amount: number,
  direction: UdhaarDirection,
  note: string,
  date: string,
): Promise<void> {
  const loanId = await resolveLoanId(id);
  const loan = await ledger().getLoan(loanId);
  if (!loan) throw new Error('Udhaar entry not found.');
  const remaining = await ledger().getLoanRemainingMinor(loanId);
  if (remaining !== loan.principalMinor) {
    // Editing principal/direction under existing repayments would rewrite
    // settled history. M3's native repayment UI handles those loans.
    throw new Error('This entry already has repayments, so it cannot be edited here yet.');
  }
  const cleanPerson = person.trim().replace(/\//g, ' ');
  await ledger().voidLoan(loanId);
  const wallet = await ledger().getDefaultWallet();
  const input = {
    personName: cleanPerson,
    walletId: loan.walletId ?? wallet.id,
    amountMinor: rupeesToMinor(amount),
    note: note || null,
    occurredAt: dateToMs(date),
  };
  const created = direction === 'lent' ? await ledger().lend(input) : await ledger().borrow(input);
  await ledger().remapLegacyId('loan', id, created.id);
}

export async function deleteUdhaar(id: number): Promise<void> {
  await ledger().voidLoan(await resolveLoanId(id));
}

export async function deleteAllUdhaar(): Promise<void> {
  const loans = await ledger().listLoans();
  for (const loan of loans) {
    if (loan.status !== 'void') await ledger().voidLoan(loan.id);
  }
}

/**
 * Settle/unsettle now moves real money through the ledger:
 * settling records a full repayment for the exact remaining balance;
 * unsettling reverses that settlement repayment. (v1 only flipped a flag,
 * which moved the displayed balance the wrong way for borrowed money.)
 */
export async function setUdhaarSettled(id: number, settled: boolean): Promise<void> {
  const loanId = await resolveLoanId(id);
  const loan = await ledger().getLoan(loanId);
  if (!loan || loan.status === 'void') throw new Error('Udhaar entry not found.');
  if (settled) {
    const remaining = await ledger().getLoanRemainingMinor(loanId);
    if (remaining > 0) {
      await ledger().recordRepayment({ loanId, amountMinor: remaining, note: 'Settled' });
    }
  } else if (loan.settlementTransactionId) {
    await ledger().reverseTransaction(loan.settlementTransactionId, { note: 'Settlement undone' });
  }
}

/* ------------------------------------------------------------------ */
/* Auto-fetch compatibility                                            */
/*                                                                     */
/* v1's same-amount IN/OUT pairing deleted legitimate records (M1      */
/* finding P0-3). It is disabled: these lookups now always miss, so    */
/* the auto-fetch service can never delete a ledger entry. M4         */
/* replaces pairing with explicit transfer classification.            */
/* ------------------------------------------------------------------ */

export async function findAutoIncomeByAmount(_amount: number, _date: string): Promise<Income | null> {
  return null;
}

export async function findAutoExpenseByAmount(_amount: number, _date: string): Promise<Expense | null> {
  return null;
}

/* ------------------------------------------------------------------ */
/* Reporting — all screens read the same ledger reporting service     */
/* ------------------------------------------------------------------ */

export async function getDashboardSummary(now = new Date()): Promise<DashboardSummary> {
  const monthPrefix = localMonthPrefix(now);
  const dash = await ledger().getDashboard(monthPrefix);
  const totals = await ledger().getAllTimeTotals();
  return {
    totalIncome: minorToRupees(totals.incomeMinor),
    totalExpenses: minorToRupees(totals.expensesMinor),
    totalLent: minorToRupees(dash.receivablesMinor),
    totalBorrowed: minorToRupees(dash.payablesMinor),
    balance: minorToRupees(dash.netWorthMinor),
    monthIncome: minorToRupees(dash.monthIncomeMinor),
    monthExpenses: minorToRupees(dash.monthExpensesMinor),
  };
}

export async function getPeople(): Promise<PersonSummary[]> {
  const summaries = await ledger().getPersonSummaries();
  return summaries.map((s) => ({
    name: s.person.name,
    lent: minorToRupees(s.lentMinor),
    borrowed: minorToRupees(s.borrowedMinor),
    net: minorToRupees(s.netMinor),
    openCount: s.openCount,
  }));
}

export async function getPersonEntries(name: string): Promise<UdhaarEntry[]> {
  const person = await ledger().getPersonByName(name);
  if (!person) return [];
  const loans = await ledger().listLoans({ personId: person.id });
  const out: UdhaarEntry[] = [];
  for (const loan of loans) {
    if (loan.status === 'void') continue;
    out.push(await loanToEntry(loan));
  }
  return out;
}

export async function getPersonTotals(name: string): Promise<{ lent: number; borrowed: number; settled: number }> {
  const person = await ledger().getPersonByName(name);
  if (!person) return { lent: 0, borrowed: 0, settled: 0 };
  const loans = await ledger().listLoans({ personId: person.id });
  let lent = 0;
  let borrowed = 0;
  let settled = 0;
  for (const loan of loans) {
    if (loan.status === 'void') continue;
    if (loan.status === 'settled') {
      settled += 1; // legacy semantic: count of settled entries
      continue;
    }
    const remaining = await ledger().getLoanRemainingMinor(loan.id);
    if (loan.direction === 'lent') lent += remaining;
    else borrowed += remaining;
  }
  return { lent: minorToRupees(lent), borrowed: minorToRupees(borrowed), settled };
}

export async function getMonthlyStats(monthsBack: number): Promise<{ month: string; income: number; expenses: number }[]> {
  const stats = await ledger().getMonthlyStats(monthsBack);
  return stats.map((s) => ({
    month: s.month,
    income: minorToRupees(s.incomeMinor),
    expenses: minorToRupees(s.expensesMinor),
  }));
}

export async function getTopCategories(monthPrefix: string, limit = 5): Promise<{ category: string; total: number }[]> {
  const rows = await ledger().getTopCategories(monthPrefix, limit);
  return rows.map((r) => ({ category: categoryKeyForName(r.name), total: minorToRupees(r.totalMinor) }));
}

const LEDGER_ACTIVITY_LABEL: Partial<Record<Transaction['classification'], string>> = {
  transfer: 'Transfer',
  loan_lent: 'Lent',
  loan_borrowed: 'Borrowed',
  repayment_received: 'Repayment received',
  repayment_made: 'Repayment made',
  refund_received: 'Refund',
  refund_issued: 'Refund issued',
  balance_adjustment: 'Balance adjustment',
  opening_balance: 'Opening balance',
  fee: 'Fee',
};

export async function getRecentActivity(limit = 8): Promise<ActivityItem[]> {
  const txns = await ledger().listTransactions({ limit });
  const out: ActivityItem[] = [];
  for (const t of txns) {
    const kind: ActivityItem['kind'] =
      t.classification === 'income' || t.classification === 'refund_received'
        ? 'income'
        : t.classification === 'expense' || t.classification === 'fee' || t.classification === 'refund_issued'
          ? 'expense'
          : 'udhaar';
    let label: string;
    if (t.classification === 'income') label = (await categoryName(t.categoryId)) ?? t.counterparty ?? 'Income';
    else if (t.classification === 'expense') label = categoryLabel(categoryKeyForName(await categoryName(t.categoryId)));
    else if (t.loanId) {
      const loan = await ledger().getLoan(t.loanId);
      label = loan?.personName ?? t.counterparty ?? 'Udhaar';
    } else label = t.counterparty ?? LEDGER_ACTIVITY_LABEL[t.classification] ?? t.classification;
    out.push({
      kind,
      id: await ledger().legacyId('transaction', t.id),
      amount: minorToRupees(t.amountMinor),
      label,
      sublabel: t.note ?? LEDGER_ACTIVITY_LABEL[t.classification] ?? label,
      date: t.localDate,
      origin: t.origin,
    });
  }
  return out;
}

/** Exposed for diagnostics: the monthly reporting prefix of a local date. */
export function facadeMonthPrefix(localDate: string): string {
  return monthPrefixOfDate(localDate);
}
