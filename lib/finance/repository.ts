/**
 * SQLite repository for the PocketHisaab v2 ledger.
 *
 * The repository is driver-agnostic: the app injects an expo-sqlite
 * driver, the test suite injects a node:sqlite driver, and both run the
 * exact same code against the exact same schema.
 *
 * Guarantees implemented here:
 * - Every financial write happens inside ONE database transaction:
 *   transaction row + balanced postings + loan status + dedup identity
 *   + ledger revision either all commit or all roll back.
 * - Postings come only from the pure engine (engine.ts) and always sum
 *   to zero.
 * - Money is integer paisa end to end.
 * - Corrections are append-only reversals; posted history is never
 *   edited in place.
 */
import { assertBalanced, planPostings, reversePostings, type Operation, type PostingSpec } from './engine';
import { assertMinor, MoneyError } from './money';
import {
  EXTERNAL_ACCOUNT_ID,
  META_LEDGER_REVISION,
  META_SCHEMA_VERSION,
  SCHEMA_STATEMENTS,
  SCHEMA_VERSION,
  SEED_CATEGORIES,
  SEED_WALLETS,
} from './schema';
import type {
  Category,
  Classification,
  DashboardSummaryV2,
  IdGenerator,
  ImportObservation,
  ImportSource,
  Loan,
  LoanDirection,
  MonthlyStatV2,
  ParseStatus,
  Person,
  SqlDriver,
  TextProtector,
  Transaction,
  TransactionOrigin,
  Wallet,
  WalletKind,
} from './types';

export const CONTROLLED_RESET_CONFIRMATION = 'RESET-POCKETHISAAB-V2';

export function normalizePersonName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}
export function personNameKeyInput(name: string): string {
  return normalizePersonName(name).toLocaleLowerCase('en-US');
}
export function localDateOf(ms: number): string {
  const d = new Date(ms);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
export function monthPrefixOfDate(localDate: string): string {
  return localDate.slice(0, 7);
}
export function monthPrefixOf(ms: number): string {
  return monthPrefixOfDate(localDateOf(ms));
}

export interface RecordResult {
  transaction: Transaction;
  /** false when an idempotency key / external identity already existed. */
  created: boolean;
}

export interface TransactionQuery {
  monthPrefix?: string;
  classification?: Transaction['classification'];
  classifications?: Transaction['classification'][];
  categoryId?: string;
  walletId?: string;
  loanId?: string;
  personId?: string;
  dateFrom?: string; // YYYY-MM-DD inclusive
  dateTo?: string; // YYYY-MM-DD inclusive
  minAmountMinor?: number;
  maxAmountMinor?: number;
  /** Free text over counterparty, note, reference, category, classification. */
  search?: string;
  sort?: 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc';
  includeReversed?: boolean;
  limit?: number;
  offset?: number;
}

export interface TransactionPostingView {
  accountId: string;
  accountKind: 'wallet' | 'receivable' | 'payable' | 'external';
  amountMinor: number;
  walletId: string | null;
  walletName: string | null;
}

/** Portable backup payload (protected fields are plaintext INSIDE the payload;
 * the payload is passphrase-encrypted before it leaves the ledger). */
export const BACKUP_FORMAT = 'pockethisaab-backup';
export const BACKUP_VERSION = 1;

export interface BackupData {
  format: string;
  version: number;
  exportedAt: number;
  tables: Record<string, Record<string, unknown>[]>;
}

/** One parsed source event handed to the M4 import engine. */
export interface ParsedEventInput {
  source: ImportSource;
  /** Display label, e.g. 'JazzCash', 'Faysal Bank'. */
  institution: string;
  /** Stable institution id used for scoping, e.g. 'jazzcash', 'fbl'. */
  institutionId: string;
  /** Account discriminator when known, e.g. 'acct8588'. */
  accountHint?: string | null;
  amountMinor: number;
  direction: 'in' | 'out';
  counterparty?: string | null;
  reference?: string | null;
  occurredAt: number;
  parseStatus: ParseStatus;
  /** Parser expense-category key (food/transport/…). */
  categoryKey?: string | null;
  /** Parser income-source label (Refund/Work/Gift/Other). */
  incomeSource?: string | null;
  /** Short excerpt for the inbox UI (truncated + encrypted at rest). */
  excerpt?: string | null;
}

type ObsRow = {
  id: string;
  source: ImportSource;
  fingerprint: string;
  institution: string | null;
  external_scope: string | null;
  external_identity: string | null;
  status: ImportObservation['status'];
  transaction_id: string | null;
  amount_minor: number | null;
  direction: 'in' | 'out' | null;
  counterparty_enc: string | null;
  reference: string | null;
  local_date: string | null;
  suggested_classification: string | null;
  suggested_wallet_id: string | null;
  suggested_category_id: string | null;
  confidence_pct: number;
  parse_status: ParseStatus;
  reason: string | null;
  candidate_transaction_id: string | null;
  candidate_observation_id: string | null;
  excerpt_enc: string | null;
  observed_at: number;
  created_at: number;
  updated_at: number;
};

/** Candidate-duplicate window for cross-source matching (Layer 4). */
const DEDUP_WINDOW_MS = 15 * 60_000;
/** Window for pairing opposite-direction events as a transfer (Layer 5). */
const TRANSFER_WINDOW_MS = 30 * 60_000;
/** Institutions whose wallet is known by name; others suggest Bank Account. */
const INSTITUTION_WALLET_NAMES: Record<string, string> = { jazzcash: 'JazzCash', easypaisa: 'Easypaisa' };
/** Parser expense-category keys → v2 category names. */
const PARSER_CATEGORY_NAMES: Record<string, string> = {
  food: 'Food', transport: 'Transport', recharge: 'Recharge', shopping: 'Shopping',
  health: 'Health', bills: 'Bills', fees: 'Fees', other: 'Other',
};
/** Parser income-source labels → v2 category names. */
const INCOME_SOURCE_CATEGORY_NAMES: Record<string, string> = {
  Refund: 'Refund', Work: 'Work', Gift: 'Gift', Other: 'Other Income',
};

interface TxnRow {
  id: string;
  classification: Transaction['classification'];
  status: Transaction['status'];
  amount_minor: number;
  currency: 'PKR';
  category_id: string | null;
  person_id: string | null;
  loan_id: string | null;
  counterparty_enc: string | null;
  note_enc: string | null;
  reference: string | null;
  occurred_at: number;
  local_date: string;
  origin: TransactionOrigin;
  idempotency_key: string | null;
  reverses_transaction_id: string | null;
  created_at: number;
  updated_at: number;
}

interface BaseInput {
  occurredAt?: number;
  note?: string | null;
  counterparty?: string | null;
  reference?: string | null;
  origin?: TransactionOrigin;
  idempotencyKey?: string | null;
  externalIdentity?: { scope: string; identity: string } | null;
}

export class LedgerRepository {
  private initialized = false;

  constructor(
    private readonly db: SqlDriver,
    private readonly protector: TextProtector,
    private readonly newId: IdGenerator,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /* ---------------------------------------------------------------- */
  /* Initialization (fresh v2 database; never touches the v1 file)      */
  /* ---------------------------------------------------------------- */

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.db.exec('PRAGMA foreign_keys = ON');
    await this.db.exec('PRAGMA journal_mode = WAL');
    for (const stmt of SCHEMA_STATEMENTS) await this.db.exec(stmt);
    // Column additions for pre-release v2 dev databases (v2 has not
    // shipped; keep init idempotent and upgrade-safe regardless).
    const ensureColumns: [string, string, string][] = [
      ['loans', 'reminder_date', 'ALTER TABLE loans ADD COLUMN reminder_date TEXT'],
      ['import_observations', 'amount_minor', 'ALTER TABLE import_observations ADD COLUMN amount_minor INTEGER'],
      ['import_observations', 'direction', "ALTER TABLE import_observations ADD COLUMN direction TEXT CHECK (direction IN ('in','out'))"],
      ['import_observations', 'counterparty_enc', 'ALTER TABLE import_observations ADD COLUMN counterparty_enc TEXT'],
      ['import_observations', 'reference', 'ALTER TABLE import_observations ADD COLUMN reference TEXT'],
      ['import_observations', 'local_date', 'ALTER TABLE import_observations ADD COLUMN local_date TEXT'],
      ['import_observations', 'suggested_classification', 'ALTER TABLE import_observations ADD COLUMN suggested_classification TEXT'],
      ['import_observations', 'suggested_wallet_id', 'ALTER TABLE import_observations ADD COLUMN suggested_wallet_id TEXT'],
      ['import_observations', 'suggested_category_id', 'ALTER TABLE import_observations ADD COLUMN suggested_category_id TEXT'],
      ['import_observations', 'confidence_pct', 'ALTER TABLE import_observations ADD COLUMN confidence_pct INTEGER NOT NULL DEFAULT 0'],
      ['import_observations', 'parse_status', "ALTER TABLE import_observations ADD COLUMN parse_status TEXT NOT NULL DEFAULT 'completed'"],
      ['import_observations', 'reason', 'ALTER TABLE import_observations ADD COLUMN reason TEXT'],
      ['import_observations', 'candidate_transaction_id', 'ALTER TABLE import_observations ADD COLUMN candidate_transaction_id TEXT'],
      ['import_observations', 'candidate_observation_id', 'ALTER TABLE import_observations ADD COLUMN candidate_observation_id TEXT'],
      ['import_observations', 'excerpt_enc', 'ALTER TABLE import_observations ADD COLUMN excerpt_enc TEXT'],
      ['import_observations', 'updated_at', 'ALTER TABLE import_observations ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0'],
    ];
    for (const [table, column, ddl] of ensureColumns) {
      const cols = await this.db.getAll<{ name: string }>(`PRAGMA table_info(${table})`);
      if (cols.length > 0 && !cols.some((c) => c.name === column)) {
        await this.db.exec(ddl);
      }
    }
    await this.db.transaction(async () => {
      const ts = this.now();
      await this.db.run(
        'INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)',
        [SCHEMA_VERSION, ts],
      );
      await this.db.run('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)', [META_SCHEMA_VERSION, String(SCHEMA_VERSION)]);
      await this.db.run('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)', [META_LEDGER_REVISION, '0']);
      await this.db.run(
        'INSERT OR IGNORE INTO accounts (id, kind, ref_id, label, created_at) VALUES (?, ?, NULL, ?, ?)',
        [EXTERNAL_ACCOUNT_ID, 'external', 'External world', ts],
      );
      for (const w of SEED_WALLETS) {
        const walletId = `wallet:seed:${w.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        await this.db.run(
          'INSERT OR IGNORE INTO wallets (id, name, kind, icon, color, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
          [walletId, w.name, w.kind, w.icon, w.color, ts, ts],
        );
        await this.db.run(
          'INSERT OR IGNORE INTO accounts (id, kind, ref_id, label, created_at) VALUES (?, ?, ?, ?, ?)',
          [this.walletAccountId(walletId), 'wallet', walletId, w.name, ts],
        );
      }
      for (const c of SEED_CATEGORIES) {
        const categoryId = `category:seed:${c.kind}:${c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        await this.db.run(
          'INSERT OR IGNORE INTO categories (id, name, kind, icon, color, archived, system, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, 0, 1, ?, ?)',
          [categoryId, c.name, c.kind, c.icon, ts, ts],
        );
      }
    });
    this.initialized = true;
  }

  private walletAccountId(walletId: string): string {
    return `account:wallet:${walletId}`;
  }
  private loanAccountId(loanId: string): string {
    return `account:loan:${loanId}`;
  }

  private async bumpRevision(): Promise<void> {
    await this.db.run(
      `INSERT INTO meta (key, value) VALUES (?, '1')
       ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)`,
      [META_LEDGER_REVISION],
    );
  }

  async getLedgerRevision(): Promise<number> {
    const row = await this.db.getFirst<{ value: string }>('SELECT value FROM meta WHERE key = ?', [META_LEDGER_REVISION]);
    return row ? Number(row.value) || 0 : 0;
  }

  /* ---------------------------------------------------------------- */
  /* Wallets, people, categories                                      */
  /* ---------------------------------------------------------------- */

  async createWallet(name: string, kind: WalletKind): Promise<Wallet> {
    await this.init();
    const clean = name.trim();
    if (!clean) throw new MoneyError('Wallet name is required.');
    const ts = this.now();
    const wallet: Wallet = {
      id: this.newId(), name: clean, kind, icon: null, color: null,
      archived: false, createdAt: ts, updatedAt: ts,
    };
    await this.db.transaction(async () => {
      await this.db.run(
        'INSERT INTO wallets (id, name, kind, icon, color, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
        [wallet.id, wallet.name, wallet.kind, wallet.icon, wallet.color, ts, ts],
      );
      await this.db.run(
        'INSERT INTO accounts (id, kind, ref_id, label, created_at) VALUES (?, ?, ?, ?, ?)',
        [this.walletAccountId(wallet.id), 'wallet', wallet.id, wallet.name, ts],
      );
      await this.bumpRevision();
    });
    return wallet;
  }

  async listWallets(opts: { includeArchived?: boolean } = {}): Promise<(Wallet & { balanceMinor: number })[]> {
    await this.init();
    const rows = await this.db.getAll<{
      id: string; name: string; kind: WalletKind; icon: string | null; color: string | null;
      archived: number; created_at: number; updated_at: number; balance: number | null;
    }>(
      `SELECT w.*, COALESCE(SUM(p.amount_minor), 0) AS balance
       FROM wallets w
       LEFT JOIN accounts a ON a.kind = 'wallet' AND a.ref_id = w.id
       LEFT JOIN postings p ON p.account_id = a.id
       ${opts.includeArchived ? '' : 'WHERE w.archived = 0'}
       GROUP BY w.id
       ORDER BY w.created_at, w.name`,
    );
    return rows.map((r) => ({
      id: r.id, name: r.name, kind: r.kind, icon: r.icon, color: r.color,
      archived: r.archived === 1, createdAt: r.created_at, updatedAt: r.updated_at,
      balanceMinor: r.balance ?? 0,
    }));
  }

  async getWalletByName(name: string): Promise<Wallet | null> {
    await this.init();
    const row = await this.db.getFirst<{ id: string; name: string; kind: WalletKind; icon: string | null; color: string | null; archived: number; created_at: number; updated_at: number }>(
      'SELECT * FROM wallets WHERE name = ? COLLATE NOCASE AND archived = 0 LIMIT 1',
      [name.trim()],
    );
    if (!row) return null;
    return {
      id: row.id, name: row.name, kind: row.kind, icon: row.icon, color: row.color,
      archived: row.archived === 1, createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  async getDefaultWallet(): Promise<Wallet> {
    const wallets = await this.listWallets();
    const cash = wallets.find((w) => w.name.toLowerCase() === 'cash') ?? wallets[0];
    if (!cash) throw new MoneyError('No wallet exists.');
    return cash;
  }

  async findOrCreatePerson(name: string, phone?: string | null): Promise<Person> {
    await this.init();
    const clean = normalizePersonName(name);
    if (!clean) throw new MoneyError('Person name is required.');
    const key = await this.protector.personKey(personNameKeyInput(clean));
    const existing = await this.db.getFirst<{ id: string; name_enc: string; phone: string | null; archived: number; created_at: number; updated_at: number }>(
      'SELECT * FROM people WHERE name_key = ?',
      [key],
    );
    if (existing) {
      return {
        id: existing.id,
        name: (await this.protector.decrypt(existing.name_enc)) ?? clean,
        phone: existing.phone, archived: existing.archived === 1,
        createdAt: existing.created_at, updatedAt: existing.updated_at,
      };
    }
    const ts = this.now();
    const person: Person = { id: this.newId(), name: clean, phone: phone ?? null, archived: false, createdAt: ts, updatedAt: ts };
    await this.db.run(
      'INSERT INTO people (id, name_enc, name_key, phone, archived, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
      [person.id, await this.protector.encrypt(clean), key, person.phone, ts, ts],
    );
    return person;
  }

  async listCategories(opts: { includeArchived?: boolean } = {}): Promise<Category[]> {
    await this.init();
    const rows = await this.db.getAll<{ id: string; name: string; kind: Category['kind']; icon: string | null; color: string | null; archived: number; system: number }>(
      `SELECT * FROM categories ${opts.includeArchived ? '' : 'WHERE archived = 0'} ORDER BY kind, name`,
    );
    return rows.map((r) => ({
      id: r.id, name: r.name, kind: r.kind, icon: r.icon, color: r.color,
      archived: r.archived === 1, system: r.system === 1,
    }));
  }

  async getCategoryByName(name: string, kind?: Category['kind']): Promise<Category | null> {
    await this.init();
    const rows = await this.listCategories();
    const wanted = name.trim().toLowerCase();
    return rows.find((c) => c.name.toLowerCase() === wanted && (!kind || c.kind === kind)) ?? null;
  }

  /* ---------------------------------------------------------------- */
  /* Core write path — one transaction, balanced postings             */
  /* ---------------------------------------------------------------- */

  private async insertPlannedInner(
    op: Operation,
    meta: {
      categoryId?: string | null;
      personId?: string | null;
      loanId?: string | null;
    } & BaseInput,
  ): Promise<RecordResult> {
    const planned = planPostings(op);
    const occurredAt = meta.occurredAt ?? this.now();
    const ts = this.now();

    {
      if (meta.idempotencyKey) {
        const existing = await this.db.getFirst<TxnRow>(
          'SELECT * FROM transactions WHERE idempotency_key = ?',
          [meta.idempotencyKey],
        );
        if (existing) return { transaction: await this.hydrateTxn(existing), created: false };
      }
      if (meta.externalIdentity) {
        const existing = await this.db.getFirst<TxnRow>(
          `SELECT t.* FROM external_identities e JOIN transactions t ON t.id = e.transaction_id
           WHERE e.scope = ? AND e.identity = ?`,
          [meta.externalIdentity.scope, meta.externalIdentity.identity],
        );
        if (existing) return { transaction: await this.hydrateTxn(existing), created: false };
      }

      const txn: Transaction = {
        id: this.newId(),
        classification: planned.classification,
        status: 'posted',
        amountMinor: planned.amountMinor,
        currency: 'PKR',
        categoryId: meta.categoryId ?? null,
        personId: meta.personId ?? null,
        loanId: meta.loanId ?? null,
        counterparty: meta.counterparty ?? null,
        note: meta.note ?? null,
        reference: meta.reference ?? null,
        occurredAt,
        localDate: localDateOf(occurredAt),
        origin: meta.origin ?? 'manual',
        idempotencyKey: meta.idempotencyKey ?? null,
        reversesTransactionId: null,
        createdAt: ts,
        updatedAt: ts,
      };

      await this.db.run(
        `INSERT INTO transactions (id, classification, status, amount_minor, currency, category_id,
           person_id, loan_id, counterparty_enc, note_enc, reference, occurred_at, local_date,
           origin, idempotency_key, reverses_transaction_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'PKR', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        [
          txn.id, txn.classification, txn.status, txn.amountMinor, txn.categoryId, txn.personId,
          txn.loanId, await this.protector.encrypt(txn.counterparty),
          await this.protector.encrypt(txn.note), txn.reference, txn.occurredAt, txn.localDate,
          txn.origin, txn.idempotencyKey, ts, ts,
        ],
      );
      for (const p of planned.postings) {
        await this.db.run(
          'INSERT INTO postings (id, transaction_id, account_id, amount_minor, created_at) VALUES (?, ?, ?, ?, ?)',
          [this.newId(), txn.id, p.accountId, p.amountMinor, ts],
        );
      }
      if (meta.externalIdentity) {
        await this.db.run(
          'INSERT INTO external_identities (id, scope, identity, transaction_id, created_at) VALUES (?, ?, ?, ?, ?)',
          [this.newId(), meta.externalIdentity.scope, meta.externalIdentity.identity, txn.id, ts],
        );
      }
      await this.bumpRevision();
      return { transaction: txn, created: true };
    }
  }

  /** Transaction-wrapped wrapper around insertPlannedInner (bulk and
   *  multi-step operations call the inner form inside their own single
   *  transaction so the whole operation stays atomic). */
  private async insertPlanned(
    op: Operation,
    meta: {
      categoryId?: string | null;
      personId?: string | null;
      loanId?: string | null;
    } & BaseInput,
  ): Promise<RecordResult> {
    return this.db.transaction(() => this.insertPlannedInner(op, meta));
  }

  private async hydrateTxn(row: TxnRow): Promise<Transaction> {
    return {
      id: row.id,
      classification: row.classification,
      status: row.status,
      amountMinor: row.amount_minor,
      currency: row.currency,
      categoryId: row.category_id,
      personId: row.person_id,
      loanId: row.loan_id,
      counterparty: await this.protector.decrypt(row.counterparty_enc),
      note: await this.protector.decrypt(row.note_enc),
      reference: row.reference,
      occurredAt: row.occurred_at,
      localDate: row.local_date,
      origin: row.origin,
      idempotencyKey: row.idempotency_key,
      reversesTransactionId: row.reverses_transaction_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async getTransaction(id: string): Promise<Transaction | null> {
    await this.init();
    const row = await this.db.getFirst<TxnRow>('SELECT * FROM transactions WHERE id = ?', [id]);
    return row ? this.hydrateTxn(row) : null;
  }

  /* ---------------------------------------------------------------- */
  /* Financial operations                                             */
  /* ---------------------------------------------------------------- */

  async setOpeningBalance(input: { walletId: string; signedAmountMinor: number } & BaseInput): Promise<RecordResult> {
    await this.init();
    return this.insertPlanned(
      { kind: 'opening_balance', walletAccountId: this.walletAccountId(input.walletId), signedAmountMinor: input.signedAmountMinor },
      input,
    );
  }

  async addIncome(input: { walletId: string; amountMinor: number; categoryId?: string | null } & BaseInput): Promise<RecordResult> {
    await this.init();
    return this.insertPlanned(
      { kind: 'income', walletAccountId: this.walletAccountId(input.walletId), amountMinor: input.amountMinor },
      { ...input, categoryId: input.categoryId ?? null },
    );
  }

  async addExpense(input: { walletId: string; amountMinor: number; categoryId?: string | null } & BaseInput): Promise<RecordResult> {
    await this.init();
    return this.insertPlanned(
      { kind: 'expense', walletAccountId: this.walletAccountId(input.walletId), amountMinor: input.amountMinor },
      { ...input, categoryId: input.categoryId ?? null },
    );
  }

  async addFee(input: { walletId: string; amountMinor: number } & BaseInput): Promise<RecordResult> {
    await this.init();
    return this.insertPlanned(
      { kind: 'fee', walletAccountId: this.walletAccountId(input.walletId), amountMinor: input.amountMinor },
      input,
    );
  }

  async addRefundReceived(input: { walletId: string; amountMinor: number } & BaseInput): Promise<RecordResult> {
    await this.init();
    return this.insertPlanned(
      { kind: 'refund_received', walletAccountId: this.walletAccountId(input.walletId), amountMinor: input.amountMinor },
      input,
    );
  }

  async addRefundIssued(input: { walletId: string; amountMinor: number } & BaseInput): Promise<RecordResult> {
    await this.init();
    return this.insertPlanned(
      { kind: 'refund_issued', walletAccountId: this.walletAccountId(input.walletId), amountMinor: input.amountMinor },
      input,
    );
  }

  async transfer(input: { fromWalletId: string; toWalletId: string; amountMinor: number } & BaseInput): Promise<RecordResult> {
    await this.init();
    return this.insertPlanned(
      {
        kind: 'transfer',
        fromWalletAccountId: this.walletAccountId(input.fromWalletId),
        toWalletAccountId: this.walletAccountId(input.toWalletId),
        amountMinor: input.amountMinor,
      },
      input,
    );
  }

  async adjustBalance(input: { walletId: string; signedAmountMinor: number } & BaseInput): Promise<RecordResult> {
    await this.init();
    return this.insertPlanned(
      { kind: 'balance_adjustment', walletAccountId: this.walletAccountId(input.walletId), signedAmountMinor: input.signedAmountMinor },
      input,
    );
  }

  /* ---------------------------------------------------------------- */
  /* Loans and repayments                                             */
  /* ---------------------------------------------------------------- */

  private async createLoan(
    direction: LoanDirection,
    input: { personName: string; phone?: string | null; walletId: string; amountMinor: number; dueDate?: string | null } & BaseInput,
  ): Promise<Loan> {
    await this.init();
    const amount = assertMinor(input.amountMinor);
    const person = await this.findOrCreatePerson(input.personName, input.phone);
    const occurredAt = input.occurredAt ?? this.now();
    const ts = this.now();
    const loanId = this.newId();
    const accountId = this.loanAccountId(loanId);
    const accountKind = direction === 'lent' ? 'receivable' : 'payable';

    const result = await this.db.transaction(async () => {
      await this.db.run(
        'INSERT INTO accounts (id, kind, ref_id, label, created_at) VALUES (?, ?, ?, ?, ?)',
        [accountId, accountKind, loanId, `Loan ${loanId}`, ts],
      );
      const op: Operation =
        direction === 'lent'
          ? { kind: 'loan_lent', walletAccountId: this.walletAccountId(input.walletId), loanAccountId: accountId, amountMinor: amount }
          : { kind: 'loan_borrowed', walletAccountId: this.walletAccountId(input.walletId), loanAccountId: accountId, amountMinor: amount };
      const planned = planPostings(op);
      const txnId = this.newId();
      await this.db.run(
        `INSERT INTO transactions (id, classification, status, amount_minor, currency, category_id,
           person_id, loan_id, counterparty_enc, note_enc, reference, occurred_at, local_date,
           origin, idempotency_key, reverses_transaction_id, created_at, updated_at)
         VALUES (?, ?, 'posted', ?, 'PKR', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        [
          txnId, planned.classification, planned.amountMinor, person.id, loanId,
          await this.protector.encrypt(input.counterparty ?? person.name),
          await this.protector.encrypt(input.note ?? null), input.reference ?? null,
          occurredAt, localDateOf(occurredAt), input.origin ?? 'manual',
          input.idempotencyKey ?? null, ts, ts,
        ],
      );
      for (const p of planned.postings) {
        await this.db.run(
          'INSERT INTO postings (id, transaction_id, account_id, amount_minor, created_at) VALUES (?, ?, ?, ?, ?)',
          [this.newId(), txnId, p.accountId, p.amountMinor, ts],
        );
      }
      await this.db.run(
        `INSERT INTO loans (id, person_id, direction, principal_minor, wallet_id,
           principal_transaction_id, settlement_transaction_id, occurred_at, local_date,
           due_date, note_enc, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 'open', ?, ?)`,
        [
          loanId, person.id, direction, amount, input.walletId, txnId,
          occurredAt, localDateOf(occurredAt), input.dueDate ?? null,
          await this.protector.encrypt(input.note ?? null), ts, ts,
        ],
      );
      await this.bumpRevision();
      return loanId;
    });

    const loan = await this.getLoan(result);
    if (!loan) throw new MoneyError('Loan was not created.');
    return loan;
  }

  async lend(input: { personName: string; phone?: string | null; walletId: string; amountMinor: number; dueDate?: string | null } & BaseInput): Promise<Loan> {
    return this.createLoan('lent', input);
  }

  async borrow(input: { personName: string; phone?: string | null; walletId: string; amountMinor: number; dueDate?: string | null } & BaseInput): Promise<Loan> {
    return this.createLoan('borrowed', input);
  }

  async getLoanRemainingMinor(loanId: string): Promise<number> {
    const row = await this.db.getFirst<{ total: number | null; direction: LoanDirection }>(
      `SELECT l.direction AS direction, COALESCE(SUM(p.amount_minor), 0) AS total
       FROM loans l
       LEFT JOIN accounts a ON a.ref_id = l.id AND a.kind IN ('receivable','payable')
       LEFT JOIN postings p ON p.account_id = a.id
       WHERE l.id = ?
       GROUP BY l.id`,
      [loanId],
    );
    if (!row) throw new MoneyError('Loan not found.');
    const sum = row.total ?? 0;
    return row.direction === 'lent' ? sum : -sum;
  }

  async getLoan(id: string): Promise<Loan | null> {
    await this.init();
    const row = await this.db.getFirst<{
      id: string; person_id: string; direction: LoanDirection; principal_minor: number;
      wallet_id: string; principal_transaction_id: string; settlement_transaction_id: string | null;
      occurred_at: number; local_date: string; due_date: string | null; reminder_date: string | null;
      note_enc: string | null; status: Loan['status']; created_at: number; updated_at: number;
      name_enc: string;
    }>(
      `SELECT l.*, p.name_enc FROM loans l JOIN people p ON p.id = l.person_id WHERE l.id = ?`,
      [id],
    );
    if (!row) return null;
    return {
      id: row.id,
      personId: row.person_id,
      personName: (await this.protector.decrypt(row.name_enc)) ?? '',
      direction: row.direction,
      principalMinor: row.principal_minor,
      walletId: row.wallet_id,
      principalTransactionId: row.principal_transaction_id,
      settlementTransactionId: row.settlement_transaction_id,
      occurredAt: row.occurred_at,
      localDate: row.local_date,
      dueDate: row.due_date,
      reminderDate: row.reminder_date ?? null,
      note: await this.protector.decrypt(row.note_enc),
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async listLoans(filter: { status?: Loan['status']; personId?: string } = {}): Promise<Loan[]> {
    await this.init();
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.status) { clauses.push('l.status = ?'); params.push(filter.status); }
    if (filter.personId) { clauses.push('l.person_id = ?'); params.push(filter.personId); }
    const rows = await this.db.getAll<{ id: string }>(
      `SELECT l.id FROM loans l ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY l.occurred_at DESC, l.created_at DESC`,
      params,
    );
    const out: Loan[] = [];
    for (const r of rows) {
      const loan = await this.getLoan(r.id);
      if (loan) out.push(loan);
    }
    return out;
  }

  private async refreshLoanStatus(loanId: string): Promise<void> {
    const loan = await this.getLoan(loanId);
    if (!loan || loan.status === 'void') return;
    const remaining = await this.getLoanRemainingMinor(loanId);
    if (remaining < 0) throw new MoneyError('Loan remaining balance went negative — refusing to continue.');
    const status: Loan['status'] = remaining === 0 ? 'settled' : remaining < loan.principalMinor ? 'partially_paid' : 'open';
    await this.db.run('UPDATE loans SET status = ?, updated_at = ? WHERE id = ?', [status, this.now(), loanId]);
  }

  async recordRepayment(input: { loanId: string; walletId?: string; amountMinor: number } & BaseInput): Promise<RecordResult> {
    await this.init();
    const amount = assertMinor(input.amountMinor);
    // Validation, posting and loan-status update commit together or not at all.
    return this.db.transaction(async () => {
      const loan = await this.getLoan(input.loanId);
      if (!loan) throw new MoneyError('Loan not found.');
      if (loan.status === 'void') throw new MoneyError('Cannot repay a void loan.');
      const remaining = await this.getLoanRemainingMinor(loan.id);
      if (amount > remaining) {
        throw new MoneyError(`Repayment of ${amount} paisa exceeds the remaining balance of ${remaining} paisa.`);
      }
      const accountId = this.loanAccountId(loan.id);
      const op: Operation =
        loan.direction === 'lent'
          ? { kind: 'repayment_received', walletAccountId: this.walletAccountId(input.walletId ?? loan.walletId), loanAccountId: accountId, amountMinor: amount }
          : { kind: 'repayment_made', walletAccountId: this.walletAccountId(input.walletId ?? loan.walletId), loanAccountId: accountId, amountMinor: amount };
      const result = await this.insertPlannedInner(op, { ...input, loanId: loan.id, personId: loan.personId });
      if (result.created) {
        await this.refreshLoanStatus(loan.id);
        if (remaining - amount === 0) {
          await this.db.run('UPDATE loans SET settlement_transaction_id = ? WHERE id = ?', [result.transaction.id, loan.id]);
        }
      }
      return result;
    });
  }

  /* ---------------------------------------------------------------- */
  /* Reversals (append-only corrections)                              */
  /* ---------------------------------------------------------------- */

  async reverseTransaction(transactionId: string, input: BaseInput = {}): Promise<RecordResult> {
    await this.init();
    return this.db.transaction(() => this.reverseInner(transactionId, input));
  }

  /** Reversal core — caller must already hold a database transaction.
   *  `skipLoanStatusRefresh` is for callers (loan principal edits) whose
   *  intermediate state is briefly inconsistent by construction; they
   *  refresh the loan status themselves once reconstruction completes. */
  private async reverseInner(transactionId: string, input: BaseInput = {}, opts: { skipLoanStatusRefresh?: boolean } = {}): Promise<RecordResult> {
    {
      const original = await this.db.getFirst<TxnRow>('SELECT * FROM transactions WHERE id = ?', [transactionId]);
      if (!original) throw new MoneyError('Transaction not found.');
      if (original.status === 'reversed') throw new MoneyError('Transaction is already reversed.');
      if (original.reverses_transaction_id) throw new MoneyError('A reversal entry cannot itself be reversed.');
      const postingRows = await this.db.getAll<{ account_id: string; kind: AccountKindOf; amount_minor: number }>(
        `SELECT p.account_id AS account_id, a.kind AS kind, p.amount_minor AS amount_minor
         FROM postings p JOIN accounts a ON a.id = p.account_id WHERE p.transaction_id = ?`,
        [transactionId],
      );
      const specs: PostingSpec[] = postingRows.map((r) => ({ accountId: r.account_id, accountKind: r.kind, amountMinor: r.amount_minor }));
      const reversed = reversePostings(specs);
      assertBalanced(reversed);
      const ts = this.now();
      const occurredAt = input.occurredAt ?? ts;
      const reversal: Transaction = {
        id: this.newId(),
        classification: original.classification,
        status: 'posted',
        amountMinor: original.amount_minor,
        currency: 'PKR',
        categoryId: original.category_id,
        personId: original.person_id,
        loanId: original.loan_id,
        counterparty: await this.protector.decrypt(original.counterparty_enc),
        note: input.note ?? 'Reversal',
        reference: original.reference,
        occurredAt,
        localDate: localDateOf(occurredAt),
        origin: input.origin ?? 'manual',
        idempotencyKey: input.idempotencyKey ?? null,
        reversesTransactionId: original.id,
        createdAt: ts,
        updatedAt: ts,
      };
      await this.db.run(
        `INSERT INTO transactions (id, classification, status, amount_minor, currency, category_id,
           person_id, loan_id, counterparty_enc, note_enc, reference, occurred_at, local_date,
           origin, idempotency_key, reverses_transaction_id, created_at, updated_at)
         VALUES (?, ?, 'posted', ?, 'PKR', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          reversal.id, reversal.classification, reversal.amountMinor, reversal.categoryId,
          reversal.personId, reversal.loanId, original.counterparty_enc, await this.protector.encrypt(reversal.note),
          reversal.reference, reversal.occurredAt, reversal.localDate, reversal.origin,
          reversal.idempotencyKey, reversal.reversesTransactionId, ts, ts,
        ],
      );
      for (const p of reversed) {
        await this.db.run(
          'INSERT INTO postings (id, transaction_id, account_id, amount_minor, created_at) VALUES (?, ?, ?, ?, ?)',
          [this.newId(), reversal.id, p.accountId, p.amountMinor, ts],
        );
      }
      await this.db.run("UPDATE transactions SET status = 'reversed', updated_at = ? WHERE id = ?", [ts, original.id]);
      if (original.loan_id) {
        await this.db.run('UPDATE loans SET settlement_transaction_id = NULL WHERE settlement_transaction_id = ?', [original.id]);
        if (!opts.skipLoanStatusRefresh) await this.refreshLoanStatus(original.loan_id);
      }
      await this.bumpRevision();
      return { transaction: reversal, created: true };
    }
  }

  /* ---------------------------------------------------------------- */
  /* Reporting — one definition for every screen                      */
  /* ---------------------------------------------------------------- */

  async getDashboard(monthPrefix: string): Promise<DashboardSummaryV2> {
    await this.init();
    const totals = await this.db.getFirst<{ cash: number | null; recv: number | null; pay: number | null }>(
      `SELECT
         COALESCE(SUM(CASE WHEN a.kind = 'wallet' THEN p.amount_minor END), 0) AS cash,
         COALESCE(SUM(CASE WHEN a.kind = 'receivable' THEN p.amount_minor END), 0) AS recv,
         COALESCE(SUM(CASE WHEN a.kind = 'payable' THEN -p.amount_minor END), 0) AS pay
       FROM postings p JOIN accounts a ON a.id = p.account_id`,
    );
    const month = await this.db.getFirst<{ income: number | null; expenses: number | null }>(
      `SELECT
         COALESCE(SUM(CASE WHEN classification = 'income' THEN amount_minor END), 0) AS income,
         COALESCE(SUM(CASE WHEN classification IN ('expense','fee') THEN amount_minor END), 0) AS expenses
       FROM transactions
       WHERE status = 'posted' AND reverses_transaction_id IS NULL
         AND substr(local_date, 1, 7) = ?`,
      [monthPrefix],
    );
    const cashFlow = await this.db.getFirst<{ total: number | null }>(
      `SELECT COALESCE(SUM(p.amount_minor), 0) AS total
       FROM postings p
       JOIN accounts a ON a.id = p.account_id AND a.kind = 'wallet'
       JOIN transactions t ON t.id = p.transaction_id
       WHERE t.classification != 'opening_balance'
         AND substr(t.local_date, 1, 7) = ?`,
      [monthPrefix],
    );
    const income = month?.income ?? 0;
    const expenses = month?.expenses ?? 0;
    const cash = totals?.cash ?? 0;
    const receivables = totals?.recv ?? 0;
    const payables = totals?.pay ?? 0;
    return {
      availableCashMinor: cash,
      receivablesMinor: receivables,
      payablesMinor: payables,
      netWorthMinor: cash + receivables - payables,
      monthIncomeMinor: income,
      monthExpensesMinor: expenses,
      monthNetMinor: income - expenses,
      monthNetCashFlowMinor: cashFlow?.total ?? 0,
      ledgerRevision: await this.getLedgerRevision(),
    };
  }

  async getMonthlyStats(monthsBack: number, nowMs?: number): Promise<MonthlyStatV2[]> {
    await this.init();
    const base = new Date(nowMs ?? this.now());
    const out: MonthlyStatV2[] = [];
    for (let i = monthsBack - 1; i >= 0; i--) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
      const prefix = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const dash = await this.getDashboard(prefix);
      out.push({
        month: prefix,
        incomeMinor: dash.monthIncomeMinor,
        expensesMinor: dash.monthExpensesMinor,
        netCashFlowMinor: dash.monthNetCashFlowMinor,
      });
    }
    return out;
  }

  async getTopCategories(monthPrefix: string, limit = 5): Promise<{ categoryId: string | null; name: string; totalMinor: number }[]> {
    await this.init();
    const rows = await this.db.getAll<{ category_id: string | null; name: string | null; total: number }>(
      `SELECT t.category_id AS category_id, c.name AS name, SUM(t.amount_minor) AS total
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.status = 'posted' AND t.reverses_transaction_id IS NULL
         AND t.classification IN ('expense','fee') AND substr(t.local_date, 1, 7) = ?
       GROUP BY t.category_id ORDER BY total DESC LIMIT ?`,
      [monthPrefix, limit],
    );
    return rows.map((r) => ({ categoryId: r.category_id, name: r.name ?? 'Other', totalMinor: r.total }));
  }

  async listTransactions(filter: TransactionQuery = {}): Promise<Transaction[]> {
    await this.init();
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (!filter.includeReversed) clauses.push("t.status = 'posted'", 't.reverses_transaction_id IS NULL');
    if (filter.monthPrefix) { clauses.push('substr(t.local_date, 1, 7) = ?'); params.push(filter.monthPrefix); }
    if (filter.classification) { clauses.push('t.classification = ?'); params.push(filter.classification); }
    if (filter.classifications?.length) {
      clauses.push(`t.classification IN (${filter.classifications.map(() => '?').join(',')})`);
      params.push(...filter.classifications);
    }
    if (filter.dateFrom) { clauses.push('t.local_date >= ?'); params.push(filter.dateFrom); }
    if (filter.dateTo) { clauses.push('t.local_date <= ?'); params.push(filter.dateTo); }
    if (filter.minAmountMinor != null) { clauses.push('t.amount_minor >= ?'); params.push(filter.minAmountMinor); }
    if (filter.maxAmountMinor != null) { clauses.push('t.amount_minor <= ?'); params.push(filter.maxAmountMinor); }
    if (filter.categoryId) { clauses.push('t.category_id = ?'); params.push(filter.categoryId); }
    if (filter.loanId) { clauses.push('t.loan_id = ?'); params.push(filter.loanId); }
    if (filter.personId) { clauses.push('t.person_id = ?'); params.push(filter.personId); }
    if (filter.walletId) {
      clauses.push('EXISTS (SELECT 1 FROM postings p WHERE p.transaction_id = t.id AND p.account_id = ?)');
      params.push(this.walletAccountId(filter.walletId));
    }
    const search = filter.search?.trim().toLowerCase();
    // Text search covers encrypted fields, so it runs after hydration over a
    // bounded candidate set (personal-finance scale). Structured filters and
    // sorting still happen in SQL whenever no text search is requested.
    const fetchLimit = search ? 2000 : Math.min(Math.max(filter.limit ?? 50, 1), 500) + Math.max(filter.offset ?? 0, 0);
    const orderBy =
      filter.sort === 'date_asc'
        ? 't.occurred_at ASC, t.created_at ASC'
        : filter.sort === 'amount_desc'
          ? 't.amount_minor DESC, t.occurred_at DESC'
          : filter.sort === 'amount_asc'
            ? 't.amount_minor ASC, t.occurred_at DESC'
            : 't.occurred_at DESC, t.created_at DESC';
    const rows = await this.db.getAll<TxnRow>(
      `SELECT t.* FROM transactions t ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
       ORDER BY ${orderBy} LIMIT ?`,
      [...params, fetchLimit],
    );
    let out: Transaction[] = [];
    for (const r of rows) out.push(await this.hydrateTxn(r));
    if (search) {
      const categoryNames = new Map((await this.listCategories({ includeArchived: true })).map((c) => [c.id, c.name.toLowerCase()]));
      out = out.filter((t) => {
        const haystack = [
          t.counterparty ?? '',
          t.note ?? '',
          t.reference ?? '',
          t.classification.replace(/_/g, ' '),
          t.categoryId ? (categoryNames.get(t.categoryId) ?? '') : '',
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(search);
      });
      if (!filter.sort || filter.sort === 'date_desc') out.sort((a, b) => b.occurredAt - a.occurredAt || b.createdAt - a.createdAt);
    }
    const offset = Math.max(filter.offset ?? 0, 0);
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500);
    return out.slice(offset, offset + limit);
  }

  /** Count of transactions matching a query (for pagination labels). */
  async countTransactions(filter: TransactionQuery = {}): Promise<number> {
    if (filter.search?.trim()) {
      const all = await this.listTransactions({ ...filter, limit: 500, offset: 0 });
      return all.length;
    }
    await this.init();
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (!filter.includeReversed) clauses.push("status = 'posted'", 'reverses_transaction_id IS NULL');
    if (filter.monthPrefix) { clauses.push('substr(local_date, 1, 7) = ?'); params.push(filter.monthPrefix); }
    if (filter.classification) { clauses.push('classification = ?'); params.push(filter.classification); }
    if (filter.classifications?.length) {
      clauses.push(`classification IN (${filter.classifications.map(() => '?').join(',')})`);
      params.push(...filter.classifications);
    }
    if (filter.dateFrom) { clauses.push('local_date >= ?'); params.push(filter.dateFrom); }
    if (filter.dateTo) { clauses.push('local_date <= ?'); params.push(filter.dateTo); }
    if (filter.categoryId) { clauses.push('category_id = ?'); params.push(filter.categoryId); }
    if (filter.loanId) { clauses.push('loan_id = ?'); params.push(filter.loanId); }
    if (filter.personId) { clauses.push('person_id = ?'); params.push(filter.personId); }
    const row = await this.db.getFirst<{ n: number }>(
      `SELECT COUNT(*) AS n FROM transactions ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}`,
      params,
    );
    return row?.n ?? 0;
  }

  /** Postings of one transaction with account labels (detail screens). */
  async getTransactionPostings(transactionId: string): Promise<TransactionPostingView[]> {
    await this.init();
    const rows = await this.db.getAll<{
      account_id: string; kind: AccountKindOf; amount_minor: number; ref_id: string | null; wallet_name: string | null;
    }>(
      `SELECT p.account_id AS account_id, a.kind AS kind, p.amount_minor AS amount_minor,
              a.ref_id AS ref_id, w.name AS wallet_name
       FROM postings p
       JOIN accounts a ON a.id = p.account_id
       LEFT JOIN wallets w ON w.id = a.ref_id AND a.kind = 'wallet'
       WHERE p.transaction_id = ?
       ORDER BY p.amount_minor DESC`,
      [transactionId],
    );
    return rows.map((r) => ({
      accountId: r.account_id,
      accountKind: r.kind,
      amountMinor: r.amount_minor,
      walletId: r.kind === 'wallet' ? r.ref_id : null,
      walletName: r.wallet_name,
    }));
  }

  async getRecentTransactions(limit = 8): Promise<Transaction[]> {
    return this.listTransactions({ limit });
  }

  /** Per-person open loan aggregates (remaining balances, not principals). */
  async getPersonSummaries(): Promise<{ person: Person; lentMinor: number; borrowedMinor: number; netMinor: number; openCount: number }[]> {
    await this.init();
    const loans = await this.listLoans();
    const byPerson = new Map<string, { person: Person; lentMinor: number; borrowedMinor: number; netMinor: number; openCount: number }>();
    for (const loan of loans) {
      if (loan.status === 'void') continue;
      const remaining = await this.getLoanRemainingMinor(loan.id);
      if (remaining <= 0) continue;
      let entry = byPerson.get(loan.personId);
      if (!entry) {
        const personRow = await this.db.getFirst<{ name_enc: string; phone: string | null; archived: number; created_at: number; updated_at: number }>(
          'SELECT * FROM people WHERE id = ?',
          [loan.personId],
        );
        entry = {
          person: {
            id: loan.personId,
            name: (await this.protector.decrypt(personRow?.name_enc ?? null)) ?? loan.personName,
            phone: personRow?.phone ?? null,
            archived: personRow?.archived === 1,
            createdAt: personRow?.created_at ?? loan.createdAt,
            updatedAt: personRow?.updated_at ?? loan.updatedAt,
          },
          lentMinor: 0, borrowedMinor: 0, netMinor: 0, openCount: 0,
        };
        byPerson.set(loan.personId, entry);
      }
      if (loan.direction === 'lent') entry.lentMinor += remaining;
      else entry.borrowedMinor += remaining;
      entry.openCount += 1;
    }
    const out = [...byPerson.values()];
    for (const e of out) e.netMinor = e.lentMinor - e.borrowedMinor;
    out.sort((a, b) => a.person.name.localeCompare(b.person.name, undefined, { sensitivity: 'base' }));
    return out;
  }

  /* ---------------------------------------------------------------- */
  /* Import dedup identities + observations (M4 builds on this)     */
  /* ---------------------------------------------------------------- */

  async findByExternalIdentity(scope: string, identity: string): Promise<Transaction | null> {
    await this.init();
    const row = await this.db.getFirst<TxnRow>(
      `SELECT t.* FROM external_identities e JOIN transactions t ON t.id = e.transaction_id
       WHERE e.scope = ? AND e.identity = ?`,
      [scope, identity],
    );
    return row ? this.hydrateTxn(row) : null;
  }

  async recordObservation(input: {
    source: 'sms' | 'notification' | 'statement' | 'manual' | 'share' | 'paste';
    fingerprint: string;
    institution?: string | null;
    externalScope?: string | null;
    externalIdentity?: string | null;
    status?: 'new' | 'needs_review' | 'imported' | 'ignored' | 'duplicate';
    transactionId?: string | null;
    observedAt?: number;
  }): Promise<{ id: string; created: boolean }> {
    await this.init();
    const existing = await this.db.getFirst<{ id: string }>(
      'SELECT id FROM import_observations WHERE fingerprint = ?',
      [input.fingerprint],
    );
    if (existing) return { id: existing.id, created: false };
    const id = this.newId();
    await this.db.run(
      `INSERT INTO import_observations (id, source, fingerprint, institution, external_scope,
         external_identity, status, transaction_id, observed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, input.source, input.fingerprint, input.institution ?? null, input.externalScope ?? null,
        input.externalIdentity ?? null, input.status ?? 'new', input.transactionId ?? null,
        input.observedAt ?? this.now(), this.now(),
      ],
    );
    return { id, created: true };
  }

  /* ---------------------------------------------------------------- */
  /* Integrity verification                                           */
  /* ---------------------------------------------------------------- */

  async verifyIntegrity(): Promise<{ ok: boolean; problems: string[] }> {
    await this.init();
    const problems: string[] = [];
    const unbalanced = await this.db.getAll<{ id: string; total: number }>(
      `SELECT t.id AS id, COALESCE(SUM(p.amount_minor), 0) AS total
       FROM transactions t LEFT JOIN postings p ON p.transaction_id = t.id
       GROUP BY t.id HAVING total != 0`,
    );
    for (const u of unbalanced) problems.push(`Transaction ${u.id} postings sum to ${u.total}, not zero.`);
    const noPostings = await this.db.getAll<{ id: string }>(
      `SELECT t.id AS id FROM transactions t
       LEFT JOIN postings p ON p.transaction_id = t.id
       GROUP BY t.id HAVING COUNT(p.id) < 2`,
    );
    for (const n of noPostings) problems.push(`Transaction ${n.id} has fewer than two postings.`);
    const loans = await this.listLoans();
    for (const loan of loans) {
      if (loan.status === 'void') continue;
      const remaining = await this.getLoanRemainingMinor(loan.id);
      if (remaining < 0) problems.push(`Loan ${loan.id} has a negative remaining balance (${remaining}).`);
      if (remaining > loan.principalMinor) problems.push(`Loan ${loan.id} remaining (${remaining}) exceeds principal (${loan.principalMinor}).`);
    }
    const badLinks = await this.db.getAll<{ id: string }>(
      `SELECT t.id AS id FROM transactions t
       WHERE t.reverses_transaction_id IS NOT NULL
         AND (t.reverses_transaction_id = t.id
              OR NOT EXISTS (SELECT 1 FROM transactions o WHERE o.id = t.reverses_transaction_id))`,
    );
    for (const b of badLinks) problems.push(`Transaction ${b.id} has an invalid reversal link.`);
    const fk = await this.db.getAll<{ table: string }>('PRAGMA foreign_key_check');
    if (fk.length > 0) problems.push(`Foreign key violations in: ${fk.map((r) => r.table).join(', ')}`);
    return { ok: problems.length === 0, problems };
  }

  /** Look up a person by name WITHOUT creating one (read paths). */
  async getPersonByName(name: string): Promise<Person | null> {
    await this.init();
    const key = await this.protector.personKey(personNameKeyInput(normalizePersonName(name)));
    const row = await this.db.getFirst<{ id: string; name_enc: string; phone: string | null; archived: number; created_at: number; updated_at: number }>(
      'SELECT * FROM people WHERE name_key = ?',
      [key],
    );
    if (!row) return null;
    return {
      id: row.id,
      name: (await this.protector.decrypt(row.name_enc)) ?? name,
      phone: row.phone, archived: row.archived === 1,
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  /** All-time income / expense totals (paisa) over posted transactions. */
  async getAllTimeTotals(): Promise<{ incomeMinor: number; expensesMinor: number }> {
    await this.init();
    const row = await this.db.getFirst<{ income: number | null; expenses: number | null }>(
      `SELECT
         COALESCE(SUM(CASE WHEN classification = 'income' THEN amount_minor END), 0) AS income,
         COALESCE(SUM(CASE WHEN classification IN ('expense','fee') THEN amount_minor END), 0) AS expenses
       FROM transactions
       WHERE status = 'posted' AND reverses_transaction_id IS NULL`,
    );
    return { incomeMinor: row?.income ?? 0, expensesMinor: row?.expenses ?? 0 };
  }

  /**
   * Void a loan: reverse its repayments first, then its principal, and
   * mark it void. Ledger history stays complete and balanced — nothing
   * is deleted.
   */
  async voidLoan(loanId: string): Promise<void> {
    await this.init();
    await this.db.transaction(() => this.voidLoanInner(loanId));
  }

  /** Void core — caller must already hold a database transaction. */
  private async voidLoanInner(loanId: string): Promise<void> {
    const loan = await this.getLoan(loanId);
    if (!loan || loan.status === 'void') return;
    const txns = await this.db.getAll<{ id: string; classification: string }>(
      `SELECT id, classification FROM transactions
       WHERE loan_id = ? AND status = 'posted' AND reverses_transaction_id IS NULL
       ORDER BY CASE WHEN classification IN ('repayment_received','repayment_made') THEN 0 ELSE 1 END, created_at`,
      [loanId],
    );
    for (const t of txns) {
      await this.reverseInner(t.id, { note: 'Loan voided' });
    }
    await this.db.run("UPDATE loans SET status = 'void', settlement_transaction_id = NULL, updated_at = ? WHERE id = ?", [this.now(), loanId]);
  }

  /* ---------------------------------------------------------------- */
  /* M3 — Wallet management (Phase 7)                                 */
  /* ---------------------------------------------------------------- */

  async updateWallet(id: string, patch: { name?: string; kind?: WalletKind; icon?: string | null; color?: string | null }): Promise<Wallet> {
    await this.init();
    const row = await this.db.getFirst<{ id: string }>('SELECT id FROM wallets WHERE id = ?', [id]);
    if (!row) throw new MoneyError('Wallet not found.');
    const name = patch.name !== undefined ? patch.name.trim() : undefined;
    if (name !== undefined && !name) throw new MoneyError('Wallet name is required.');
    await this.db.transaction(async () => {
      await this.db.run(
        `UPDATE wallets SET
           name = COALESCE(?, name), kind = COALESCE(?, kind),
           icon = CASE WHEN ? THEN ? ELSE icon END,
           color = CASE WHEN ? THEN ? ELSE color END,
           updated_at = ?
         WHERE id = ?`,
        [
          name ?? null, patch.kind ?? null,
          patch.icon !== undefined ? 1 : 0, patch.icon ?? null,
          patch.color !== undefined ? 1 : 0, patch.color ?? null,
          this.now(), id,
        ],
      );
      if (name) await this.db.run('UPDATE accounts SET label = ? WHERE kind = ? AND ref_id = ?', [name, 'wallet', id]);
      await this.bumpRevision();
    });
    const updated = (await this.listWallets({ includeArchived: true })).find((w) => w.id === id);
    if (!updated) throw new MoneyError('Wallet not found.');
    return updated;
  }

  async setWalletArchived(id: string, archived: boolean): Promise<void> {
    await this.init();
    await this.db.transaction(async () => {
      const res = await this.db.run('UPDATE wallets SET archived = ?, updated_at = ? WHERE id = ?', [archived ? 1 : 0, this.now(), id]);
      if (res.changes === 0) throw new MoneyError('Wallet not found.');
      await this.bumpRevision();
    });
  }

  /** Hard-delete a wallet ONLY when it has never been used. Otherwise archive. */
  async deleteWallet(id: string): Promise<void> {
    await this.init();
    await this.db.transaction(async () => {
      const postings = await this.db.getFirst<{ n: number }>(
        'SELECT COUNT(*) AS n FROM postings WHERE account_id = ?',
        [this.walletAccountId(id)],
      );
      if ((postings?.n ?? 0) > 0) throw new MoneyError('This wallet has transactions. Archive it instead of deleting.');
      const loans = await this.db.getFirst<{ n: number }>('SELECT COUNT(*) AS n FROM loans WHERE wallet_id = ?', [id]);
      if ((loans?.n ?? 0) > 0) throw new MoneyError('This wallet is linked to udhaar records. Archive it instead of deleting.');
      await this.db.run('DELETE FROM accounts WHERE kind = ? AND ref_id = ?', ['wallet', id]);
      const res = await this.db.run('DELETE FROM wallets WHERE id = ?', [id]);
      if (res.changes === 0) throw new MoneyError('Wallet not found.');
      await this.bumpRevision();
    });
  }

  async getWalletDetail(id: string): Promise<{
    wallet: Wallet & { balanceMinor: number };
    transactionCount: number;
    hasOpeningBalance: boolean;
    recent: Transaction[];
  }> {
    await this.init();
    const wallet = (await this.listWallets({ includeArchived: true })).find((w) => w.id === id);
    if (!wallet) throw new MoneyError('Wallet not found.');
    const count = await this.db.getFirst<{ n: number }>(
      'SELECT COUNT(*) AS n FROM postings WHERE account_id = ?',
      [this.walletAccountId(id)],
    );
    const opening = await this.db.getFirst<{ n: number }>(
      `SELECT COUNT(*) AS n FROM transactions t
       JOIN postings p ON p.transaction_id = t.id
       WHERE p.account_id = ? AND t.classification = 'opening_balance' AND t.status = 'posted'`,
      [this.walletAccountId(id)],
    );
    return {
      wallet,
      transactionCount: count?.n ?? 0,
      hasOpeningBalance: (opening?.n ?? 0) > 0,
      recent: await this.listTransactions({ walletId: id, limit: 20 }),
    };
  }

  /**
   * Reconcile a wallet against a known actual balance. With no postings
   * yet, the actual balance becomes the opening balance; otherwise the
   * difference is posted as a balance adjustment. Never overwrites the
   * recorded balance silently.
   */
  async reconcileWallet(walletId: string, actualMinor: number, input: BaseInput = {}): Promise<{ adjusted: boolean; deltaMinor: number; balanceBeforeMinor: number; transaction: Transaction | null }> {
    await this.init();
    assertMinor(actualMinor, { allowZero: true, field: 'actual balance' });
    const detail = await this.getWalletDetail(walletId);
    const before = detail.wallet.balanceMinor;
    const delta = actualMinor - before;
    if (delta === 0) return { adjusted: false, deltaMinor: 0, balanceBeforeMinor: before, transaction: null };
    const result =
      detail.transactionCount === 0
        ? await this.setOpeningBalance({ walletId, signedAmountMinor: actualMinor, ...input })
        : await this.adjustBalance({ walletId, signedAmountMinor: delta, ...input });
    return { adjusted: true, deltaMinor: delta, balanceBeforeMinor: before, transaction: result.transaction };
  }

  /* ---------------------------------------------------------------- */
  /* M3 — People management                                           */
  /* ---------------------------------------------------------------- */

  async listPeople(opts: { includeArchived?: boolean; search?: string } = {}): Promise<Person[]> {
    await this.init();
    const rows = await this.db.getAll<{ id: string; name_enc: string; phone: string | null; archived: number; created_at: number; updated_at: number }>(
      `SELECT * FROM people ${opts.includeArchived ? '' : 'WHERE archived = 0'} ORDER BY created_at`,
    );
    const out: Person[] = [];
    for (const r of rows) {
      out.push({
        id: r.id,
        name: (await this.protector.decrypt(r.name_enc)) ?? '',
        phone: r.phone, archived: r.archived === 1,
        createdAt: r.created_at, updatedAt: r.updated_at,
      });
    }
    const q = opts.search?.trim().toLowerCase();
    const filtered = q ? out.filter((p) => p.name.toLowerCase().includes(q) || (p.phone ?? '').includes(q)) : out;
    filtered.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    return filtered;
  }

  async updatePerson(id: string, patch: { name?: string; phone?: string | null }): Promise<Person> {
    await this.init();
    const existing = await this.db.getFirst<{ id: string }>('SELECT id FROM people WHERE id = ?', [id]);
    if (!existing) throw new MoneyError('Person not found.');
    await this.db.transaction(async () => {
      if (patch.name !== undefined) {
        const clean = normalizePersonName(patch.name);
        if (!clean) throw new MoneyError('Person name is required.');
        const key = await this.protector.personKey(personNameKeyInput(clean));
        const clash = await this.db.getFirst<{ id: string }>('SELECT id FROM people WHERE name_key = ? AND id != ?', [key, id]);
        if (clash) throw new MoneyError('Another person already uses this name. Merge is not supported — pick a different name.');
        await this.db.run('UPDATE people SET name_enc = ?, name_key = ?, updated_at = ? WHERE id = ?', [
          await this.protector.encrypt(clean), key, this.now(), id,
        ]);
      }
      if (patch.phone !== undefined) {
        await this.db.run('UPDATE people SET phone = ?, updated_at = ? WHERE id = ?', [patch.phone, this.now(), id]);
      }
      await this.bumpRevision();
    });
    const updated = (await this.listPeople({ includeArchived: true })).find((p) => p.id === id);
    if (!updated) throw new MoneyError('Person not found.');
    return updated;
  }

  async setPersonArchived(id: string, archived: boolean): Promise<void> {
    await this.init();
    const res = await this.db.run('UPDATE people SET archived = ?, updated_at = ? WHERE id = ?', [archived ? 1 : 0, this.now(), id]);
    if (res.changes === 0) throw new MoneyError('Person not found.');
  }

  /** Delete a person only when they have no financial records at all. */
  async deletePerson(id: string): Promise<void> {
    await this.init();
    await this.db.transaction(async () => {
      const loans = await this.db.getFirst<{ n: number }>('SELECT COUNT(*) AS n FROM loans WHERE person_id = ?', [id]);
      if ((loans?.n ?? 0) > 0) throw new MoneyError('This person has udhaar records. Archive them instead of deleting.');
      const txns = await this.db.getFirst<{ n: number }>('SELECT COUNT(*) AS n FROM transactions WHERE person_id = ?', [id]);
      if ((txns?.n ?? 0) > 0) throw new MoneyError('This person has transactions. Archive them instead of deleting.');
      const res = await this.db.run('DELETE FROM people WHERE id = ?', [id]);
      if (res.changes === 0) throw new MoneyError('Person not found.');
      await this.bumpRevision();
    });
  }

  /* ---------------------------------------------------------------- */
  /* M3 — Category management                                         */
  /* ---------------------------------------------------------------- */

  async createCategory(input: { name: string; kind: Category['kind']; icon?: string | null; color?: string | null }): Promise<Category> {
    await this.init();
    const name = input.name.trim();
    if (!name) throw new MoneyError('Category name is required.');
    if (await this.getCategoryByName(name, input.kind)) throw new MoneyError('A category with this name already exists.');
    const ts = this.now();
    const category: Category = {
      id: this.newId(), name, kind: input.kind,
      icon: input.icon ?? null, color: input.color ?? null,
      archived: false, system: false,
    };
    await this.db.transaction(async () => {
      await this.db.run(
        'INSERT INTO categories (id, name, kind, icon, color, archived, system, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)',
        [category.id, category.name, category.kind, category.icon, category.color, ts, ts],
      );
      await this.bumpRevision();
    });
    return category;
  }

  async updateCategory(id: string, patch: { name?: string; icon?: string | null; color?: string | null }): Promise<Category> {
    await this.init();
    const rows = await this.listCategories({ includeArchived: true });
    const existing = rows.find((c) => c.id === id);
    if (!existing) throw new MoneyError('Category not found.');
    const name = patch.name !== undefined ? patch.name.trim() : undefined;
    if (name !== undefined && !name) throw new MoneyError('Category name is required.');
    await this.db.transaction(async () => {
      await this.db.run(
        `UPDATE categories SET
           name = COALESCE(?, name),
           icon = CASE WHEN ? THEN ? ELSE icon END,
           color = CASE WHEN ? THEN ? ELSE color END,
           updated_at = ?
         WHERE id = ?`,
        [
          name ?? null,
          patch.icon !== undefined ? 1 : 0, patch.icon ?? null,
          patch.color !== undefined ? 1 : 0, patch.color ?? null,
          this.now(), id,
        ],
      );
      await this.bumpRevision();
    });
    const updated = (await this.listCategories({ includeArchived: true })).find((c) => c.id === id);
    if (!updated) throw new MoneyError('Category not found.');
    return updated;
  }

  async setCategoryArchived(id: string, archived: boolean): Promise<void> {
    await this.init();
    const res = await this.db.run('UPDATE categories SET archived = ?, updated_at = ? WHERE id = ?', [archived ? 1 : 0, this.now(), id]);
    if (res.changes === 0) throw new MoneyError('Category not found.');
  }

  async deleteCategory(id: string): Promise<void> {
    await this.init();
    const existing = (await this.listCategories({ includeArchived: true })).find((c) => c.id === id);
    if (!existing) throw new MoneyError('Category not found.');
    if (existing.system) throw new MoneyError('Built-in categories cannot be deleted. Archive them instead.');
    await this.db.transaction(async () => {
      const used = await this.db.getFirst<{ n: number }>('SELECT COUNT(*) AS n FROM transactions WHERE category_id = ?', [id]);
      if ((used?.n ?? 0) > 0) throw new MoneyError('This category is used by transactions. Archive it instead of deleting.');
      await this.db.run('DELETE FROM categories WHERE id = ?', [id]);
      await this.bumpRevision();
    });
  }

  /* ---------------------------------------------------------------- */
  /* M3 — Transaction corrections (edit / duplicate / restore)        */
  /* ---------------------------------------------------------------- */

  private async walletPostingsOf(transactionId: string): Promise<{ walletId: string; amountMinor: number }[]> {
    const postings = await this.getTransactionPostings(transactionId);
    return postings
      .filter((p) => p.accountKind === 'wallet' && p.walletId)
      .map((p) => ({ walletId: p.walletId as string, amountMinor: p.amountMinor }));
  }

  /** Rebuild the engine operation for a simple (non-loan) transaction. */
  private async opFromTransaction(
    txn: Transaction,
    overrides: { amountMinor?: number; signedAmountMinor?: number; walletId?: string; fromWalletId?: string; toWalletId?: string },
  ): Promise<Operation> {
    const wallets = await this.walletPostingsOf(txn.id);
    const singleWallet = overrides.walletId ?? wallets[0]?.walletId;
    switch (txn.classification) {
      case 'income':
      case 'expense':
      case 'fee':
      case 'refund_received':
      case 'refund_issued': {
        if (!singleWallet) throw new MoneyError('Transaction has no wallet posting.');
        return { kind: txn.classification, walletAccountId: this.walletAccountId(singleWallet), amountMinor: overrides.amountMinor ?? txn.amountMinor };
      }
      case 'opening_balance':
      case 'balance_adjustment': {
        if (!singleWallet) throw new MoneyError('Transaction has no wallet posting.');
        const signed = overrides.signedAmountMinor ?? wallets[0].amountMinor;
        return { kind: txn.classification, walletAccountId: this.walletAccountId(singleWallet), signedAmountMinor: signed };
      }
      case 'transfer': {
        const from = overrides.fromWalletId ?? wallets.find((w) => w.amountMinor < 0)?.walletId;
        const to = overrides.toWalletId ?? wallets.find((w) => w.amountMinor > 0)?.walletId;
        if (!from || !to) throw new MoneyError('Transfer wallets could not be determined.');
        return {
          kind: 'transfer',
          fromWalletAccountId: this.walletAccountId(from),
          toWalletAccountId: this.walletAccountId(to),
          amountMinor: overrides.amountMinor ?? txn.amountMinor,
        };
      }
      default:
        throw new MoneyError(`Transactions of type ${txn.classification} are edited through their own flow (loans/repayments).`);
    }
  }

  private assertEditableSimple(txn: Transaction | null): asserts txn is Transaction {
    if (!txn) throw new MoneyError('Transaction not found.');
    if (txn.status === 'reversed') throw new MoneyError('This transaction has already been reversed.');
    if (txn.reversesTransactionId) throw new MoneyError('Reversal entries cannot be edited.');
    if (txn.loanId) throw new MoneyError('Loan-linked transactions are edited through the loan screen.');
  }

  /** Metadata-only edit (note, counterparty, reference, category). Never touches postings. */
  async updateTransactionMetadata(
    id: string,
    patch: { note?: string | null; counterparty?: string | null; reference?: string | null; categoryId?: string | null },
  ): Promise<Transaction> {
    await this.init();
    const txn = await this.getTransaction(id);
    this.assertEditableSimple(txn);
    await this.db.transaction(async () => {
      await this.db.run(
        `UPDATE transactions SET
           note_enc = CASE WHEN ? THEN ? ELSE note_enc END,
           counterparty_enc = CASE WHEN ? THEN ? ELSE counterparty_enc END,
           reference = CASE WHEN ? THEN ? ELSE reference END,
           category_id = CASE WHEN ? THEN ? ELSE category_id END,
           updated_at = ?
         WHERE id = ?`,
        [
          patch.note !== undefined ? 1 : 0, patch.note !== undefined ? await this.protector.encrypt(patch.note) : null,
          patch.counterparty !== undefined ? 1 : 0, patch.counterparty !== undefined ? await this.protector.encrypt(patch.counterparty) : null,
          patch.reference !== undefined ? 1 : 0, patch.reference ?? null,
          patch.categoryId !== undefined ? 1 : 0, patch.categoryId ?? null,
          this.now(), id,
        ],
      );
      await this.bumpRevision();
    });
    const updated = await this.getTransaction(id);
    if (!updated) throw new MoneyError('Transaction not found.');
    return updated;
  }

  /**
   * Edit a simple transaction's amount/date/wallet by reversing the
   * original and posting a corrected entry — atomically.
   */
  async editSimpleTransaction(
    id: string,
    changes: {
      amountMinor?: number;
      signedAmountMinor?: number;
      occurredAt?: number;
      walletId?: string;
      fromWalletId?: string;
      toWalletId?: string;
      categoryId?: string | null;
      note?: string | null;
      counterparty?: string | null;
      reference?: string | null;
    },
  ): Promise<RecordResult> {
    await this.init();
    const txn = await this.getTransaction(id);
    this.assertEditableSimple(txn);
    return this.db.transaction(async () => {
      const op = await this.opFromTransaction(txn, changes);
      await this.reverseInner(id, { note: 'Edited' });
      return this.insertPlannedInner(op, {
        categoryId: changes.categoryId !== undefined ? changes.categoryId : txn.categoryId,
        personId: txn.personId,
        note: changes.note !== undefined ? changes.note : txn.note,
        counterparty: changes.counterparty !== undefined ? changes.counterparty : txn.counterparty,
        reference: changes.reference !== undefined ? changes.reference : txn.reference,
        occurredAt: changes.occurredAt ?? txn.occurredAt,
        origin: txn.origin,
      });
    });
  }

  /** Duplicate a simple transaction (new entry, today's date). */
  async duplicateTransaction(id: string): Promise<RecordResult> {
    await this.init();
    const txn = await this.getTransaction(id);
    this.assertEditableSimple(txn);
    const op = await this.opFromTransaction(txn, {});
    return this.insertPlanned(op, {
      categoryId: txn.categoryId,
      personId: txn.personId,
      note: txn.note,
      counterparty: txn.counterparty,
      reference: txn.reference,
      origin: txn.origin,
    });
  }

  /** Restore a reversed simple transaction as a new posted entry. */
  async restoreTransaction(id: string): Promise<RecordResult> {
    await this.init();
    const txn = await this.getTransaction(id);
    if (!txn) throw new MoneyError('Transaction not found.');
    if (txn.status !== 'reversed') throw new MoneyError('Only a reversed transaction can be restored.');
    if (txn.reversesTransactionId) throw new MoneyError('Reversal entries cannot be restored.');
    if (txn.loanId) throw new MoneyError('Loan-linked transactions are restored through the loan.');
    const op = await this.opFromTransaction(txn, {});
    return this.insertPlanned(op, {
      categoryId: txn.categoryId,
      personId: txn.personId,
      note: txn.note,
      counterparty: txn.counterparty,
      reference: txn.reference,
      occurredAt: txn.occurredAt,
      origin: txn.origin,
    });
  }

  /* ---------------------------------------------------------------- */
  /* M3 — Bulk operations (each executes as ONE atomic transaction)  */
  /* ---------------------------------------------------------------- */

  /** Financial-effect summary for bulk confirmation dialogs. */
  async summarizeTransactions(ids: string[]): Promise<{ count: number; totalMinor: number; byClassification: Record<string, number> }> {
    await this.init();
    const unique = [...new Set(ids)];
    if (unique.length === 0) return { count: 0, totalMinor: 0, byClassification: {} };
    const rows = await this.db.getAll<{ classification: string; amount_minor: number }>(
      `SELECT classification, amount_minor FROM transactions WHERE status = 'posted' AND reverses_transaction_id IS NULL AND id IN (${unique.map(() => '?').join(',')})`,
      unique,
    );
    const byClassification: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      byClassification[r.classification] = (byClassification[r.classification] ?? 0) + r.amount_minor;
      total += r.amount_minor;
    }
    return { count: rows.length, totalMinor: total, byClassification };
  }

  async bulkReverseTransactions(ids: string[], note = 'Bulk delete'): Promise<{ reversed: number }> {
    await this.init();
    const unique = [...new Set(ids)];
    if (unique.length === 0) throw new MoneyError('Nothing selected.');
    await this.db.transaction(async () => {
      // Validate everything first: one bad item aborts the whole batch.
      for (const id of unique) {
        const txn = await this.getTransaction(id);
        if (!txn || txn.status === 'reversed' || txn.reversesTransactionId) {
          throw new MoneyError('One of the selected entries can no longer be deleted. Nothing was changed.');
        }
        if (txn.classification === 'loan_lent' || txn.classification === 'loan_borrowed') {
          throw new MoneyError('Loans must be deleted from the loan screen so repayments are handled safely. Nothing was changed.');
        }
      }
      for (const id of unique) await this.reverseInner(id, { note });
    });
    return { reversed: unique.length };
  }

  async bulkSetCategory(ids: string[], categoryId: string | null): Promise<{ updated: number }> {
    await this.init();
    const unique = [...new Set(ids)];
    if (unique.length === 0) throw new MoneyError('Nothing selected.');
    if (categoryId) {
      const cat = (await this.listCategories({ includeArchived: true })).find((c) => c.id === categoryId);
      if (!cat) throw new MoneyError('Category not found.');
    }
    await this.db.transaction(async () => {
      for (const id of unique) {
        const txn = await this.getTransaction(id);
        if (!txn || txn.status === 'reversed') throw new MoneyError('One of the selected entries is no longer editable. Nothing was changed.');
        if (!['income', 'expense', 'fee'].includes(txn.classification)) {
          throw new MoneyError('Categories only apply to income and expenses. Nothing was changed.');
        }
      }
      for (const id of unique) {
        await this.db.run('UPDATE transactions SET category_id = ?, updated_at = ? WHERE id = ?', [categoryId, this.now(), id]);
      }
      await this.bumpRevision();
    });
    return { updated: unique.length };
  }

  async bulkVoidLoans(ids: string[]): Promise<{ voided: number }> {
    await this.init();
    const unique = [...new Set(ids)];
    if (unique.length === 0) throw new MoneyError('Nothing selected.');
    await this.db.transaction(async () => {
      for (const id of unique) {
        const loan = await this.getLoan(id);
        if (!loan) throw new MoneyError('One of the selected loans no longer exists. Nothing was changed.');
      }
      for (const id of unique) await this.voidLoanInner(id);
    });
    return { voided: unique.length };
  }

  /* ---------------------------------------------------------------- */
  /* M3 — Advanced udhaar (Phase 5)                                   */
  /* ---------------------------------------------------------------- */

  /**
   * Edit a loan. Principal/wallet/date changes repost the principal
   * through a reversal + corrected entry in one transaction; the new
   * principal can never drop below what has already been repaid.
   */
  async updateLoan(
    id: string,
    patch: { principalMinor?: number; walletId?: string; occurredAt?: number; dueDate?: string | null; note?: string | null },
  ): Promise<Loan> {
    await this.init();
    return this.db.transaction(async () => {
      const loan = await this.getLoan(id);
      if (!loan) throw new MoneyError('Loan not found.');
      if (loan.status === 'void') throw new MoneyError('A deleted loan cannot be edited. Restore it first.');
      const remaining = await this.getLoanRemainingMinor(id);
      const repaidTotal = loan.principalMinor - remaining;
      const newPrincipal = patch.principalMinor ?? loan.principalMinor;
      assertMinor(newPrincipal, { field: 'principal' });
      if (newPrincipal < repaidTotal) {
        throw new MoneyError(`Principal cannot be less than the ${repaidTotal} paisa already repaid.`);
      }
      const repost =
        patch.principalMinor !== undefined || patch.walletId !== undefined || patch.occurredAt !== undefined;
      if (repost) {
        await this.reverseInner(loan.principalTransactionId, { note: 'Loan edited' }, { skipLoanStatusRefresh: true });
        const op: Operation =
          loan.direction === 'lent'
            ? { kind: 'loan_lent', walletAccountId: this.walletAccountId(patch.walletId ?? loan.walletId), loanAccountId: this.loanAccountId(id), amountMinor: newPrincipal }
            : { kind: 'loan_borrowed', walletAccountId: this.walletAccountId(patch.walletId ?? loan.walletId), loanAccountId: this.loanAccountId(id), amountMinor: newPrincipal };
        const created = await this.insertPlannedInner(op, {
          personId: loan.personId,
          loanId: id,
          counterparty: loan.personName,
          note: patch.note !== undefined ? patch.note : loan.note,
          occurredAt: patch.occurredAt ?? loan.occurredAt,
        });
        await this.db.run(
          'UPDATE loans SET principal_transaction_id = ?, principal_minor = ?, wallet_id = ?, occurred_at = ?, local_date = ?, updated_at = ? WHERE id = ?',
          [created.transaction.id, newPrincipal, patch.walletId ?? loan.walletId, patch.occurredAt ?? loan.occurredAt, localDateOf(patch.occurredAt ?? loan.occurredAt), this.now(), id],
        );
      }
      if (patch.dueDate !== undefined || patch.note !== undefined) {
        await this.db.run(
          `UPDATE loans SET
             due_date = CASE WHEN ? THEN ? ELSE due_date END,
             note_enc = CASE WHEN ? THEN ? ELSE note_enc END,
             updated_at = ?
           WHERE id = ?`,
          [patch.dueDate !== undefined ? 1 : 0, patch.dueDate ?? null, patch.note !== undefined ? 1 : 0, patch.note !== undefined ? await this.protector.encrypt(patch.note) : null, this.now(), id],
        );
      }
      await this.refreshLoanStatus(id);
      await this.bumpRevision();
      const updated = await this.getLoan(id);
      if (!updated) throw new MoneyError('Loan not found.');
      return updated;
    });
  }

  /** Set or clear a loan reminder date (YYYY-MM-DD). Scheduling is a UI/OS concern. */
  async setLoanReminder(id: string, reminderDate: string | null): Promise<void> {
    await this.init();
    const res = await this.db.run('UPDATE loans SET reminder_date = ?, updated_at = ? WHERE id = ?', [reminderDate, this.now(), id]);
    if (res.changes === 0) throw new MoneyError('Loan not found.');
  }

  async getLoanDetail(id: string): Promise<{
    loan: Loan;
    remainingMinor: number;
    totalRepaidMinor: number;
    repayments: Transaction[];
    overdue: boolean;
    daysOverdue: number;
  }> {
    await this.init();
    const loan = await this.getLoan(id);
    if (!loan) throw new MoneyError('Loan not found.');
    const remaining = await this.getLoanRemainingMinor(id);
    const all = await this.listTransactions({ loanId: id, includeReversed: true, limit: 500 });
    const repayments = all
      .filter(
        (t) =>
          (t.classification === 'repayment_received' || t.classification === 'repayment_made') &&
          !t.reversesTransactionId, // bookkeeping reversal entries are not repayments
      )
      .sort((a, b) => a.occurredAt - b.occurredAt || a.createdAt - b.createdAt);
    const today = localDateOf(this.now());
    const overdue = !!loan.dueDate && loan.dueDate < today && remaining > 0 && loan.status !== 'void';
    let daysOverdue = 0;
    if (overdue && loan.dueDate) {
      const ms = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${loan.dueDate}T00:00:00Z`);
      daysOverdue = Math.max(0, Math.round(ms / 86_400_000));
    }
    return {
      loan,
      remainingMinor: remaining,
      totalRepaidMinor: loan.principalMinor - remaining,
      repayments,
      overdue,
      daysOverdue,
    };
  }

  /**
   * Edit a repayment: reverse the original and post the corrected amount
   * in one transaction. The corrected amount is validated against the
   * remaining balance AFTER the reversal, so it can grow up to the full
   * remaining balance but never beyond it.
   */
  async editRepayment(
    repaymentTxnId: string,
    changes: { amountMinor?: number; occurredAt?: number; walletId?: string; note?: string | null },
  ): Promise<RecordResult> {
    await this.init();
    const original = await this.getTransaction(repaymentTxnId);
    if (!original || (original.classification !== 'repayment_received' && original.classification !== 'repayment_made')) {
      throw new MoneyError('Repayment not found.');
    }
    if (original.status === 'reversed') throw new MoneyError('This repayment has already been reversed.');
    if (!original.loanId) throw new MoneyError('Repayment is not linked to a loan.');
    return this.db.transaction(async () => {
      const loan = await this.getLoan(original.loanId as string);
      if (!loan) throw new MoneyError('Loan not found.');
      const originalWallets = await this.walletPostingsOf(original.id);
      await this.reverseInner(original.id, { note: 'Repayment edited' });
      const remaining = await this.getLoanRemainingMinor(loan.id);
      const amount = changes.amountMinor ?? original.amountMinor;
      assertMinor(amount, { field: 'repayment amount' });
      if (amount > remaining) {
        throw new MoneyError(`Repayment of ${amount} paisa exceeds the remaining balance of ${remaining} paisa.`);
      }
      const walletId = changes.walletId ?? originalWallets[0]?.walletId ?? loan.walletId;
      const op: Operation =
        loan.direction === 'lent'
          ? { kind: 'repayment_received', walletAccountId: this.walletAccountId(walletId), loanAccountId: this.loanAccountId(loan.id), amountMinor: amount }
          : { kind: 'repayment_made', walletAccountId: this.walletAccountId(walletId), loanAccountId: this.loanAccountId(loan.id), amountMinor: amount };
      const created = await this.insertPlannedInner(op, {
        loanId: loan.id,
        personId: loan.personId,
        note: changes.note !== undefined ? changes.note : original.note,
        occurredAt: changes.occurredAt ?? original.occurredAt,
        origin: original.origin,
      });
      await this.refreshLoanStatus(loan.id);
      const newRemaining = await this.getLoanRemainingMinor(loan.id);
      if (newRemaining === 0) {
        await this.db.run('UPDATE loans SET settlement_transaction_id = ? WHERE id = ?', [created.transaction.id, loan.id]);
      }
      return created;
    });
  }

  /**
   * Restore a voided loan: repost its principal and exactly the
   * repayments that were reversed by the void (marker note
   * 'Loan voided'), in original order. Repayments the user reversed
   * independently before the void stay reversed.
   */
  async restoreLoan(id: string): Promise<Loan> {
    await this.init();
    return this.db.transaction(async () => {
      const loan = await this.getLoan(id);
      if (!loan) throw new MoneyError('Loan not found.');
      if (loan.status !== 'void') throw new MoneyError('Only a deleted loan can be restored.');
      const principal = await this.insertPlannedInner(
        loan.direction === 'lent'
          ? { kind: 'loan_lent', walletAccountId: this.walletAccountId(loan.walletId), loanAccountId: this.loanAccountId(id), amountMinor: loan.principalMinor }
          : { kind: 'loan_borrowed', walletAccountId: this.walletAccountId(loan.walletId), loanAccountId: this.loanAccountId(id), amountMinor: loan.principalMinor },
        { personId: loan.personId, loanId: id, counterparty: loan.personName, note: loan.note, occurredAt: loan.occurredAt },
      );
      await this.db.run("UPDATE loans SET principal_transaction_id = ?, status = 'open', updated_at = ? WHERE id = ?", [
        principal.transaction.id, this.now(), id,
      ]);
      // Find repayments reversed by the void itself.
      const candidates = await this.db.getAll<{ id: string }>(
        `SELECT t.id AS id FROM transactions t
         WHERE t.loan_id = ? AND t.status = 'reversed'
           AND t.classification IN ('repayment_received','repayment_made')
         ORDER BY t.occurred_at ASC, t.created_at ASC`,
        [id],
      );
      let lastRepaymentId: string | null = null;
      for (const c of candidates) {
        const reversal = await this.db.getFirst<{ note_enc: string | null }>(
          'SELECT note_enc FROM transactions WHERE reverses_transaction_id = ? LIMIT 1',
          [c.id],
        );
        const marker = await this.protector.decrypt(reversal?.note_enc ?? null);
        if (marker !== 'Loan voided') continue;
        const original = await this.getTransaction(c.id);
        if (!original) continue;
        const wallets = await this.walletPostingsOf(c.id);
        const created = await this.insertPlannedInner(
          loan.direction === 'lent'
            ? { kind: 'repayment_received', walletAccountId: this.walletAccountId(wallets[0]?.walletId ?? loan.walletId), loanAccountId: this.loanAccountId(id), amountMinor: original.amountMinor }
            : { kind: 'repayment_made', walletAccountId: this.walletAccountId(wallets[0]?.walletId ?? loan.walletId), loanAccountId: this.loanAccountId(id), amountMinor: original.amountMinor },
          { loanId: id, personId: loan.personId, note: original.note, occurredAt: original.occurredAt, origin: original.origin },
        );
        lastRepaymentId = created.transaction.id;
      }
      await this.refreshLoanStatus(id);
      const remaining = await this.getLoanRemainingMinor(id);
      if (remaining === 0 && lastRepaymentId) {
        await this.db.run('UPDATE loans SET settlement_transaction_id = ? WHERE id = ?', [lastRepaymentId, id]);
      }
      await this.bumpRevision();
      const restored = await this.getLoan(id);
      if (!restored) throw new MoneyError('Loan not found.');
      return restored;
    });
  }

  /** Structured data behind the person statement export. */
  async getPersonStatementData(personId: string): Promise<{
    person: Person;
    loans: { loan: Loan; remainingMinor: number; repaidMinor: number }[];
    totalLentMinor: number;
    totalBorrowedMinor: number;
    totalRepaidMinor: number;
    remainingReceivableMinor: number;
    remainingPayableMinor: number;
  }> {
    await this.init();
    const people = await this.listPeople({ includeArchived: true });
    const person = people.find((p) => p.id === personId);
    if (!person) throw new MoneyError('Person not found.');
    const loans = (await this.listLoans({ personId })).filter((l) => l.status !== 'void');
    const detailed: { loan: Loan; remainingMinor: number; repaidMinor: number }[] = [];
    let totalLent = 0;
    let totalBorrowed = 0;
    let totalRepaid = 0;
    let remainingRecv = 0;
    let remainingPay = 0;
    for (const loan of loans) {
      const remaining = await this.getLoanRemainingMinor(loan.id);
      const repaid = loan.principalMinor - remaining;
      detailed.push({ loan, remainingMinor: remaining, repaidMinor: repaid });
      if (loan.direction === 'lent') {
        totalLent += loan.principalMinor;
        remainingRecv += remaining;
      } else {
        totalBorrowed += loan.principalMinor;
        remainingPay += remaining;
      }
      totalRepaid += repaid;
    }
    return {
      person,
      loans: detailed,
      totalLentMinor: totalLent,
      totalBorrowedMinor: totalBorrowed,
      totalRepaidMinor: totalRepaid,
      remainingReceivableMinor: remainingRecv,
      remainingPayableMinor: remainingPay,
    };
  }

  /* ---------------------------------------------------------------- */
  /* M4 — Import inbox & deduplication engine (Phase 3)               */
  /* ---------------------------------------------------------------- */

  /**
   * Confirm-time auto-import eligibility: a clean, completed parse with
   * a bank reference, no duplicate/transfer candidates, and high
   * confidence. The service layer additionally requires the user's
   * explicit auto-confirm opt-in before using this.
   */
  static autoConfirmEligible(obs: ImportObservation): boolean {
    return (
      obs.status === 'new' &&
      obs.parseStatus === 'completed' &&
      obs.reference != null &&
      obs.confidencePct >= 80 &&
      obs.candidateTransactionId == null &&
      obs.candidateObservationId == null
    );
  }

  private normalizeMatchText(s: string): string {
    return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  private async hydrateObservation(row: ObsRow): Promise<ImportObservation> {
    return {
      id: row.id,
      source: row.source,
      fingerprint: row.fingerprint,
      institution: row.institution,
      externalScope: row.external_scope,
      externalIdentity: row.external_identity,
      status: row.status,
      transactionId: row.transaction_id,
      amountMinor: row.amount_minor,
      direction: row.direction,
      counterparty: await this.protector.decrypt(row.counterparty_enc),
      reference: row.reference,
      occurredAt: row.observed_at,
      localDate: row.local_date,
      suggestedClassification: row.suggested_classification as ImportObservation['suggestedClassification'],
      suggestedWalletId: row.suggested_wallet_id,
      suggestedCategoryId: row.suggested_category_id,
      confidencePct: row.confidence_pct,
      parseStatus: row.parse_status,
      reason: row.reason,
      candidateTransactionId: row.candidate_transaction_id,
      candidateObservationId: row.candidate_observation_id,
      excerpt: await this.protector.decrypt(row.excerpt_enc),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async getObservation(id: string): Promise<ImportObservation | null> {
    await this.init();
    const row = await this.db.getFirst<ObsRow>('SELECT * FROM import_observations WHERE id = ?', [id]);
    return row ? this.hydrateObservation(row) : null;
  }

  async listObservations(filter: { status?: ImportObservation['status']; limit?: number; offset?: number } = {}): Promise<ImportObservation[]> {
    await this.init();
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
    const offset = Math.max(filter.offset ?? 0, 0);
    const rows = await this.db.getAll<ObsRow>(
      `SELECT * FROM import_observations ${filter.status ? 'WHERE status = ?' : ''}
       ORDER BY observed_at DESC, created_at DESC LIMIT ? OFFSET ?`,
      filter.status ? [filter.status, limit, offset] : [limit, offset],
    );
    const out: ImportObservation[] = [];
    for (const r of rows) out.push(await this.hydrateObservation(r));
    return out;
  }

  async countObservationsByStatus(): Promise<Record<ImportObservation['status'], number>> {
    await this.init();
    const rows = await this.db.getAll<{ status: ImportObservation['status']; n: number }>(
      'SELECT status, COUNT(*) AS n FROM import_observations GROUP BY status',
    );
    const counts: Record<ImportObservation['status'], number> = { new: 0, needs_review: 0, imported: 0, ignored: 0, duplicate: 0 };
    for (const r of rows) counts[r.status] = r.n;
    return counts;
  }

  /**
   * Ingest one parsed source event into the inbox. Layered dedup:
   *  1. Source fingerprint — the same event delivered twice collapses.
   *  2. Scoped bank reference — already-imported references are duplicates.
   *  3. Pending/failed parses — review, never posted.
   *  4. Candidate matching — same amount near in time with a similar
   *     counterparty goes to review; amount alone NEVER merges.
   *  5. Transfer pairing — opposite-direction events at different
   *     institutions are flagged as a possible own-account transfer.
   * Everything else lands as 'new' with suggestions + a confidence score.
   */
  async ingestParsedEvent(input: ParsedEventInput): Promise<{ observation: ImportObservation; created: boolean }> {
    await this.init();
    assertMinor(input.amountMinor, { field: 'observed amount' });
    const scope = `${input.institutionId}:${input.accountHint ?? 'main'}`;
    const fingerprint = [
      input.source,
      input.institutionId,
      input.reference ?? '',
      input.amountMinor,
      input.direction,
      Math.floor(input.occurredAt / 60_000),
      this.normalizeMatchText(input.counterparty ?? ''),
    ].join('|');

    const existing = await this.db.getFirst<ObsRow>('SELECT * FROM import_observations WHERE fingerprint = ?', [fingerprint]);
    if (existing) return { observation: await this.hydrateObservation(existing), created: false };

    // Suggestions.
    const walletName = INSTITUTION_WALLET_NAMES[input.institutionId] ?? 'Bank Account';
    const suggestedWallet = (await this.getWalletByName(walletName)) ?? (await this.getDefaultWallet());
    let suggestedCategoryId: string | null = null;
    let suggestedClassification: Classification = input.direction === 'in' ? 'income' : 'expense';
    if (input.direction === 'out') {
      const catName = PARSER_CATEGORY_NAMES[input.categoryKey ?? 'other'] ?? 'Other';
      const cat = await this.getCategoryByName(catName, 'expense');
      suggestedCategoryId = cat?.id ?? null;
      if (catName === 'Fees') suggestedClassification = 'fee';
    } else {
      const catName = INCOME_SOURCE_CATEGORY_NAMES[input.incomeSource ?? 'Other'] ?? 'Other Income';
      const cat = await this.getCategoryByName(catName, 'income');
      suggestedCategoryId = cat?.id ?? null;
      if (input.incomeSource === 'Refund') suggestedClassification = 'refund_received';
    }

    let confidence = 40;
    if (input.reference) confidence += 30;
    if (input.counterparty) confidence += 15;
    confidence += INSTITUTION_WALLET_NAMES[input.institutionId] ? 15 : 5;
    confidence = Math.min(confidence, 100);

    return this.db.transaction(async () => {
      let status: ImportObservation['status'] = 'new';
      let reason: string | null = null;
      let candidateTransactionId: string | null = null;
      let candidateObservationId: string | null = null;

      if (input.reference) {
        const imported = await this.findByExternalIdentity(scope, input.reference);
        if (imported) {
          status = 'duplicate';
          reason = 'A transaction with this bank reference is already in the ledger.';
          candidateTransactionId = imported.id;
        }
      }

      if (status === 'new' && input.parseStatus !== 'completed') {
        status = 'needs_review';
        reason =
          input.parseStatus === 'failed'
            ? 'The bank reported this transaction as FAILED. It has not been posted.'
            : 'The bank reported this transaction as PENDING. Confirm it only once it completes.';
      }

      if (status === 'new') {
        // Layer 4: candidate duplicate against posted transactions.
        const rows = await this.db.getAll<TxnRow>(
          `SELECT * FROM transactions
           WHERE status = 'posted' AND reverses_transaction_id IS NULL
             AND amount_minor = ? AND occurred_at BETWEEN ? AND ?
           ORDER BY occurred_at DESC LIMIT 20`,
          [input.amountMinor, input.occurredAt - DEDUP_WINDOW_MS, input.occurredAt + DEDUP_WINDOW_MS],
        );
        const wanted = this.normalizeMatchText(input.counterparty ?? '');
        for (const r of rows) {
          const txn = await this.hydrateTxn(r);
          const have = this.normalizeMatchText(txn.counterparty ?? '');
          const counterpartyMatch =
            wanted.length >= 3 && have.length >= 3 && (wanted === have || wanted.includes(have) || have.includes(wanted));
          const closeInTime = Math.abs(txn.occurredAt - input.occurredAt) <= 2 * 60_000;
          if (counterpartyMatch || (!wanted && closeInTime)) {
            status = 'needs_review';
            reason = 'This looks similar to an entry already in the ledger. Check before importing.';
            candidateTransactionId = txn.id;
            break;
          }
        }
      }

      if (status === 'new') {
        // Layer 5: possible own-account transfer pair.
        const pair = await this.db.getFirst<ObsRow>(
          `SELECT * FROM import_observations
           WHERE status IN ('new','needs_review') AND direction != ? AND amount_minor = ?
             AND parse_status = 'completed'
             AND COALESCE(substr(external_scope, 1, instr(external_scope, ':') - 1), '') != ?
             AND observed_at BETWEEN ? AND ?
           ORDER BY observed_at ASC LIMIT 1`,
          [input.direction, input.amountMinor, input.institutionId, input.occurredAt - TRANSFER_WINDOW_MS, input.occurredAt + TRANSFER_WINDOW_MS],
        );
        if (pair) {
          status = 'needs_review';
          reason = 'Possible transfer between your own accounts. Confirm it as one transfer, or import the two sides separately.';
          candidateObservationId = pair.id;
        }
      }

      const ts = this.now();
      const obs: ImportObservation = {
        id: this.newId(),
        source: input.source,
        fingerprint,
        institution: input.institution,
        externalScope: scope,
        externalIdentity: input.reference ?? null,
        status,
        transactionId: candidateTransactionId && status === 'duplicate' ? candidateTransactionId : null,
        amountMinor: input.amountMinor,
        direction: input.direction,
        counterparty: input.counterparty ?? null,
        reference: input.reference ?? null,
        occurredAt: input.occurredAt,
        localDate: localDateOf(input.occurredAt),
        suggestedClassification,
        suggestedWalletId: suggestedWallet?.id ?? null,
        suggestedCategoryId,
        confidencePct: confidence,
        parseStatus: input.parseStatus,
        reason,
        candidateTransactionId,
        candidateObservationId,
        excerpt: input.excerpt ? input.excerpt.slice(0, 140) : null,
        createdAt: ts,
        updatedAt: ts,
      };
      await this.db.run(
        `INSERT INTO import_observations (id, source, fingerprint, institution, external_scope,
           external_identity, status, transaction_id, amount_minor, direction, counterparty_enc,
           reference, local_date, suggested_classification, suggested_wallet_id, suggested_category_id,
           confidence_pct, parse_status, reason, candidate_transaction_id, candidate_observation_id,
           excerpt_enc, observed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          obs.id, obs.source, obs.fingerprint, obs.institution, obs.externalScope, obs.externalIdentity,
          obs.status, obs.transactionId, obs.amountMinor, obs.direction,
          await this.protector.encrypt(obs.counterparty), obs.reference, obs.localDate,
          obs.suggestedClassification, obs.suggestedWalletId, obs.suggestedCategoryId, obs.confidencePct,
          obs.parseStatus, obs.reason, obs.candidateTransactionId, obs.candidateObservationId,
          await this.protector.encrypt(obs.excerpt), obs.occurredAt, ts, ts,
        ],
      );
      if (candidateObservationId) {
        await this.db.run(
          "UPDATE import_observations SET status = 'needs_review', candidate_observation_id = ?, reason = ?, updated_at = ? WHERE id = ?",
          [obs.id, 'Possible transfer between your own accounts. Confirm it as one transfer, or import the two sides separately.', ts, candidateObservationId],
        );
      }
      return { observation: obs, created: true };
    });
  }

  private async requireReviewable(id: string): Promise<ImportObservation> {
    const obs = await this.getObservation(id);
    if (!obs) throw new MoneyError('Import item not found.');
    if (obs.status === 'imported') throw new MoneyError('This item is already imported.');
    if (obs.status === 'ignored') throw new MoneyError('This item was ignored. Restore it by re-checking the source.');
    if (obs.status === 'duplicate') throw new MoneyError('This item is marked as a duplicate.');
    return obs;
  }

  /** Confirm an inbox item into the ledger (single atomic transaction). */
  async confirmObservation(
    id: string,
    overrides: {
      walletId?: string;
      categoryId?: string | null;
      classification?: Classification;
      amountMinor?: number;
      occurredAt?: number;
      counterparty?: string | null;
      note?: string | null;
    } = {},
  ): Promise<{ observation: ImportObservation; transaction: Transaction }> {
    await this.init();
    const obs = await this.requireReviewable(id);
    if (obs.parseStatus !== 'completed') {
      throw new MoneyError(
        obs.parseStatus === 'failed'
          ? 'This transaction FAILED at the bank — it cannot be imported as a completed transaction.'
          : 'This transaction is still PENDING at the bank — wait until it completes before importing.',
      );
    }
    const classification = overrides.classification ?? obs.suggestedClassification ?? (obs.direction === 'in' ? 'income' : 'expense');
    if (classification === 'transfer') throw new MoneyError('Use “Confirm as transfer” for transfers.');
    const walletId = overrides.walletId ?? obs.suggestedWalletId ?? (await this.getDefaultWallet())?.id;
    if (!walletId) throw new MoneyError('No wallet available for this import.');
    const amount = overrides.amountMinor ?? obs.amountMinor;
    if (amount == null) throw new MoneyError('This item has no amount.');
    assertMinor(amount, { field: 'import amount' });
    const walletAccountId = this.walletAccountId(walletId);
    let op: Operation;
    switch (classification) {
      case 'income':
        op = { kind: 'income', walletAccountId, amountMinor: amount };
        break;
      case 'expense':
        op = { kind: 'expense', walletAccountId, amountMinor: amount };
        break;
      case 'fee':
        op = { kind: 'fee', walletAccountId, amountMinor: amount };
        break;
      case 'refund_received':
        op = { kind: 'refund_received', walletAccountId, amountMinor: amount };
        break;
      case 'refund_issued':
        op = { kind: 'refund_issued', walletAccountId, amountMinor: amount };
        break;
      default:
        throw new MoneyError(`Classification ${classification} cannot be used for an import. Loans and repayments are recorded from the Udhaar screens.`);
    }
    const result = await this.db.transaction(async () => {
      const posted = await this.insertPlannedInner(op, {
        categoryId: overrides.categoryId !== undefined ? overrides.categoryId : obs.suggestedCategoryId,
        counterparty: overrides.counterparty !== undefined ? overrides.counterparty : obs.counterparty,
        note: overrides.note !== undefined ? overrides.note : `⚡ ${obs.institution ?? 'Import'}`,
        reference: obs.reference,
        occurredAt: overrides.occurredAt ?? obs.occurredAt,
        origin: 'auto',
        externalIdentity: obs.reference && obs.externalScope ? { scope: obs.externalScope, identity: obs.reference } : undefined,
      });
      await this.db.run("UPDATE import_observations SET status = 'imported', transaction_id = ?, updated_at = ? WHERE id = ?", [
        posted.transaction.id, this.now(), id,
      ]);
      return posted;
    });
    const updated = await this.getObservation(id);
    return { observation: updated as ImportObservation, transaction: result.transaction };
  }

  /** Confirm an inbox item (and its pair, when present) as ONE wallet transfer. */
  async confirmObservationAsTransfer(
    id: string,
    overrides: { fromWalletId?: string; toWalletId?: string } = {},
  ): Promise<{ observation: ImportObservation; transaction: Transaction }> {
    await this.init();
    const obs = await this.requireReviewable(id);
    if (obs.parseStatus !== 'completed') throw new MoneyError('Only completed transactions can be confirmed as transfers.');
    const pair = obs.candidateObservationId ? await this.getObservation(obs.candidateObservationId) : null;
    const pairUsable = pair && (pair.status === 'new' || pair.status === 'needs_review') ? pair : null;
    const fromWalletId =
      overrides.fromWalletId ?? (obs.direction === 'out' ? obs.suggestedWalletId : pairUsable?.suggestedWalletId) ?? null;
    const toWalletId =
      overrides.toWalletId ?? (obs.direction === 'in' ? obs.suggestedWalletId : pairUsable?.suggestedWalletId) ?? null;
    if (!fromWalletId || !toWalletId) throw new MoneyError('Both transfer wallets are needed.');
    if (fromWalletId === toWalletId) throw new MoneyError('A transfer needs two different wallets.');
    const amount = obs.amountMinor;
    if (amount == null) throw new MoneyError('This item has no amount.');
    const result = await this.db.transaction(async () => {
      const posted = await this.insertPlannedInner(
        {
          kind: 'transfer',
          fromWalletAccountId: this.walletAccountId(fromWalletId),
          toWalletAccountId: this.walletAccountId(toWalletId),
          amountMinor: amount,
        },
        {
          counterparty: obs.counterparty,
          note: `⚡ ${obs.institution ?? 'Import'} transfer`,
          reference: obs.reference,
          occurredAt: obs.occurredAt,
          origin: 'auto',
          externalIdentity: obs.reference && obs.externalScope ? { scope: obs.externalScope, identity: obs.reference } : undefined,
        },
      );
      await this.db.run("UPDATE import_observations SET status = 'imported', transaction_id = ?, updated_at = ? WHERE id = ?", [
        posted.transaction.id, this.now(), id,
      ]);
      if (pairUsable) {
        await this.db.run(
          "UPDATE import_observations SET status = 'duplicate', transaction_id = ?, reason = ?, updated_at = ? WHERE id = ?",
          [posted.transaction.id, 'Paired with the matching entry as one wallet transfer.', this.now(), pairUsable.id],
        );
      }
      return posted;
    });
    const updated = await this.getObservation(id);
    return { observation: updated as ImportObservation, transaction: result.transaction };
  }

  async ignoreObservation(id: string): Promise<void> {
    await this.init();
    await this.requireReviewable(id);
    await this.db.run("UPDATE import_observations SET status = 'ignored', updated_at = ? WHERE id = ?", [this.now(), id]);
  }

  async markObservationDuplicate(id: string): Promise<void> {
    await this.init();
    await this.requireReviewable(id);
    await this.db.run("UPDATE import_observations SET status = 'duplicate', reason = ?, updated_at = ? WHERE id = ?", [
      'Marked as a duplicate by you.', this.now(), id,
    ]);
  }

  /** Bulk confirm: each item is independent; failures are reported per item, never hidden. */
  async bulkConfirmObservations(ids: string[]): Promise<{ confirmed: string[]; failed: { id: string; error: string }[] }> {
    const confirmed: string[] = [];
    const failed: { id: string; error: string }[] = [];
    for (const id of ids) {
      try {
        await this.confirmObservation(id);
        confirmed.push(id);
      } catch (e) {
        failed.push({ id, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return { confirmed, failed };
  }

  async bulkIgnoreObservations(ids: string[]): Promise<{ ignored: number }> {
    await this.init();
    const unique = [...new Set(ids)];
    if (unique.length === 0) return { ignored: 0 };
    const res = await this.db.run(
      `UPDATE import_observations SET status = 'ignored', updated_at = ? WHERE status IN ('new','needs_review') AND id IN (${unique.map(() => '?').join(',')})`,
      [this.now(), ...unique],
    );
    return { ignored: res.changes };
  }

  /* ---------------------------------------------------------------- */
  /* M6 — Backup export / restore (Phase 13)                          */
  /*                                                                  */
  /* The payload mirrors the tables exactly. Protected (*_enc)        */
  /* columns are stored DECRYPTED inside the payload — which is why   */
  /* the payload is only ever allowed to exist inside the             */
  /* passphrase-encrypted envelope from lib/finance/backup.ts.        */
  /* Restore re-encrypts those columns with THIS device's protector,  */
  /* so backups stay portable across devices. Restore is refused      */
  /* into a non-empty ledger: it is disaster recovery, never a merge. */
  /* ---------------------------------------------------------------- */

  private static BACKUP_TABLES: readonly string[] = [
    'meta', 'accounts', 'wallets', 'people', 'categories', 'transactions',
    'postings', 'loans', 'external_identities', 'legacy_refs', 'import_observations',
  ];

  private static ENC_COLUMNS: Record<string, readonly string[]> = {
    people: ['name_enc'],
    transactions: ['counterparty_enc', 'note_enc'],
    loans: ['note_enc'],
    import_observations: ['counterparty_enc', 'excerpt_enc'],
  };

  async exportBackupData(): Promise<BackupData> {
    await this.init();
    const tables: Record<string, Record<string, unknown>[]> = {};
    for (const table of LedgerRepository.BACKUP_TABLES) {
      const rows = await this.db.getAll<Record<string, unknown>>(`SELECT * FROM ${table}`);
      const encCols = LedgerRepository.ENC_COLUMNS[table] ?? [];
      for (const row of rows) {
        for (const col of encCols) {
          row[col] = await this.protector.decrypt((row[col] as string | null) ?? null);
        }
      }
      tables[table] = rows;
    }
    return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: this.now(), tables };
  }

  async importBackupData(data: BackupData): Promise<{ transactions: number; integrityOk: boolean }> {
    await this.init();
    if (data.format !== BACKUP_FORMAT || data.version !== BACKUP_VERSION) {
      throw new MoneyError('This file is not a PocketHisaab v2 backup.');
    }
    const existing = await this.db.getFirst<{ n: number }>('SELECT COUNT(*) AS n FROM transactions');
    if (existing && existing.n > 0) {
      throw new MoneyError(
        'Restore needs an empty ledger. Your current data is untouched — restore only on a fresh install or after a controlled reset.',
      );
    }
    for (const table of LedgerRepository.BACKUP_TABLES) {
      if (!Array.isArray(data.tables[table])) {
        throw new MoneyError(`Backup is missing its ${table} table — the file is damaged.`);
      }
    }
    await this.db.transaction(async () => {
      for (const table of [...LedgerRepository.BACKUP_TABLES].reverse()) {
        await this.db.run(`DELETE FROM ${table}`);
      }
      for (const table of LedgerRepository.BACKUP_TABLES) {
        const encCols = LedgerRepository.ENC_COLUMNS[table] ?? [];
        for (const row of data.tables[table]) {
          const cols = Object.keys(row);
          const values: unknown[] = [];
          for (const col of cols) {
            values.push(
              encCols.includes(col)
                ? await this.protector.encrypt((row[col] as string | null) ?? null)
                : row[col],
            );
          }
          await this.db.run(
            `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
            values as never[],
          );
        }
      }
      // Prove the restored ledger before committing to it.
      const check = await this.verifyIntegrity();
      if (!check.ok) {
        throw new MoneyError(`Backup failed its integrity check (${check.problems[0]}). Nothing was kept.`);
      }
    });
    const count = await this.db.getFirst<{ n: number }>('SELECT COUNT(*) AS n FROM transactions');
    return { transactions: count?.n ?? 0, integrityOk: true };
  }

  /* ---------------------------------------------------------------- */
  /* Legacy numeric ID mapping (compatibility facade support)         */
  /* ---------------------------------------------------------------- */

  /** Stable numeric alias for a v2 UUID, assigned once and persisted. */
  async legacyId(entity: string, refId: string): Promise<number> {
    await this.init();
    const existing = await this.db.getFirst<{ legacy_id: number }>(
      'SELECT legacy_id FROM legacy_refs WHERE entity = ? AND ref_id = ?',
      [entity, refId],
    );
    if (existing) return existing.legacy_id;
    return this.db.transaction(async () => {
      const again = await this.db.getFirst<{ legacy_id: number }>(
        'SELECT legacy_id FROM legacy_refs WHERE entity = ? AND ref_id = ?',
        [entity, refId],
      );
      if (again) return again.legacy_id;
      const max = await this.db.getFirst<{ m: number | null }>(
        'SELECT MAX(legacy_id) AS m FROM legacy_refs WHERE entity = ?',
        [entity],
      );
      const next = (max?.m ?? 0) + 1;
      await this.db.run('INSERT INTO legacy_refs (entity, ref_id, legacy_id) VALUES (?, ?, ?)', [entity, refId, next]);
      return next;
    });
  }

  async refForLegacyId(entity: string, legacyId: number): Promise<string | null> {
    await this.init();
    const row = await this.db.getFirst<{ ref_id: string }>(
      'SELECT ref_id FROM legacy_refs WHERE entity = ? AND legacy_id = ?',
      [entity, legacyId],
    );
    return row?.ref_id ?? null;
  }

  /** Point an existing legacy alias at a replacement record (edits). */
  async remapLegacyId(entity: string, legacyId: number, newRefId: string): Promise<void> {
    await this.init();
    await this.db.run('UPDATE legacy_refs SET ref_id = ? WHERE entity = ? AND legacy_id = ?', [newRefId, entity, legacyId]);
  }

  /* ---------------------------------------------------------------- */
  /* Controlled reset — NEVER called automatically.                   */
  /* Requires the exact confirmation token. Clears ONLY the v2        */
  /* database (this repository's own file). The v1 database file is   */
  /* a different file and is not touched.                             */
  /* ---------------------------------------------------------------- */

  async performControlledReset(confirmation: string): Promise<void> {
    if (confirmation !== CONTROLLED_RESET_CONFIRMATION) {
      throw new MoneyError('Controlled reset refused: confirmation token does not match.');
    }
    await this.init();
    await this.db.transaction(async () => {
      await this.db.run('DELETE FROM postings');
      await this.db.run('DELETE FROM external_identities');
      await this.db.run('DELETE FROM import_observations');
      await this.db.run('DELETE FROM transactions');
      await this.db.run('DELETE FROM loans');
      await this.db.run('DELETE FROM accounts WHERE kind != ?', ['external']);
      await this.db.run('DELETE FROM people');
      await this.db.run('DELETE FROM legacy_refs');
      await this.db.run('DELETE FROM wallets');
      await this.db.run('DELETE FROM categories');
      await this.db.run("UPDATE meta SET value = '0' WHERE key = ?", [META_LEDGER_REVISION]);
    });
    this.initialized = false;
    await this.init();
  }
}

type AccountKindOf = 'wallet' | 'receivable' | 'payable' | 'external';
