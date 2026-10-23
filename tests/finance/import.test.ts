import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LedgerRepository, type ParsedEventInput } from '../../lib/finance/repository';
import { at, makeRepo, rs } from './helpers';

const T0 = at('2026-10-15'); // noon
const MIN = 60_000;

function event(patch: Partial<ParsedEventInput> = {}): ParsedEventInput {
  return {
    source: 'sms',
    institution: 'JazzCash',
    institutionId: 'jazzcash',
    amountMinor: rs(500),
    direction: 'out',
    counterparty: 'GRAY MACKENZIE',
    reference: '725981397486',
    occurredAt: T0,
    parseStatus: 'completed',
    categoryKey: 'food',
    ...patch,
  };
}

async function setup() {
  const ctx = makeRepo();
  const cash = await ctx.repo.getWalletByName('Cash');
  await ctx.repo.setOpeningBalance({ walletId: cash!.id, signedAmountMinor: rs(20000), occurredAt: at('2026-10-01') });
  return ctx;
}

async function balanceOf(repo: LedgerRepository, name: string): Promise<number> {
  const w = (await repo.listWallets({ includeArchived: true })).find((x) => x.name === name);
  assert.ok(w, `wallet ${name} exists`);
  return w.balanceMinor;
}

describe('import inbox ingestion', () => {
  it('files a clean event as New with wallet/category suggestions and full confidence', async () => {
    const { repo } = await setup();
    const { observation, created } = await repo.ingestParsedEvent(event());
    assert.equal(created, true);
    assert.equal(observation.status, 'new');
    assert.equal(observation.confidencePct, 100);
    const jazz = await repo.getWalletByName('JazzCash');
    const food = await repo.getCategoryByName('Food', 'expense');
    assert.equal(observation.suggestedWalletId, jazz!.id);
    assert.equal(observation.suggestedCategoryId, food!.id);
    assert.equal(observation.suggestedClassification, 'expense');
    assert.equal(LedgerRepository.autoConfirmEligible(observation), true);
  });

  it('the same source event delivered twice collapses to one observation (fingerprint)', async () => {
    const { repo } = await setup();
    const first = await repo.ingestParsedEvent(event());
    const second = await repo.ingestParsedEvent(event());
    assert.equal(second.created, false);
    assert.equal(second.observation.id, first.observation.id);
    assert.equal((await repo.countObservationsByStatus()).new, 1);
  });

  it('a low-confidence event (no reference, no counterparty) is not auto-confirm eligible', async () => {
    const { repo } = await setup();
    const { observation } = await repo.ingestParsedEvent(
      event({ institution: 'HBL', institutionId: 'hbl', reference: null, counterparty: null }),
    );
    assert.equal(observation.status, 'new');
    assert.equal(observation.confidencePct, 45);
    assert.equal(LedgerRepository.autoConfirmEligible(observation), false);
  });

  it('suggests Bank Account + scoped identity for Faysal (the v1.1.3 case)', async () => {
    const { repo } = await setup();
    const { observation } = await repo.ingestParsedEvent(
      event({
        institution: 'Faysal Bank', institutionId: 'faysal', accountHint: 'acct8588',
        amountMinor: rs(76), counterparty: 'HASSAN TUC SHOP', reference: '366002', categoryKey: 'shopping',
      }),
    );
    const bank = await repo.getWalletByName('Bank Account');
    assert.equal(observation.suggestedWalletId, bank!.id);
    assert.equal(observation.externalScope, 'faysal:acct8588');
    assert.equal(observation.confidencePct, 90);
  });
});

describe('confirming imports', () => {
  it('confirm posts exactly once with the scoped external identity; a same-scope re-import is a duplicate', async () => {
    const { repo } = await setup();
    const jazzBefore = await balanceOf(repo, 'JazzCash');
    const { observation } = await repo.ingestParsedEvent(event());
    const { transaction } = await repo.confirmObservation(observation.id);
    assert.equal(transaction.classification, 'expense');
    assert.equal(transaction.origin, 'auto');
    assert.equal(await balanceOf(repo, 'JazzCash'), jazzBefore - rs(500));
    assert.equal((await repo.getObservation(observation.id))?.status, 'imported');
    await assert.rejects(() => repo.confirmObservation(observation.id), /already imported/);

    // Same institution+account+reference via another channel = duplicate at ingest.
    const again = await repo.ingestParsedEvent(event({ source: 'statement', occurredAt: T0 + 3 * MIN }));
    assert.equal(again.observation.status, 'duplicate');
    assert.equal(again.observation.candidateTransactionId, transaction.id);
    assert.equal((await repo.getDashboard('2026-10')).monthExpensesMinor, rs(500)); // still counted once
  });

  it('the same reference at a DIFFERENT institution is a separate legitimate transaction', async () => {
    const { repo } = await setup();
    const a = await repo.ingestParsedEvent(event());
    await repo.confirmObservation(a.observation.id);
    const b = await repo.ingestParsedEvent(
      event({ institution: 'HBL', institutionId: 'hbl', counterparty: 'OTHER SHOP', occurredAt: T0 + 60 * MIN }),
    );
    assert.equal(b.observation.status, 'new');
    await repo.confirmObservation(b.observation.id);
    assert.equal((await repo.getDashboard('2026-10')).monthExpensesMinor, rs(1000));
  });

  it('edit-and-confirm overrides wallet, category and classification', async () => {
    const { repo } = await setup();
    const { observation } = await repo.ingestParsedEvent(event({ direction: 'in', reference: '999', categoryKey: undefined, incomeSource: 'Other' }));
    assert.equal(observation.suggestedClassification, 'income');
    const cash = await repo.getWalletByName('Cash');
    const before = await balanceOf(repo, 'Cash');
    const { transaction } = await repo.confirmObservation(observation.id, {
      walletId: cash!.id,
      classification: 'refund_received',
      categoryId: null,
    });
    assert.equal(transaction.classification, 'refund_received');
    assert.equal(await balanceOf(repo, 'Cash'), before + rs(500));
    // Refunds never count as income.
    assert.equal((await repo.getDashboard('2026-10')).monthIncomeMinor, 0);
  });
});

describe('pending and failed transactions are never posted', () => {
  it('pending goes to review and confirm is refused', async () => {
    const { repo } = await setup();
    const { observation } = await repo.ingestParsedEvent(event({ parseStatus: 'pending', reference: 'P1' }));
    assert.equal(observation.status, 'needs_review');
    assert.match(observation.reason ?? '', /PENDING/);
    await assert.rejects(() => repo.confirmObservation(observation.id), /PENDING/);
    assert.equal((await repo.getDashboard('2026-10')).monthExpensesMinor, 0);
  });

  it('failed goes to review and confirm is refused', async () => {
    const { repo } = await setup();
    const { observation } = await repo.ingestParsedEvent(event({ parseStatus: 'failed', reference: 'F1' }));
    assert.equal(observation.status, 'needs_review');
    assert.match(observation.reason ?? '', /FAILED/);
    await assert.rejects(() => repo.confirmObservation(observation.id), /FAILED/);
    assert.equal((await repo.getDashboard('2026-10')).monthExpensesMinor, 0);
  });
});

describe('candidate matching (never merge on amount alone)', () => {
  it('two same-amount events with different references and counterparties both stay importable', async () => {
    const { repo } = await setup();
    const a = await repo.ingestParsedEvent(event({ reference: 'A1', counterparty: 'SHOP ONE' }));
    const b = await repo.ingestParsedEvent(event({ reference: 'B2', counterparty: 'SHOP TWO', occurredAt: T0 + 5 * MIN }));
    assert.equal(a.observation.status, 'new');
    assert.equal(b.observation.status, 'new');
    await repo.confirmObservation(a.observation.id);
    await repo.confirmObservation(b.observation.id);
    assert.equal((await repo.getDashboard('2026-10')).monthExpensesMinor, rs(1000));
  });

  it('a cross-source copy (SMS then notification) is flagged as a candidate, not merged', async () => {
    const { repo } = await setup();
    const sms = await repo.ingestParsedEvent(event());
    await repo.confirmObservation(sms.observation.id);
    // The same purchase reported by the bank app 3 minutes later, but the
    // notification carries no reference — Layer 4 must flag it for review.
    const notif = await repo.ingestParsedEvent(
      event({ source: 'notification', reference: null, occurredAt: T0 + 3 * MIN }),
    );
    assert.equal(notif.observation.status, 'needs_review');
    const smsTxnId = (await repo.getObservation(sms.observation.id))?.transactionId;
    assert.equal(notif.observation.candidateTransactionId, smsTxnId);
    // The user resolves it as a duplicate.
    await repo.markObservationDuplicate(notif.observation.id);
    assert.equal((await repo.getDashboard('2026-10')).monthExpensesMinor, rs(500));
  });

  it('an unrelated same-amount entry hours later is NOT flagged', async () => {
    const { repo } = await setup();
    const a = await repo.ingestParsedEvent(event());
    await repo.confirmObservation(a.observation.id);
    const b = await repo.ingestParsedEvent(
      event({ reference: null, occurredAt: T0 + 5 * 60 * MIN }),
    );
    assert.equal(b.observation.status, 'new');
  });
});

describe('transfer pairing', () => {
  it('pairs opposite-direction events across institutions and confirms them as ONE transfer', async () => {
    const { repo } = await setup();
    const out = await repo.ingestParsedEvent(
      event({ reference: 'T1', amountMinor: rs(2000), counterparty: 'Own account', categoryKey: 'other' }),
    );
    assert.equal(out.observation.status, 'new');
    const into = await repo.ingestParsedEvent(
      event({
        institution: 'Easypaisa', institutionId: 'easypaisa', direction: 'in',
        reference: 'T2', amountMinor: rs(2000), counterparty: 'Own account',
        occurredAt: T0 + 6 * MIN, categoryKey: undefined, incomeSource: 'Other',
      }),
    );
    assert.equal(into.observation.status, 'needs_review');
    assert.equal(into.observation.candidateObservationId, out.observation.id);
    assert.equal((await repo.getObservation(out.observation.id))?.status, 'needs_review');

    const jazzBefore = await balanceOf(repo, 'JazzCash');
    const easyBefore = await balanceOf(repo, 'Easypaisa');
    const { transaction } = await repo.confirmObservationAsTransfer(into.observation.id);
    assert.equal(transaction.classification, 'transfer');
    assert.equal(await balanceOf(repo, 'JazzCash'), jazzBefore - rs(2000));
    assert.equal(await balanceOf(repo, 'Easypaisa'), easyBefore + rs(2000));
    const dash = await repo.getDashboard('2026-10');
    assert.equal(dash.monthIncomeMinor, 0);
    assert.equal(dash.monthExpensesMinor, 0);
    assert.equal((await repo.getObservation(into.observation.id))?.status, 'imported');
    const pairAfter = await repo.getObservation(out.observation.id);
    assert.equal(pairAfter?.status, 'duplicate');
    assert.equal(pairAfter?.transactionId, transaction.id);
  });

  it('does not pair same-institution or out-of-window events', async () => {
    const { repo } = await setup();
    await repo.ingestParsedEvent(event({ reference: 'X1', amountMinor: rs(700) }));
    const sameInstitution = await repo.ingestParsedEvent(
      event({ direction: 'in', reference: 'X2', amountMinor: rs(700), occurredAt: T0 + 5 * MIN, categoryKey: undefined, incomeSource: 'Other' }),
    );
    assert.equal(sameInstitution.observation.candidateObservationId, null);
    const late = await repo.ingestParsedEvent(
      event({
        institution: 'Easypaisa', institutionId: 'easypaisa', direction: 'in', reference: 'X3',
        amountMinor: rs(700), occurredAt: T0 + 45 * MIN, categoryKey: undefined, incomeSource: 'Other',
      }),
    );
    assert.equal(late.observation.candidateObservationId, null);
  });
});

describe('bulk inbox actions', () => {
  it('bulk confirm reports per-item failures honestly; bulk ignore only touches reviewable items', async () => {
    const { repo } = await setup();
    const a = await repo.ingestParsedEvent(event({ reference: 'BC1' }));
    const b = await repo.ingestParsedEvent(event({ reference: 'BC2', counterparty: 'OTHER', occurredAt: T0 + 90 * MIN }));
    const pending = await repo.ingestParsedEvent(event({ reference: 'BC3', parseStatus: 'pending', occurredAt: T0 + 120 * MIN }));
    const result = await repo.bulkConfirmObservations([a.observation.id, b.observation.id, pending.observation.id]);
    assert.deepEqual(result.confirmed.sort(), [a.observation.id, b.observation.id].sort());
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].id, pending.observation.id);

    const c = await repo.ingestParsedEvent(event({ reference: 'BC4', occurredAt: T0 + 180 * MIN }));
    const ignored = await repo.bulkIgnoreObservations([c.observation.id, a.observation.id]);
    assert.equal(ignored.ignored, 1); // a is already imported — untouched
    assert.equal((await repo.getObservation(c.observation.id))?.status, 'ignored');
    await assert.rejects(() => repo.confirmObservation(c.observation.id), /ignored/);
  });

  it('counts by status track the inbox tabs', async () => {
    const { repo } = await setup();
    await repo.ingestParsedEvent(event({ reference: 'C1' }));
    await repo.ingestParsedEvent(event({ reference: 'C2', parseStatus: 'pending', occurredAt: T0 + 200 * MIN }));
    const counts = await repo.countObservationsByStatus();
    assert.equal(counts.new, 1);
    assert.equal(counts.needs_review, 1);
    assert.equal(counts.imported, 0);
  });
});
