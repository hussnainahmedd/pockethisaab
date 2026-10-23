# PocketHisaab v2 — M2 Implementation Report

## Centralized Ledger, Wallets, and Reconciliation

**Date:** 2026-10-24
**Milestone:** M2 of the PocketHisaab v2 master development prompt
**Baseline:** v1.1.3 source; GitHub `main` at `eb330bc1` (Dependabot lockfile commit — reconciled, not reverted)
**Status:** Complete. All automated tests pass. No production data was touched, nothing was pushed, and no device database was modified.

---

## 1. Owner decisions applied in M2

On 2026-10-24 the owner confirmed:

1. All existing PocketHisaab financial records are **old test data** — preservation/migration of v1 financial records is **not required**.
2. M2 proceeds with a **clean v2 financial database architecture**.
3. Discarding the old test records is authorized **only through a controlled reset** (Section 9). The repository and unrelated application files must not be deleted.
4. The existing app installation and device data must **not** be erased automatically.
5. Backup/restore stays in the v2 roadmap (delivered in M6) for future records.

How these were honored technically:

- The v2 ledger lives in a **separate database file**, `pockethisaab-v2.db`. The v1 file (`pockethisaab.db`) is never opened for financial reads/writes by v2 code and is never deleted by any code path in this milestone.
- v2 starts **empty**: zero transactions, zero balances. The four default wallets are seeded as structure only — no opening postings, no fake records.
- A `performControlledReset()` function exists in the repository but is **never called by app code**. It refuses to run without the exact token `RESET-POCKETHISAAB-V2`, and it clears only the v2 database.

---

## 2. Objective

Replace the v1 three-table calculation model (income/expenses/udhaar with `REAL` amounts and per-screen formulas) with a central, deterministic, integer-paisa double-entry ledger, with wallets, correct loan accounting, database-level duplicate prevention, atomic writes, partial udhaar repayments, and one reporting service that every screen shares.

This milestone closes M1 findings P0-1 (balance was neither cash nor net worth), P0-3 (self-transfer deletion), P0-5 (non-atomic imports), P0-6 (global reference-only dedup) at the data-layer level, and the accounting half of P0-8 groundwork (a single consistent ledger that M6 backups can snapshot). The Rs 487 stale-snapshot defect class is closed by design: all screens now read one reporting service fed by a monotonically increasing **ledger revision**.

---

## 3. Architecture

### 3.1 Accounting model (strict double-entry)

- Every posted transaction owns **two or more postings**; the postings of one transaction **sum to exactly zero paisa** (enforced by the pure engine before insert and re-verified by `verifyIntegrity()`).
- Account kinds:
  - `wallet` (asset) — balance = SUM(postings)
  - `receivable` (asset, one per loan lent) — balance = SUM(postings)
  - `payable` (liability, one per loan borrowed) — balance = −SUM(postings)
  - `external` (the outside world) — counter-account for income/expenses/refunds/fees/openings/adjustments; not part of net worth
- **Net worth = wallet balances + receivables − payables.** Borrowing raises cash and payables equally, so net worth does not move — the exact case v1 got wrong (v1 showed Rs 0 where the correct cash was Rs 10,000 and net worth Rs 8,000).

### 3.2 Classifications

`income`, `expense`, `fee`, `transfer`, `loan_lent`, `loan_borrowed`, `repayment_received`, `repayment_made`, `refund_received`, `refund_issued`, `balance_adjustment`, `opening_balance`.

Monthly reporting rules (single definition, used by Home, Expenses and Stats):

- Monthly income = `income` only. Repayments, refunds, loans and transfers are **never** income.
- Monthly expenses = `expense` + `fee`.
- Monthly net = income − expenses.
- Monthly net cash flow = sum of wallet postings in the month excluding `opening_balance` (captures borrowing/lending/repayments/adjustments, which income−expenses deliberately excludes).

### 3.3 Money

- Integer paisa everywhere (`amount_minor INTEGER`, `CHECK (amount_minor > 0)`; postings `CHECK (amount_minor != 0)`). `REAL` is banned from money columns.
- Strict string parser: rejects `1.005` (>2dp), `0x10`, `1e3`, `1,2,3`, malformed comma groups, signs and overflow — every input the v1 parser corrupted (M1 probes) is now rejected instead of silently misconverted.
- Rupees↔paisa conversion happens only at the legacy UI boundary.

### 3.4 Schema (`pockethisaab-v2.db`, version tracked in `schema_migrations` + `meta`)

Tables: `schema_migrations`, `meta` (incl. `ledger_revision`), `wallets`, `people` (AES-encrypted name + deterministic lookup key), `categories`, `accounts`, `transactions`, `postings`, `loans`, `external_identities` (UNIQUE(scope, identity)), `import_observations` (UNIQUE fingerprint; M4 inbox foundation), `legacy_refs` (facade ID aliases).

Foreign keys are declared and enabled; CHECK constraints reject invalid classifications, statuses, amounts and dates at the database level — raw SQL cannot corrupt the ledger (proven by tests).

### 3.5 Atomicity and duplicate prevention

- Every financial operation runs in **one SQLite transaction**: transaction row + postings + loan row/status + dedup identity + revision bump commit or roll back together.
- Duplicate prevention is layered: DB UNIQUE on `transactions.idempotency_key`, DB UNIQUE on `external_identities(scope, identity)`, DB UNIQUE on observation fingerprints. A bank reference is only unique **within its institution+account scope**, so the same reference number at another bank is a different transaction, and two same-amount transactions on the same day are both kept when their references differ.
- Corrections are **append-only reversals**: the original is marked `reversed`, a negating transaction is posted, and history stays complete and balanced. Nothing is hard-deleted.

### 3.6 Loans and partial repayments

- A loan has a principal transaction, its own receivable/payable account, and a **remaining balance derived from postings** (never a stored number that can drift).
- `recordRepayment()` accepts any amount up to the remaining balance, updates loan status (`open` → `partially_paid` → `settled`) in the same write path, and **rejects overpayment** with the remaining balance unchanged.
- Settling from the existing UI now records a real full repayment for the exact remaining amount; unsettling reverses that repayment (v1 only flipped a flag, which moved borrowed balances the wrong way).

---

## 4. Files

### New

| File | Purpose |
|---|---|
| `lib/finance/money.ts` | Integer-paisa parsing/formatting; strict parser; boundary conversion |
| `lib/finance/types.ts` | Domain types + driver/protector interfaces |
| `lib/finance/schema.ts` | v2 DDL, seed wallets (Cash, JazzCash, Easypaisa, Bank Account) and categories |
| `lib/finance/engine.ts` | Pure double-entry posting planner + balance mathematics |
| `lib/finance/repository.ts` | SQLite ledger repository: operations, loans, repayments, reversals, reporting, integrity check, controlled reset |
| `lib/finance/appLedger.ts` | expo-sqlite driver + app singleton (opens only the v2 file) |
| `tests/finance/*.ts` | node:test suite running the real repository against real SQLite (node:sqlite driver) |
| `tsconfig.test.json` | Test compilation config |
| `docs/V2-M2-IMPLEMENTATION.md` | This report |

### Changed

| File | Change |
|---|---|
| `lib/db.ts` | Replaced by a compatibility facade over the v2 ledger (same exports/signatures the screens use; rupees at the boundary, paisa inside; deletes/edits become reversals; dashboard balance is now net worth; auto-fetch amount-pairing lookups disabled — see Limitations) |
| `lib/legacyDb.ts` | The former `lib/db.ts`, preserved verbatim; still serves app meta/update state and the auto-fetch seen-store |
| `package.json` | Added `test:finance` script |
| `tsconfig.json` | Excludes `tests/` from the app typecheck |
| `.gitignore` | Ignores `tests/.build/` |

### Not changed

All screens, the Android/autofetch native module, the SMS/notification parsers, app version numbers (version bump belongs to the M7 release gate), and the v1 database code paths for app meta.

---

## 5. How the existing app integrates

- `initDatabase()` (called from the root layout) initializes the legacy meta store **and** the v2 ledger. On an existing device the v1 financial tables stop being read; the v1 file — including its test records — remains on the device untouched until the owner runs the controlled procedure in Section 9.
- Manual income/expense/udhaar entered through the current screens post into the v2 ledger against the **Cash** wallet (the current UI has no wallet picker; native wallet selection arrives with the M3/M5 transaction flows). Opening balances for JazzCash/Easypaisa/Bank are entered through the ledger API and, in the app, from M3's wallet screens.
- v1 numeric IDs are durable aliases for v2 UUIDs (`legacy_refs`), so edit screens that pass IDs via route params keep working across restarts.
- Auto-fetch writes now land in the v2 ledger through the facade. The destructive same-amount self-transfer pairing is disabled (its lookup functions return no match), so auto-fetch can never delete a ledger entry. Transfer classification for own-account movements is M4 work.

---

## 6. Tests and evidence

Command: `npm run test:finance` (compiles the finance modules + tests, then runs `node --test` against a real SQLite database via `node:sqlite`).

**Result: 37 tests, 37 passed, 0 failed.** App typecheck: `npm run typecheck` — **passed with no errors**. Expo config resolves unchanged (`npx expo config`).

Coverage:

- **Money (6 tests):** exact parsing incl. comma groups; rejection of every v1 parser corruption case; zero/overflow rules; paisa addition with no float drift (0.10 + 0.20 = 0.30 exactly); formatting; boundary conversion.
- **Engine (6 tests):** every operation kind balances to zero; zero/negative principals and same-wallet transfers rejected; payable credit-normal sign; engine balance math; loan remaining by direction; reversal negation.
- **Master-prompt examples (6 tests):** (1) opening 10,000 − expense 2,000 − lent 3,000 → cash 5,000, receivables 3,000, net worth 8,000. (2) Lending is not an expense — monthly expenses stay 2,000. (3) Repayment of 1,000 → receivables 2,000, cash 8,000, income still 0. (4) Borrowing 5,000 → cash 10,000, payables 5,000, net worth 8,000 (v1 showed 0). (5) Repaying borrowed money cuts cash and payables, net worth unchanged. (6) Transfer JazzCash→Easypaisa 1,200 → 1,800/1,200, total cash and net worth unchanged.
- **Partial repayments (2 tests):** 5,000 lent → repay 1,000 → 1,500 → remaining 2,500 with `partially_paid` status; overpayment of 2,501 rejected with balance unchanged; final 2,500 settles the loan and records the settlement transaction; reversing a repayment restores the remaining balance and reopens the loan.
- **Refunds/fees/adjustments (2 tests):** refunds excluded from income; fees included in expenses (monthly expenses 1,100); adjustment moves cash only; monthly net cash flow −1,150; negative wallet balance recorded honestly (−150) instead of inventing money.
- **Dedup/idempotency (3 tests):** same idempotency key posts once; Faysal scope+reference `366002` posts once while the same reference under an HBL scope and a different reference under the Faysal scope both post; observation fingerprints unique.
- **Atomicity (2 tests):** fault injection failing the second posting insert rolls back the transaction row, postings and revision — balances and counts provably unchanged; invalid amounts rejected at the repository boundary.
- **Schema enforcement (2 tests):** raw SQL violating CHECK constraints (negative amount, unknown classification, zero posting) is rejected; foreign keys enforced.
- **Reporting consistency (4 tests):** repository dashboard equals the pure engine computed over raw postings after a mixed scenario; month boundaries respected; monthly stats agree with the dashboard (the Rs 487 disagreement class); history is newest-first with reversals hidden; per-person summaries use remaining balances netted per person.
- **Reset (1 test):** wrong/empty token refused with data intact; correct token clears only v2 data and reseeds four zero-balance wallets; integrity passes afterwards.
- **Fresh start (2 tests):** seeded wallets are exactly Cash/JazzCash/Easypaisa/Bank Account at zero with zero transactions; repeated init never wipes data.
- **Facade support (1 test):** legacy numeric aliases are stable, distinct per entity, and remappable.

### Defect found by the suite and fixed during M2

The engine's amount validator checked integer/magnitude but not positivity, so a negative principal could be planned. Fixed by requiring positive principals in the posting planner; the failing test now passes and the fix is covered by the boundary-rejection tests.

---

## 7. Database-compatibility check

- Fresh install: v2 schema creates cleanly; zero balances; integrity check passes.
- Existing v1.1.3 install: the v2 file is created alongside the v1 file; the v1 file is not opened, migrated, or deleted by v2 code. Legacy financial records are not migrated, per the owner's clean-start decision.
- No migration framework was needed for v1 data (owner decision), but the v2 schema is versioned (`schema_migrations`, `user_version`-style meta) so future v2→v3 migrations are ordered and testable.

---

## 8. Limitations (explicit)

1. **No Android build or physical-device run in M2.** The repository is verified against real SQLite through the node:sqlite driver running the identical code and schema the app uses, and the app typechecks; an on-device smoke check belongs to the M7 release gate (and can be done earlier on request).
2. **Facade wallet default:** current screens have no wallet picker, so facade writes use the Cash wallet until M3/M5 add wallet-aware flows. Ledger APIs themselves are fully wallet-aware and tested.
3. **Facade edits** of loans that already have repayments are refused (with a clear error) rather than rewriting settled history; M3's native repayment UI handles those loans.
4. **Auto-fetch transfer pairing is disabled, not yet replaced.** Own-account transfers imported by auto-fetch will appear as income + expense (balance-correct, classification pending) until M4 implements transfer classification and the import review inbox on top of `import_observations`.
5. **Backup/restore is not implemented in M2** — by design it is M6, now straightforward because all financial state lives in one consistent ledger file plus the field-encryption key.
6. App version remains 1.1.3 in source; the 2.0.0 version bump is part of the M7 release gate.

---

## 9. Controlled reset procedure (for owner approval — not yet run)

Nothing below has been executed. It is the procedure the owner approves when he is ready to discard the v1 test data on his device:

1. Install the first v2 build **over** the existing app (do not uninstall first — the v2 ledger and settings must carry over).
2. Open the app once and confirm the v2 dashboard shows zero balances and the four wallets.
3. Enter actual opening balances per wallet (Cash, JazzCash, Easypaisa, Bank Account) — these become the first real `opening_balance` postings.
4. Only then, discard the legacy test database: Android **Settings → Apps → PocketHisaab → Storage** cannot delete a single file, so the supported path is an in-app maintenance action (to be surfaced in M6 settings as “Delete legacy v1 data”) which deletes only `pockethisaab.db` after an explicit confirmation. Until that action ships, the legacy file simply sits unused on the device — it costs a few KB and affects nothing.
5. The v2 database itself can be reset at any time through the repository's token-gated `performControlledReset('RESET-POCKETHISAAB-V2')`; it is intentionally not wired to any UI in M2.

---

## 10. Next milestone

**M3 — Full CRUD, bulk operations, and advanced udhaar:** native v2 transaction/wallet/loan screens data flows (wallet picker, opening-balance entry, repayment screens with partial amounts, person and category management, search/sort/multi-select bulk actions with reversal-based undo) built directly on the repository delivered here. M3 should not start until the owner approves this report.
