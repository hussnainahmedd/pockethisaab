import * as SQLite from 'expo-sqlite';
import { localMonthPrefix } from './format';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type UdhaarDirection = 'lent' | 'borrowed';

export interface Income {
  id: number;
  amount: number;
  source: string;
  note: string | null;
  date: string; // YYYY-MM-DD
}

export interface Expense {
  id: number;
  amount: number;
  category: string;
  note: string | null;
  date: string; // YYYY-MM-DD
}

export interface UdhaarEntry {
  id: number;
  person: string;
  amount: number;
  direction: UdhaarDirection;
  note: string | null;
  date: string; // YYYY-MM-DD
  settled: number; // 0 | 1
}

export interface PersonSummary {
  name: string;
  lent: number; // open lent total (they owe me)
  borrowed: number; // open borrowed total (I owe them)
  net: number; // lent - borrowed; positive = they owe me
  openCount: number;
}

export interface DashboardSummary {
  totalIncome: number;
  totalExpenses: number;
  totalLent: number;
  totalBorrowed: number;
  balance: number;
  monthIncome: number;
  monthExpenses: number;
}

export interface ActivityItem {
  kind: 'income' | 'expense' | 'udhaar';
  id: number;
  amount: number;
  label: string;
  sublabel: string;
  date: string;
}

/* ------------------------------------------------------------------ */
/* Connection                                                          */
/* ------------------------------------------------------------------ */

let db: SQLite.SQLiteDatabase | null = null;

export function getDb(): SQLite.SQLiteDatabase {
  if (!db) {
    db = SQLite.openDatabaseSync('pockethisaab.db');
  }
  return db;
}

export async function initDatabase(): Promise<void> {
  const database = getDb();
  await database.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS income (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount REAL NOT NULL,
      source TEXT NOT NULL,
      note TEXT,
      date TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount REAL NOT NULL,
      category TEXT NOT NULL,
      note TEXT,
      date TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS udhaar (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person TEXT NOT NULL,
      amount REAL NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('lent', 'borrowed')),
      note TEXT,
      date TEXT NOT NULL,
      settled INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
    CREATE INDEX IF NOT EXISTS idx_income_date ON income(date);
    CREATE INDEX IF NOT EXISTS idx_udhaar_person ON udhaar(person);
    CREATE INDEX IF NOT EXISTS idx_udhaar_date ON udhaar(date);
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

export async function addIncome(source: string, amount: number, note: string, date: string): Promise<void> {
  await getDb().runAsync('INSERT INTO income (source, amount, note, date) VALUES (?, ?, ?, ?)', [
    source,
    amount,
    note || null,
    date,
  ]);
}

export async function addExpense(amount: number, category: string, note: string, date: string): Promise<void> {
  await getDb().runAsync('INSERT INTO expenses (amount, category, note, date) VALUES (?, ?, ?, ?)', [
    amount,
    category,
    note || null,
    date,
  ]);
}

export async function deleteExpense(id: number): Promise<void> {
  await getDb().runAsync('DELETE FROM expenses WHERE id = ?', [id]);
}

export async function getExpenseById(id: number): Promise<Expense | null> {
  const rows = await getDb().getAllAsync<Expense>('SELECT * FROM expenses WHERE id = ?', [id]);
  return rows[0] ?? null;
}

export async function updateExpense(
  id: number,
  amount: number,
  category: string,
  note: string,
  date: string,
): Promise<void> {
  await getDb().runAsync('UPDATE expenses SET amount = ?, category = ?, note = ?, date = ? WHERE id = ?', [
    amount,
    category,
    note || null,
    date,
    id,
  ]);
}

export async function getAllIncome(): Promise<Income[]> {
  return getDb().getAllAsync<Income>('SELECT * FROM income ORDER BY date DESC, id DESC');
}

export async function updateIncome(
  id: number,
  source: string,
  amount: number,
  note: string,
  date: string,
): Promise<void> {
  await getDb().runAsync('UPDATE income SET source = ?, amount = ?, note = ?, date = ? WHERE id = ?', [
    source,
    amount,
    note || null,
    date,
    id,
  ]);
}

export async function deleteIncome(id: number): Promise<void> {
  await getDb().runAsync('DELETE FROM income WHERE id = ?', [id]);
}

export async function getUdhaarById(id: number): Promise<UdhaarEntry | null> {
  const rows = await getDb().getAllAsync<UdhaarEntry>('SELECT * FROM udhaar WHERE id = ?', [id]);
  return rows[0] ?? null;
}

export async function updateUdhaar(
  id: number,
  person: string,
  amount: number,
  direction: UdhaarDirection,
  note: string,
  date: string,
): Promise<void> {
  // Slashes would break the /person/[name] route, so flatten them.
  const cleanPerson = person.trim().replace(/\//g, ' ');
  await getDb().runAsync(
    'UPDATE udhaar SET person = ?, amount = ?, direction = ?, note = ?, date = ? WHERE id = ?',
    [cleanPerson, amount, direction, note || null, date, id],
  );
}

export async function deleteUdhaar(id: number): Promise<void> {
  await getDb().runAsync('DELETE FROM udhaar WHERE id = ?', [id]);
}

export async function addUdhaar(
  person: string,
  amount: number,
  direction: UdhaarDirection,
  note: string,
  date: string,
): Promise<void> {
  // Slashes would break the /person/[name] route, so flatten them.
  const cleanPerson = person.trim().replace(/\//g, ' ');
  await getDb().runAsync(
    'INSERT INTO udhaar (person, amount, direction, note, date, settled) VALUES (?, ?, ?, ?, ?, 0)',
    [cleanPerson, amount, direction, note || null, date],
  );
}

export async function setUdhaarSettled(id: number, settled: boolean): Promise<void> {
  await getDb().runAsync('UPDATE udhaar SET settled = ? WHERE id = ?', [settled ? 1 : 0, id]);
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

function sum(rows: { total: number | null }[]): number {
  const v = rows[0]?.total;
  return typeof v === 'number' ? v : 0;
}

export async function getDashboardSummary(now = new Date()): Promise<DashboardSummary> {
  const database = getDb();
  const monthPrefix = localMonthPrefix(now); // YYYY-MM, local time

  const totalIncome = sum(await database.getAllAsync<{ total: number | null }>('SELECT SUM(amount) AS total FROM income'));
  const totalExpenses = sum(await database.getAllAsync<{ total: number | null }>('SELECT SUM(amount) AS total FROM expenses'));
  const totalLent = sum(
    await database.getAllAsync<{ total: number | null }>(
      "SELECT SUM(amount) AS total FROM udhaar WHERE direction = 'lent' AND settled = 0",
    ),
  );
  const totalBorrowed = sum(
    await database.getAllAsync<{ total: number | null }>(
      "SELECT SUM(amount) AS total FROM udhaar WHERE direction = 'borrowed' AND settled = 0",
    ),
  );
  const monthIncome = sum(
    await database.getAllAsync<{ total: number | null }>('SELECT SUM(amount) AS total FROM income WHERE date LIKE ?', [
      `${monthPrefix}%`,
    ]),
  );
  const monthExpenses = sum(
    await database.getAllAsync<{ total: number | null }>('SELECT SUM(amount) AS total FROM expenses WHERE date LIKE ?', [
      `${monthPrefix}%`,
    ]),
  );

  return {
    totalIncome,
    totalExpenses,
    totalLent,
    totalBorrowed,
    balance: totalIncome - totalExpenses - totalLent - totalBorrowed,
    monthIncome,
    monthExpenses,
  };
}

export async function getPeople(): Promise<PersonSummary[]> {
  const rows = await getDb().getAllAsync<{
    name: string;
    lent: number | null;
    borrowed: number | null;
    openCount: number;
  }>(`
    SELECT person AS name,
      SUM(CASE WHEN direction = 'lent' THEN amount ELSE 0 END) AS lent,
      SUM(CASE WHEN direction = 'borrowed' THEN amount ELSE 0 END) AS borrowed,
      COUNT(*) AS openCount
    FROM udhaar
    WHERE settled = 0
    GROUP BY person
    ORDER BY person COLLATE NOCASE
  `);
  return rows.map((r) => {
    const lent = r.lent ?? 0;
    const borrowed = r.borrowed ?? 0;
    return { name: r.name, lent, borrowed, net: lent - borrowed, openCount: r.openCount };
  });
}

export async function getPersonEntries(name: string): Promise<UdhaarEntry[]> {
  return getDb().getAllAsync<UdhaarEntry>(
    'SELECT * FROM udhaar WHERE person = ? ORDER BY date DESC, id DESC',
    [name],
  );
}

export async function getPersonTotals(name: string): Promise<{ lent: number; borrowed: number; settled: number }> {
  const open = await getDb().getAllAsync<{ lent: number | null; borrowed: number | null }>(
    "SELECT SUM(CASE WHEN direction = 'lent' THEN amount ELSE 0 END) AS lent, SUM(CASE WHEN direction = 'borrowed' THEN amount ELSE 0 END) AS borrowed FROM udhaar WHERE person = ? AND settled = 0",
    [name],
  );
  const settled = await getDb().getAllAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM udhaar WHERE person = ? AND settled = 1',
    [name],
  );
  return { lent: open[0]?.lent ?? 0, borrowed: open[0]?.borrowed ?? 0, settled: settled[0]?.n ?? 0 };
}

export async function getExpenses(monthPrefix: string, category: string | null): Promise<Expense[]> {
  if (category) {
    return getDb().getAllAsync<Expense>(
      'SELECT * FROM expenses WHERE date LIKE ? AND category = ? ORDER BY date DESC, id DESC',
      [`${monthPrefix}%`, category],
    );
  }
  return getDb().getAllAsync<Expense>('SELECT * FROM expenses WHERE date LIKE ? ORDER BY date DESC, id DESC', [
    `${monthPrefix}%`,
  ]);
}

export async function getMonthlyStats(monthsBack: number): Promise<
  { month: string; income: number; expenses: number }[]
> {
  const out: { month: string; income: number; expenses: number }[] = [];
  const now = new Date();
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const prefix = localMonthPrefix(d);
    const income = sum(
      await getDb().getAllAsync<{ total: number | null }>('SELECT SUM(amount) AS total FROM income WHERE date LIKE ?', [
        `${prefix}%`,
      ]),
    );
    const expenses = sum(
      await getDb().getAllAsync<{ total: number | null }>('SELECT SUM(amount) AS total FROM expenses WHERE date LIKE ?', [
        `${prefix}%`,
      ]),
    );
    out.push({ month: prefix, income, expenses });
  }
  return out;
}

export async function getTopCategories(monthPrefix: string, limit = 5): Promise<{ category: string; total: number }[]> {
  return getDb().getAllAsync<{ category: string; total: number }>(
    'SELECT category, SUM(amount) AS total FROM expenses WHERE date LIKE ? GROUP BY category ORDER BY total DESC LIMIT ?',
    [`${monthPrefix}%`, limit],
  );
}

export async function getRecentActivity(limit = 8): Promise<ActivityItem[]> {
  const database = getDb();
  const income = await database.getAllAsync<Income>('SELECT * FROM income ORDER BY date DESC, id DESC LIMIT ?', [limit]);
  const expenses = await database.getAllAsync<Expense>('SELECT * FROM expenses ORDER BY date DESC, id DESC LIMIT ?', [limit]);
  const udhaar = await database.getAllAsync<UdhaarEntry>('SELECT * FROM udhaar ORDER BY date DESC, id DESC LIMIT ?', [limit]);

  const items: ActivityItem[] = [
    ...income.map((r) => ({
      kind: 'income' as const,
      id: r.id,
      amount: r.amount,
      label: r.source,
      sublabel: r.note ?? 'Pocket money added',
      date: r.date,
    })),
    ...expenses.map((r) => ({
      kind: 'expense' as const,
      id: r.id,
      amount: r.amount,
      label: categoryLabel(r.category),
      sublabel: r.note ?? 'Expense',
      date: r.date,
    })),
    ...udhaar.map((r) => ({
      kind: 'udhaar' as const,
      id: r.id,
      amount: r.amount,
      label: r.person,
      sublabel: r.direction === 'lent' ? `Lent${r.settled ? ' · settled' : ''}` : `Borrowed${r.settled ? ' · settled' : ''}`,
      date: r.date,
    })),
  ];
  items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
  return items.slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* Category + source metadata                                          */
/* ------------------------------------------------------------------ */

export const CATEGORIES = [
  { key: 'food', label: 'Food', emoji: '🍔' },
  { key: 'transport', label: 'Transport', emoji: '🚌' },
  { key: 'recharge', label: 'Recharge', emoji: '📱' },
  { key: 'shopping', label: 'Shopping', emoji: '🛍️' },
  { key: 'health', label: 'Health', emoji: '💊' },
  { key: 'bills', label: 'Bills', emoji: '🧾' },
  { key: 'other', label: 'Other', emoji: '📦' },
] as const;

export type CategoryKey = (typeof CATEGORIES)[number]['key'];

export function categoryLabel(key: string): string {
  return CATEGORIES.find((c) => c.key === key)?.label ?? 'Other';
}

export function categoryEmoji(key: string): string {
  return CATEGORIES.find((c) => c.key === key)?.emoji ?? '📦';
}

export const INCOME_SOURCES = ['Pocket Money', 'Gift', 'Refund', 'Work', 'Other'];
