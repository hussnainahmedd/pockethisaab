import { LedgerRepository } from '../../lib/finance/repository';
import type { TextProtector } from '../../lib/finance/types';
import { createNodeSqliteDriver } from './nodeSqliteDriver';

/** Identity protector: tests exercise accounting, not encryption. */
export const identityProtector: TextProtector = {
  async encrypt(plain) {
    return plain;
  },
  async decrypt(cipher) {
    return cipher;
  },
  async personKey(normalizedName) {
    return `key:${normalizedName}`;
  },
};

export function makeRepo() {
  const driver = createNodeSqliteDriver();
  let counter = 0;
  let clock = new Date('2026-10-15T12:00:00').getTime();
  const repo = new LedgerRepository(driver, identityProtector, () => `test-id-${++counter}`, () => clock);
  return {
    repo,
    driver,
    setClock(ms: number) {
      clock = ms;
    },
  };
}

/** Epoch ms at local noon for a YYYY-MM-DD date (timezone-safe in tests). */
export function at(date: string): number {
  return new Date(`${date}T12:00:00`).getTime();
}

/** Rupees -> paisa shortcut for readable tests. */
export const rs = (rupees: number) => rupees * 100;
