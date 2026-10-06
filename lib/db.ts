import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system/legacy';
import { localMonthPrefix } from './format';
import { decText, encText, getEncryptionKey, isEncrypted } from './crypto';

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
  origin: string; // 'manual' | 'auto'
}

export interface Expense {
  id: number;
  amount: number;
  category: string;
  note: string | null;
  date: string; // YYYY-MM-DD
  origin: string; // 'manual' | 'auto'
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
  origin: string; // 'manual' | 'auto'
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
      date TEXT NOT NULL,
      origin TEXT NOT NULL DEFAULT 'manual'
    );
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount REAL NOT NULL,
      category TEXT NOT NULL,
      note TEXT,
      date TEXT NOT NULL,
      origin TEXT NOT NULL DEFAULT 'manual'
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
    CREATE TABLE IF NOT EXISTS autofetch_seen (
      key TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL
    );
  `);
  // v1.1.0 migration: 'origin' column for auto-fetched entries (fresh installs
  // get it from CREATE TABLE above; existing DBs get it here).
  for (const t of ['income', 'expenses']) {
    try {
      await database.execAsync(`ALTER TABLE ${t} ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual'`);
    } catch {
      // Column already exists — nothing to do.
    }
  }
  await ensureEncryption();
}

/* ------------------------------------------------------------------ */
/* Encryption migration (one-time, v1)                                  */
/*                                                                      */
/* First launch after this update: takes a file backup of the database, */
/* then encrypts every text field that identifies WHO the money        */
/* relates to (udhaar person names, income sources, all notes) inside   */
/* one transaction. Any failure rolls back and the app keeps working    */
/* on the plaintext database — data is never left half-migrated.       */
/* ------------------------------------------------------------------ */

const ENC_FLAG = 'enc_v1';

async function ensureEncryption(): Promise<void> {
  try {
    await ensureEncryptionInner();
  } catch {
    // Encryption setup must never brick the app: if the device key can't be
    // created (e.g. secure RNG unavailable), stay on the plaintext database
    // and retry on the next launch. The enc_v1 flag is only set after a
    // successful migration, so data is never half-migrated.
  }
}

async function ensureEncryptionInner(): Promise<void> {
  const database = getDb();
  // Make sure the device key exists before touching any data.
  await getEncryptionKey();

  const flag = await database.getAllAsync<{ value: string }>(
    'SELECT value FROM meta WHERE key = ?',
    [ENC_FLAG],
  );
  if (flag[0]?.value === '1') return;

  // Best-effort file backup before the first migration.
  try {
    const dbPath = `${FileSystem.documentDirectory}SQLite/pockethisaab.db`;
    const backupPath = `${FileSystem.documentDirectory}SQLite/pockethisaab.backup-pre-enc.db`;
    await FileSystem.copyAsync({ from: dbPath, to: backupPath });
  } catch {
    // Backup is a safety net, not a requirement — migration continues.
  }

  await database.execAsync('BEGIN');
  try {
    const incomeRows = await database.getAllAsync<{ id: number; source: string; note: string | null }>(
      'SELECT id, source, note FROM income',
    );
    for (const r of incomeRows) {
      if (isEncrypted(r.source) && (r.note == null || isEncrypted(r.note))) continue;
      await database.runAsync('UPDATE income SET source = ?, note = ? WHERE id = ?', [
        await encText(r.source),
        await encText(r.note),
        r.id,
      ]);
    }

    const expenseRows = await database.getAllAsync<{ id: number; note: string | null }>(
      'SELECT id, note FROM expenses',
    );
    for (const r of expenseRows) {
      if (r.note == null || isEncrypted(r.note)) continue;
      await database.runAsync('UPDATE expenses SET note = ? WHERE id = ?', [
        await encText(r.note),
        r.id,
      ]);
    }

    const udhaarRows = await database.getAllAsync<{ id: number; person: string; note: string | null }>(
      'SELECT id, person, note FROM udhaar',
    );
    for (const r of udhaarRows) {
      if (isEncrypted(r.person) && (r.note == null || isEncrypted(r.note))) continue;
      await database.runAsync('UPDATE udhaar SET person = ?, note = ? WHERE id = ?', [
        await encText(r.person),
        await encText(r.note),
        r.id,
      ]);
    }

    await database.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [ENC_FLAG, '1']);
    await database.execAsync('COMMIT');
  } catch (e) {
    await database.execAsync('ROLLBACK');
    // Fail open: the app keeps working on the unencrypted database rather
    // than risking data loss. Migration will be retried next launch.
    console.warn('Ledger encryption migration failed, continuing unencrypted:', e);
  }
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

export async function addIncome(
  source: string,
  amount: number,
  note: string,
  date: string,
  origin: string = 'manual',
): Promise<void> {
  await getDb().runAsync('INSERT INTO income (source, amount, note, date, origin) VALUES (?, ?, ?, ?, ?)', [
    await encText(source),
    amount,
    (await encText(note)) || null,
    date,
    origin,
  ]);
}

export async function addExpense(
  amount: number,
  category: string,
  note: string,
  date: string,
  origin: string = 'manual',
): Promise<void> {
  await getDb().runAsync('INSERT INTO expenses (amount, category, note, date, origin) VALUES (?, ?, ?, ?, ?)', [
    amount,
    category,
    (await encText(note)) || null,
    date,
    origin,
  ]);
}

export async function deleteExpense(id: number): Promise<void> {
  await getDb().runAsync('DELETE FROM expenses WHERE id = ?', [id]);
}

export async function getExpenseById(id: number): Promise<Expense | null> {
  const rows = await getDb().getAllAsync<Expense>('SELECT * FROM expenses WHERE id = ?', [id]);
  const r = rows[0];
  if (!r) return null;
  return { ...r, note: await decText(r.note) };
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
    (await encText(note)) || null,
    date,
    id,
  ]);
}

export async function getAllIncome(): Promise<Income[]> {
  const rows = await getDb().getAllAsync<Income>('SELECT * FROM income ORDER BY date DESC, id DESC');
  return Promise.all(
    rows.map(async (r) => ({ ...r, source: (await decText(r.source)) ?? '', note: await decText(r.note) })),
  );
}

export async function updateIncome(
  id: number,
  source: string,
  amount: number,
  note: string,
  date: string,
): Promise<void> {
  await getDb().runAsync('UPDATE income SET source = ?, amount = ?, note = ?, date = ? WHERE id = ?', [
    await encText(source),
    amount,
    (await encText(note)) || null,
    date,
    id,
  ]);
}

export async function deleteIncome(id: number): Promise<void> {
  await getDb().runAsync('DELETE FROM income WHERE id = ?', [id]);
}

/** Delete ALL income entries (reset Pocket Money). No confirmation here — the UI must ask. */
export async function deleteAllIncome(): Promise<void> {
  await getDb().runAsync('DELETE FROM income');
}

/** Delete ALL expense entries (reset Expenses). No confirmation here — the UI must ask. */
export async function deleteAllExpenses(): Promise<void> {
  await getDb().runAsync('DELETE FROM expenses');
}

/** Delete ALL udhaar entries (reset Udhaar). No confirmation here — the UI must ask. */
export async function deleteAllUdhaar(): Promise<void> {
  await getDb().runAsync('DELETE FROM udhaar');
}

/**
 * Find a recent auto-added entry with the exact same amount on the given
 * date (used for self-transfer detection: money moved between the user's
 * own accounts shows up as an out+in pair that should both be skipped).
 */
export async function findAutoIncomeByAmount(amount: number, date: string): Promise<Income | null> {
  const rows = await getDb().getAllAsync<Income>(
    "SELECT * FROM income WHERE origin='auto' AND amount=? AND date=? ORDER BY id DESC LIMIT 1",
    [amount, date],
  );
  return rows[0] ?? null;
}

export async function findAutoExpenseByAmount(amount: number, date: string): Promise<Expense | null> {
  const rows = await getDb().getAllAsync<Expense>(
    "SELECT * FROM expenses WHERE origin='auto' AND amount=? AND date=? ORDER BY id DESC LIMIT 1",
    [amount, date],
  );
  return rows[0] ?? null;
}

export async function getUdhaarById(id: number): Promise<UdhaarEntry | null> {
  const rows = await getDb().getAllAsync<UdhaarEntry>('SELECT * FROM udhaar WHERE id = ?', [id]);
  const r = rows[0];
  if (!r) return null;
  return { ...r, person: (await decText(r.person)) ?? '', note: await decText(r.note) };
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
    [await encText(cleanPerson), amount, direction, (await encText(note)) || null, date, id],
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
    [await encText(cleanPerson), amount, direction, (await encText(note)) || null, date],
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
  // Person names are encrypted at rest, so grouping happens in JS after decrypt.
  const rows = await getDb().getAllAsync<{ person: string; direction: UdhaarDirection; amount: number }>(
    'SELECT person, direction, amount FROM udhaar WHERE settled = 0',
  );
  const byName = new Map<string, PersonSummary>();
  for (const r of rows) {
    const name = (await decText(r.person)) ?? '';
    let s = byName.get(name);
    if (!s) {
      s = { name, lent: 0, borrowed: 0, net: 0, openCount: 0 };
      byName.set(name, s);
    }
    if (r.direction === 'lent') s.lent += r.amount;
    else s.borrowed += r.amount;
    s.openCount += 1;
  }
  const out = [...byName.values()];
  for (const s of out) s.net = s.lent - s.borrowed;
  out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return out;
}

export async function getPersonEntries(name: string): Promise<UdhaarEntry[]> {
  const rows = await getDb().getAllAsync<UdhaarEntry>('SELECT * FROM udhaar ORDER BY date DESC, id DESC');
  const out: UdhaarEntry[] = [];
  for (const r of rows) {
    const person = await decText(r.person);
    if (person === name) out.push({ ...r, person: person ?? '', note: await decText(r.note) });
  }
  return out;
}

export async function getPersonTotals(name: string): Promise<{ lent: number; borrowed: number; settled: number }> {
  const rows = await getDb().getAllAsync<UdhaarEntry>('SELECT * FROM udhaar');
  let lent = 0;
  let borrowed = 0;
  let settled = 0;
  for (const r of rows) {
    if ((await decText(r.person)) !== name) continue;
    if (r.settled) {
      settled += 1;
    } else if (r.direction === 'lent') {
      lent += r.amount;
    } else {
      borrowed += r.amount;
    }
  }
  return { lent, borrowed, settled };
}

export async function getExpenses(monthPrefix: string, category: string | null): Promise<Expense[]> {
  let rows: Expense[];
  if (category) {
    rows = await getDb().getAllAsync<Expense>(
      'SELECT * FROM expenses WHERE date LIKE ? AND category = ? ORDER BY date DESC, id DESC',
      [`${monthPrefix}%`, category],
    );
  } else {
    rows = await getDb().getAllAsync<Expense>('SELECT * FROM expenses WHERE date LIKE ? ORDER BY date DESC, id DESC', [
      `${monthPrefix}%`,
    ]);
  }
  return Promise.all(rows.map(async (r) => ({ ...r, note: await decText(r.note) })));
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
    ...(await Promise.all(
      income.map(async (r) => ({
        kind: 'income' as const,
        id: r.id,
        amount: r.amount,
        label: (await decText(r.source)) ?? '',
        sublabel: (await decText(r.note)) ?? 'Pocket money added',
        date: r.date,
        origin: r.origin ?? 'manual',
      })),
    )),
    ...(await Promise.all(
      expenses.map(async (r) => ({
        kind: 'expense' as const,
        id: r.id,
        amount: r.amount,
        label: categoryLabel(r.category),
        sublabel: (await decText(r.note)) ?? 'Expense',
        date: r.date,
        origin: r.origin ?? 'manual',
      })),
    )),
    ...(await Promise.all(
      udhaar.map(async (r) => ({
        kind: 'udhaar' as const,
        id: r.id,
        amount: r.amount,
        label: (await decText(r.person)) ?? '',
        sublabel:
          r.direction === 'lent' ? `Lent${r.settled ? ' · settled' : ''}` : `Borrowed${r.settled ? ' · settled' : ''}`,
        date: r.date,
        origin: 'manual',
      })),
    )),
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

/* ------------------------------------------------------------------ */
/* Meta key-value helpers                                              */
/* ------------------------------------------------------------------ */

export async function getMetaValue(key: string): Promise<string | null> {
  const rows = await getDb().getAllAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]);
  return rows[0]?.value ?? null;
}

export async function setMetaValue(key: string, value: string): Promise<void> {
  await getDb().runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, value]);
}

/* ------------------------------------------------------------------ */
/* Auto-fetch dedup store                                              */
/* ------------------------------------------------------------------ */

export async function hasSeenAutofetch(key: string): Promise<boolean> {
  const rows = await getDb().getAllAsync<{ key: string }>('SELECT key FROM autofetch_seen WHERE key = ?', [key]);
  return rows.length > 0;
}

export async function markAutofetchSeen(key: string): Promise<void> {
  const database = getDb();
  await database.runAsync('INSERT OR IGNORE INTO autofetch_seen (key, created_at) VALUES (?, ?)', [
    key,
    Date.now(),
  ]);
  // Prune keys older than 120 days so the table stays tiny.
  await database.runAsync('DELETE FROM autofetch_seen WHERE created_at < ?', [Date.now() - 120 * 24 * 3600 * 1000]);
}
