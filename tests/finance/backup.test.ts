import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import { decryptBackup, encryptBackup, makePinRecord, verifyPin } from '../../lib/finance/backup';
import { at, makeRepo, rs } from './helpers';

const rng = (n: number) => new Uint8Array(randomBytes(n));
const PASS = 'correct horse battery staple';

async function populatedRepo() {
  const ctx = makeRepo();
  const repo = ctx.repo;
  const cash = await repo.getWalletByName('Cash');
  const jazz = await repo.getWalletByName('JazzCash');
  await repo.setOpeningBalance({ walletId: cash!.id, signedAmountMinor: rs(15000), occurredAt: at('2026-10-01') });
  const food = await repo.getCategoryByName('Food', 'expense');
  await repo.addIncome({ walletId: jazz!.id, amountMinor: rs(5000), categoryId: null, occurredAt: at('2026-10-03') });
  await repo.addExpense({ walletId: cash!.id, amountMinor: rs(1200), categoryId: food?.id ?? null, counterparty: 'Secret Bakery', occurredAt: at('2026-10-05') });
  const loan = await repo.lend({
    personName: 'Ahmed Raza', walletId: cash!.id, amountMinor: rs(3000),
    occurredAt: at('2026-10-06'), dueDate: '2026-10-20',
  });
  await repo.recordRepayment({ loanId: loan.id, amountMinor: rs(1000), occurredAt: at('2026-10-08') });
  const obs = await repo.ingestParsedEvent({
    source: 'sms', institution: 'JazzCash', institutionId: 'jazzcash', amountMinor: rs(250),
    direction: 'out', counterparty: 'CAFE', reference: 'BK1', occurredAt: at('2026-10-09'),
    parseStatus: 'completed', categoryKey: 'food',
  });
  await repo.confirmObservation(obs.observation.id);
  return ctx;
}

describe('encrypted backup round-trip', () => {
  it('export → encrypt → decrypt → restore reproduces the ledger exactly', async () => {
    const source = await populatedRepo();
    const before = await source.repo.getDashboard('2026-10');
    const summariesBefore = await source.repo.getPersonSummaries();

    const data = await source.repo.exportBackupData();
    const envelope = encryptBackup(data, PASS, rng);
    assert.match(envelope, /PHBK1/);
    assert.ok(!envelope.includes('Secret Bakery'), 'backup envelope must not leak plaintext counterparty');
    assert.ok(!envelope.includes('Ahmed Raza'), 'backup envelope must not leak plaintext names');

    const decoded = decryptBackup(envelope, PASS);
    const target = makeRepo();
    const result = await target.repo.importBackupData(decoded);
    assert.equal(result.integrityOk, true);
    assert.ok(result.transactions >= 6);

    const after = await target.repo.getDashboard('2026-10');
    assert.equal(after.netWorthMinor, before.netWorthMinor);
    assert.equal(after.availableCashMinor, before.availableCashMinor);
    assert.equal(after.monthIncomeMinor, before.monthIncomeMinor);
    assert.equal(after.monthExpensesMinor, before.monthExpensesMinor);
    assert.equal(after.receivablesMinor, before.receivablesMinor);

    const summariesAfter = await target.repo.getPersonSummaries();
    assert.equal(summariesAfter.length, summariesBefore.length);
    assert.equal(summariesAfter[0].person.name, 'Ahmed Raza');
    assert.equal(summariesAfter[0].lentMinor, summariesBefore[0].lentMinor);

    // Restored external identity still blocks a duplicate import.
    const dupe = await target.repo.ingestParsedEvent({
      source: 'statement', institution: 'JazzCash', institutionId: 'jazzcash', amountMinor: rs(250),
      direction: 'out', counterparty: 'CAFE', reference: 'BK1', occurredAt: at('2026-10-10'),
      parseStatus: 'completed', categoryKey: 'food',
    });
    assert.equal(dupe.observation.status, 'duplicate');
  });

  it('a wrong passphrase cannot open the backup', async () => {
    const source = await populatedRepo();
    const envelope = encryptBackup(await source.repo.exportBackupData(), PASS, rng);
    assert.throws(() => decryptBackup(envelope, 'wrong passphrase entirely'), /Wrong passphrase|not a PocketHisaab/);
  });

  it('a tampered backup is rejected', async () => {
    const source = await populatedRepo();
    const envelope = JSON.parse(encryptBackup(await source.repo.exportBackupData(), PASS, rng)) as { data: string };
    envelope.data = (envelope.data[0] === 'A' ? 'B' : 'A') + envelope.data.slice(1);
    assert.throws(() => decryptBackup(JSON.stringify(envelope), PASS), /Wrong passphrase|damaged/);
  });

  it('restore into a non-empty ledger is refused and changes nothing', async () => {
    const source = await populatedRepo();
    const data = await source.repo.exportBackupData();
    const target = await populatedRepo();
    const dashBefore = await target.repo.getDashboard('2026-10');
    await assert.rejects(() => target.repo.importBackupData(data), /empty ledger/);
    const dashAfter = await target.repo.getDashboard('2026-10');
    assert.equal(dashAfter.netWorthMinor, dashBefore.netWorthMinor);
  });

  it('a non-backup file is rejected before touching the database', async () => {
    const target = makeRepo();
    await assert.rejects(
      () => target.repo.importBackupData({ format: 'something-else', version: 1, exportedAt: 0, tables: {} }),
      /not a PocketHisaab v2 backup/,
    );
  });

  it('short passphrases are refused at encryption time', async () => {
    const source = await populatedRepo();
    const data = await source.repo.exportBackupData();
    assert.throws(() => encryptBackup(data, 'short', rng), /at least 8/);
  });
});

describe('PIN records', () => {
  it('verifies the right PIN and rejects wrong ones', () => {
    const rec = makePinRecord('2468', rng);
    assert.equal(verifyPin('2468', rec.saltHex, rec.hashHex), true);
    assert.equal(verifyPin('1234', rec.saltHex, rec.hashHex), false);
    assert.equal(verifyPin('24680', rec.saltHex, rec.hashHex), false);
  });

  it('two records for the same PIN have different salts and hashes', () => {
    const a = makePinRecord('1111', rng);
    const b = makePinRecord('1111', rng);
    assert.notEqual(a.saltHex, b.saltHex);
    assert.notEqual(a.hashHex, b.hashHex);
  });
});
