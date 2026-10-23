/**
 * node:sqlite driver for the finance test suite.
 *
 * Runs the EXACT repository code and schema that ship in the app
 * (the app injects an expo-sqlite driver with the same interface).
 */
import { DatabaseSync } from 'node:sqlite';
import type { SqlDriver } from '../../lib/finance/types';

export function createNodeSqliteDriver(path = ':memory:'): SqlDriver & { close(): void; raw: DatabaseSync } {
  const db = new DatabaseSync(path);
  let depth = 0;

  const clean = (params: readonly unknown[]) => params.map((p) => (p === undefined ? null : p)) as never[];

  return {
    raw: db,
    close() {
      db.close();
    },
    async exec(sql) {
      db.exec(sql);
    },
    async run(sql, params = []) {
      const result = db.prepare(sql).run(...clean(params));
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    async getAll<T>(sql: string, params: readonly unknown[] = []) {
      return db.prepare(sql).all(...clean(params)) as T[];
    },
    async getFirst<T>(sql: string, params: readonly unknown[] = []) {
      const row = db.prepare(sql).get(...clean(params)) as T | undefined;
      return row ?? null;
    },
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      if (depth > 0) return fn(); // repository never nests; join the outer transaction
      depth++;
      db.exec('BEGIN');
      try {
        const value = await fn();
        db.exec('COMMIT');
        return value;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      } finally {
        depth--;
      }
    },
  };
}
