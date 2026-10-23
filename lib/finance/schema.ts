/**
 * PocketHisaab v2 schema — a FRESH database (`pockethisaab-v2.db`).
 *
 * There is intentionally no migration from the v1 tables: the owner has
 * confirmed the v1 records are test data and authorized a clean start
 * through a controlled reset. The v1 database file is never opened,
 * altered, or deleted by v2 code.
 *
 * Design rules enforced here:
 * - Money is INTEGER paisa everywhere; REAL is banned from money columns.
 * - Foreign keys are declared and must be enabled by the driver
 *   (PRAGMA foreign_keys = ON).
 * - CHECK constraints reject invalid classifications, statuses, amounts,
 *   and zero postings at the database level, not only in the UI.
 * - External (bank/wallet) transaction identities are unique per scope.
 * - Idempotency keys are unique.
 */

export const SCHEMA_VERSION = 2;
export const V2_DATABASE_NAME = 'pockethisaab-v2.db';
export const LEGACY_DATABASE_NAME = 'pockethisaab.db';

export const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS schema_migrations (
     version INTEGER PRIMARY KEY,
     applied_at INTEGER NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS meta (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS wallets (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('cash','mobile','bank','custom')),
     icon TEXT,
     color TEXT,
     archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_wallets_name_active
     ON wallets (name COLLATE NOCASE) WHERE archived = 0`,

  `CREATE TABLE IF NOT EXISTS people (
     id TEXT PRIMARY KEY,
     name_enc TEXT NOT NULL,
     name_key TEXT NOT NULL UNIQUE,
     phone TEXT,
     archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS categories (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('income','expense','both')),
     icon TEXT,
     color TEXT,
     archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
     system INTEGER NOT NULL DEFAULT 0 CHECK (system IN (0,1)),
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_name_kind_active
     ON categories (name COLLATE NOCASE, kind) WHERE archived = 0`,

  // One row per logical account. Wallet accounts reference wallets.id,
  // receivable/payable accounts reference loans.id, the external account
  // is the singleton outside-world account.
  `CREATE TABLE IF NOT EXISTS accounts (
     id TEXT PRIMARY KEY,
     kind TEXT NOT NULL CHECK (kind IN ('wallet','receivable','payable','external')),
     ref_id TEXT,
     label TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     UNIQUE (kind, ref_id)
   )`,

  `CREATE TABLE IF NOT EXISTS transactions (
     id TEXT PRIMARY KEY,
     classification TEXT NOT NULL CHECK (classification IN (
       'income','expense','fee','transfer','loan_lent','loan_borrowed',
       'repayment_received','repayment_made','refund_received','refund_issued',
       'balance_adjustment','opening_balance')),
     status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','pending','failed','reversed')),
     amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
     currency TEXT NOT NULL DEFAULT 'PKR' CHECK (currency = 'PKR'),
     category_id TEXT REFERENCES categories(id),
     person_id TEXT REFERENCES people(id),
     loan_id TEXT,
     counterparty_enc TEXT,
     note_enc TEXT,
     reference TEXT,
     occurred_at INTEGER NOT NULL,
     local_date TEXT NOT NULL CHECK (local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
     origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual','auto','import','system')),
     idempotency_key TEXT UNIQUE,
     reverses_transaction_id TEXT REFERENCES transactions(id),
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_txn_local_date ON transactions (local_date)`,
  `CREATE INDEX IF NOT EXISTS idx_txn_class_date ON transactions (classification, local_date)`,
  `CREATE INDEX IF NOT EXISTS idx_txn_occurred ON transactions (occurred_at DESC, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_txn_loan ON transactions (loan_id)`,
  `CREATE INDEX IF NOT EXISTS idx_txn_person ON transactions (person_id)`,

  `CREATE TABLE IF NOT EXISTS postings (
     id TEXT PRIMARY KEY,
     transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
     account_id TEXT NOT NULL REFERENCES accounts(id),
     amount_minor INTEGER NOT NULL CHECK (amount_minor != 0),
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_postings_txn ON postings (transaction_id)`,
  `CREATE INDEX IF NOT EXISTS idx_postings_account ON postings (account_id)`,

  `CREATE TABLE IF NOT EXISTS loans (
     id TEXT PRIMARY KEY,
     person_id TEXT NOT NULL REFERENCES people(id),
     direction TEXT NOT NULL CHECK (direction IN ('lent','borrowed')),
     principal_minor INTEGER NOT NULL CHECK (principal_minor > 0),
     wallet_id TEXT NOT NULL REFERENCES wallets(id),
     principal_transaction_id TEXT NOT NULL REFERENCES transactions(id),
     settlement_transaction_id TEXT REFERENCES transactions(id),
     occurred_at INTEGER NOT NULL,
     local_date TEXT NOT NULL CHECK (local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
     due_date TEXT,
     reminder_date TEXT,
     note_enc TEXT,
     status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','partially_paid','settled','void')),
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_loans_person ON loans (person_id)`,
  `CREATE INDEX IF NOT EXISTS idx_loans_status ON loans (status)`,

  // Database-level duplicate prevention for imported transactions.
  // scope = institution + account identity, e.g. "faysal:acct8588".
  // identity = the institution's transaction reference within that scope.
  `CREATE TABLE IF NOT EXISTS external_identities (
     id TEXT PRIMARY KEY,
     scope TEXT NOT NULL,
     identity TEXT NOT NULL,
     transaction_id TEXT NOT NULL REFERENCES transactions(id),
     created_at INTEGER NOT NULL,
     UNIQUE (scope, identity)
   )`,

  // Durable numeric aliases for v2 UUIDs, used only by the v1
  // compatibility facade (lib/db.ts) whose screens pass numeric IDs.
  `CREATE TABLE IF NOT EXISTS legacy_refs (
     entity TEXT NOT NULL,
     ref_id TEXT NOT NULL,
     legacy_id INTEGER NOT NULL,
     PRIMARY KEY (entity, ref_id),
     UNIQUE (entity, legacy_id)
   )`,

  // One row per observed source event (SMS / notification / statement).
  // The M4 import inbox lives on this table: parsed fields, suggestions,
  // confidence, review status and links to the ledger transaction and to
  // candidate duplicates / transfer pairs.
  `CREATE TABLE IF NOT EXISTS import_observations (
     id TEXT PRIMARY KEY,
     source TEXT NOT NULL CHECK (source IN ('sms','notification','statement','manual','share','paste')),
     fingerprint TEXT NOT NULL UNIQUE,
     institution TEXT,
     external_scope TEXT,
     external_identity TEXT,
     status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','needs_review','imported','ignored','duplicate')),
     transaction_id TEXT REFERENCES transactions(id),
     amount_minor INTEGER,
     direction TEXT CHECK (direction IN ('in','out')),
     counterparty_enc TEXT,
     reference TEXT,
     local_date TEXT,
     suggested_classification TEXT,
     suggested_wallet_id TEXT,
     suggested_category_id TEXT,
     confidence_pct INTEGER NOT NULL DEFAULT 0,
     parse_status TEXT NOT NULL DEFAULT 'completed' CHECK (parse_status IN ('completed','pending','failed')),
     reason TEXT,
     candidate_transaction_id TEXT,
     candidate_observation_id TEXT,
     excerpt_enc TEXT,
     observed_at INTEGER NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL DEFAULT 0
   )`,
];

/** Default wallets seeded with ZERO balance. No postings are created. */
export const SEED_WALLETS: readonly { name: string; kind: 'cash' | 'mobile' | 'bank'; icon: string; color: string }[] = [
  { name: 'Cash', kind: 'cash', icon: '💵', color: '#0BAE87' },
  { name: 'JazzCash', kind: 'mobile', icon: '📱', color: '#ED1C24' },
  { name: 'Easypaisa', kind: 'mobile', icon: '📱', color: '#4CB050' },
  { name: 'Bank Account', kind: 'bank', icon: '🏦', color: '#2563EB' },
];

/** System categories carried over from v1 (plus Fees). */
export const SEED_CATEGORIES: readonly { name: string; kind: 'income' | 'expense'; icon: string }[] = [
  { name: 'Food', kind: 'expense', icon: '🍔' },
  { name: 'Transport', kind: 'expense', icon: '🚌' },
  { name: 'Recharge', kind: 'expense', icon: '📱' },
  { name: 'Shopping', kind: 'expense', icon: '🛍️' },
  { name: 'Health', kind: 'expense', icon: '💊' },
  { name: 'Bills', kind: 'expense', icon: '🧾' },
  { name: 'Fees', kind: 'expense', icon: '🏷️' },
  { name: 'Other', kind: 'expense', icon: '📦' },
  { name: 'Pocket Money', kind: 'income', icon: '💰' },
  { name: 'Gift', kind: 'income', icon: '🎁' },
  { name: 'Refund', kind: 'income', icon: '↩️' },
  { name: 'Work', kind: 'income', icon: '💼' },
  { name: 'Other Income', kind: 'income', icon: '📦' },
];

export const EXTERNAL_ACCOUNT_ID = 'account:external';
export const META_LEDGER_REVISION = 'ledger_revision';
export const META_SCHEMA_VERSION = 'schema_version';
