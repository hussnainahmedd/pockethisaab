/**
 * expo-sqlite driver + app singleton for the v2 ledger.
 *
 * The v2 ledger lives in its OWN database file (pockethisaab-v2.db).
 * The v1 database file is not opened by this module, so installing a
 * v2 build never alters or erases existing device data. Discarding the
 * old v1 file is a separate, owner-approved procedure (see the M2
 * implementation report).
 */
import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';
import { decText, encText } from '../crypto';
import { V2_DATABASE_NAME } from './schema';
import { LedgerRepository, personNameKeyInput } from './repository';
import type { SqlDriver, TextProtector } from './types';

function expoDriver(db: SQLite.SQLiteDatabase): SqlDriver {
  return {
    async exec(sql) {
      await db.execAsync(sql);
    },
    async run(sql, params = []) {
      const result = await db.runAsync(sql, [...params] as SQLite.SQLiteBindParams);
      return { changes: result.changes, lastInsertRowId: result.lastInsertRowId };
    },
    async getAll<T>(sql: string, params: readonly unknown[] = []) {
      return db.getAllAsync<T>(sql, [...params] as SQLite.SQLiteBindParams);
    },
    async getFirst<T>(sql: string, params: readonly unknown[] = []) {
      return db.getFirstAsync<T>(sql, [...params] as SQLite.SQLiteBindParams);
    },
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      let value!: T;
      await db.withTransactionAsync(async () => {
        value = await fn();
      });
      return value;
    },
  };
}

const appTextProtector: TextProtector = {
  async encrypt(plain) {
    return encText(plain);
  },
  async decrypt(cipher) {
    return decText(cipher);
  },
  async personKey(normalizedName) {
    // Deterministic lookup key so find-or-create works on encrypted names.
    const digest = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `pockethisaab-person:${personNameKeyInput(normalizedName)}`,
    );
    return digest;
  },
};

let cached: LedgerRepository | null = null;
let database: SQLite.SQLiteDatabase | null = null;

/** The app-wide v2 ledger repository (opens the v2 database file). */
export function getLedger(): LedgerRepository {
  if (!cached) {
    database = SQLite.openDatabaseSync(V2_DATABASE_NAME);
    cached = new LedgerRepository(expoDriver(database), appTextProtector, () => Crypto.randomUUID());
  }
  return cached;
}

/** Initialize the v2 ledger (schema + seed wallets/categories; zero balances). */
export async function initLedger(): Promise<void> {
  await getLedger().init();
}
