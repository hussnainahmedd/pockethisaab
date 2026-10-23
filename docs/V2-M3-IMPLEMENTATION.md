# PocketHisaab v2 — M3 Implementation Report

## Full CRUD, Bulk Operations, and Advanced Udhaar

**Date:** 2026-10-24
**Milestone:** M3 of the PocketHisaab v2 master development prompt (Phases 4, 5, 6, 7)
**Baseline:** M2 ledger (37 tests passing)
**Status:** Complete. 63/63 automated tests pass, full-app typecheck is clean, and nothing was pushed. No device data was touched.

---

## 1. Objective

Turn the M2 ledger into a fully manageable app: complete CRUD for every user-managed entity that exists in the product today, safe single and bulk deletion with undo, wallet management with opening balances and reconciliation, Send/Receive recording flows with explicit purpose classification, and an advanced udhaar system with per-loan tracking, editable repayments, overdue calculation, reminders, and person statements.

Scope note (per the milestone order in the master prompt): budgets, savings goals, recurring transactions and reminders-as-an-entity are **Phase 8** features and belong to a later milestone; M6 owns encrypted backups/exports. M3 covers CRUD for transactions, income, expenses, wallets, udhaar, repayments, people, and categories, plus udhaar reminder dates (Phase 5.5 metadata) and the person-statement export (Phase 5.4).

---

## 2. Repository changes (data layer)

The M2 internals were refactored so multi-step operations compose inside **one** database transaction (`insertPlannedInner` / `reverseInner` / `voidLoanInner` cores with transaction-wrapped public wrappers). `recordRepayment` now validates, posts, and updates loan status in a single transaction (M2 had two sequential transactions — closed as part of this milestone).

### Wallets (Phase 7)
- `updateWallet`, `setWalletArchived`, `deleteWallet` — hard delete only when the wallet has zero postings and no linked loans; otherwise the user is directed to archive.
- `getWalletDetail` — balance, ledger-entry count, opening-balance flag, recent history.
- `reconcileWallet(actual)` — with no postings, the actual balance becomes the opening balance; otherwise the difference is posted as a `balance_adjustment`. Recorded history is never overwritten.

### People
- `listPeople` (search, archived toggle), `updatePerson` (rename re-keys the duplicate-detection hash and **rejects name collisions** with a clear merge-not-supported message), `setPersonArchived`, `deletePerson` (only with zero loans and zero transactions).

### Categories
- `createCategory`, `updateCategory`, `setCategoryArchived`, `deleteCategory` (custom + unused only; built-in categories are delete-protected, archive instead).

### Transactions (Phase 6)
- Query engine extended: classification sets, category, wallet, date range, amount range, **free-text search** over counterparty/note/reference/category/classification (runs over decrypted values in a bounded candidate set), four sort orders, limit/offset pagination, and `countTransactions` for page labels.
- `getTransactionPostings` for detail views (account kinds, wallet names, signed amounts).
- `updateTransactionMetadata` — note/counterparty/reference/category edits that never touch postings.
- `editSimpleTransaction` — amount/date/wallet corrections for income, expense, fee, refunds, opening balances, adjustments, and transfers via **reverse + corrected entry in one transaction**. Loan-linked transactions refuse this path and direct to the loan flows.
- `duplicateTransaction` and `restoreTransaction` (restore works on reversed simple transactions; loan-linked restores go through the loan).

### Bulk operations (Phase 6)
Each bulk action is a **single atomic transaction** with validate-everything-first semantics — one invalid item aborts the whole batch with a "Nothing was changed" error:
- `bulkReverseTransactions` — loan principals are refused (they must go through loan void so repayments are never orphaned).
- `bulkSetCategory` — income/expense/fee only.
- `bulkVoidLoans` — voids several loans, each reversing repayments then principal.
- `summarizeTransactions` — count/total/by-classification used by confirmation dialogs to show the exact financial effect before the user confirms.

### Advanced udhaar (Phase 5)
- Multiple loans per person stay separate end-to-end (per-loan remaining, status, history).
- `updateLoan` — principal/wallet/date changes repost the principal via reversal + corrected entry in one transaction; the new principal can never drop below the amount already repaid. Due date and note edit in place.
- `editRepayment` — reverse + corrected repayment in one transaction, validated against the post-reversal remaining balance.
- `getLoanDetail` — remaining, total repaid, repayment history (excluding bookkeeping reversal entries), **overdue** flag and exact **days overdue** from the due date.
- `setLoanReminder` — reminder date stored on the loan (new `reminder_date` column; init adds it idempotently to any pre-M3 v2 dev database). Notification scheduling itself is an OS concern and is not faked here.
- `restoreLoan` — reposts the principal and **exactly** the repayments the void itself reversed (identified by the void marker), in original order. A repayment the user reversed independently before the void stays reversed — proven by test.
- `getPersonStatementData` + `lib/finance/statement.ts` — person statement as data, text, and CSV (totals lent/borrowed/repaid, remaining receivable/payable, per-loan lines). Sharing is user-initiated via the OS share sheet; nothing is sent automatically, and WhatsApp auto-sending is explicitly not implemented.

---

## 3. Screens (functional UI in the current design language; the M5 redesign restyles these)

| Screen | What it does |
|---|---|
| `app/transactions.tsx` | Full history: text search, classification filter tabs, 4 sort orders, pagination, multi-select with select-all-visible, bulk delete (confirmation shows count + total, then an **Undo** banner), bulk categorize |
| `app/transaction/[id].tsx` | Detail + edit: amount/date/wallet/category/note/counterparty/reference, duplicate, delete (reverse), restore; loan-linked entries route to the loan screen; accepts v2 UUIDs and legacy numeric IDs |
| `app/wallets.tsx` | Wallet list with live balances, archived section, create wallet (name/kind) starting at Rs 0 |
| `app/wallet/[id].tsx` | Balance, opening-balance setup (only when empty), reconcile against an actual balance, edit name/icon, transfer out, history, archive/restore, guarded delete |
| `app/transfer.tsx` | Wallet-to-wallet transfer form |
| `app/send.tsx` | **Send Money (Phase 4):** purpose first — Expense, Udhaar given, Udhaar repayment (pick the open borrowed loan), Wallet transfer, Fee, Refund issued — with wallet/category/person/due-date/reference fields per purpose |
| `app/receive.tsx` | **Receive Money (Phase 4):** Income (Pocket Money preselected), Udhaar repayment received (pick the open lent loan), Udhaar borrowed, Wallet transfer, Refund received |
| `app/loan/[id].tsx` | Loan detail: repaid progress bar, overdue banner, partial repayment form (wallet + date), repayment history with per-repayment **edit** and **reverse**, edit loan (principal/wallet/date/due date/note), reminder date, settle in full, reopen (undo settlement), share statement / share CSV, delete (void) and restore; accepts UUIDs and legacy IDs |
| `app/people.tsx` | Search, add person (name + optional phone, no contacts permission), per-person open balances, edit/archive/delete with repository guards |
| `app/categories.tsx` | Expense/income category lists, add custom, edit, archive/restore, guarded delete |

Both Send and Receive state plainly that PocketHisaab **records** movements and does not initiate real bank transfers (Phase 4 honesty rule).

### Wiring
- New routes registered in `app/_layout.tsx`.
- Home gains a second quick-action row (Send / Receive / Transfer) and a **Manage** section (Transactions, Wallets, People, Categories).
- Person detail rows now tap through to the full loan screen; long-press edit/delete is unchanged.

---

## 4. Tests and evidence

`npm run test:finance` — **63 tests, 63 passed, 0 failed** (37 M2 + 26 new). `npm run typecheck` — clean. `npx expo config` — resolves unchanged.

New coverage:
- **Wallets (4):** create/update/archive/restore; delete-unused vs refuse-with-transactions; reconcile as opening-then-adjustment incl. no-op; wallet detail numbers.
- **People (2):** rename/phone update with loan aggregates following the rename, duplicate-name rejection, delete guards, archive; name search.
- **Categories (1):** custom create/update, duplicate rejection, delete-used refusal, built-in delete protection, archive hiding.
- **Search (1):** structured filters + text search + amount sort + pagination/count agreement on a mixed dataset.
- **Corrections (3):** metadata edit leaves balances untouched; amount+wallet edit moves money exactly and old entry is reversed; duplicate/restore round-trip; loan-linked edits refused.
- **Bulk (4):** bulk delete totals and balance restoration; atomic abort leaves everything posted; loan principals refused; bulk categorize atomicity; bulk void loans restores cash to the opening amount.
- **Advanced udhaar (8):** multiple loans per person; repayment edit up/down with over-limit rejection; principal edit floor at the repaid amount; loan wallet move shifts cash correctly; overdue + days-overdue against an injected clock, settled/future loans not overdue; reminder set/clear; void → restore reinstates principal and repayments exactly; independently-reversed repayment is **not** resurrected by restore; statement data/text/CSV figures.

### Defects found by the M3 suite and fixed
1. **Corrupt reversal links (latent M2 bug, now fixed):** `reverseTransaction` stored the reversal's **own** ID in `reverses_transaction_id` instead of the original's ID. Balances were always correct (postings carry the effect), and M2 tests passed because nothing read the link — M3's loan-restore was the first consumer and exposed it. Fixed, and `verifyIntegrity()` now validates every reversal link so this class of bug fails loudly forever.
2. **Interim negative remaining during principal edits:** reversing a principal before reposting made the loan's remaining briefly negative and tripped the integrity guard. Reversal now accepts an explicit skip of the intermediate status refresh for reconstruction flows; the caller refreshes once the corrected principal is posted.
3. **Loan detail counted bookkeeping reversals as repayments** (each reversal is itself a posted repayment-classified entry). The repayment history now excludes reversal entries.
4. **Test-config inheritance bug:** the main tsconfig's `exclude: ["tests"]` leaked into the test tsconfig and silently excluded the new suites — caught because the test count didn't move; fixed and noted here so the count is always checked, not assumed.

---

## 5. Database compatibility

- Same v2 database file; one additive column (`loans.reminder_date`) added to the DDL and via an idempotent init check for any pre-M3 v2 dev database. No data migration, no destructive change.
- The v1 file remains untouched, exactly as in M2. Controlled-reset procedure from the M2 report is unchanged.
- Legacy numeric IDs from the existing screens keep working everywhere (transaction and loan detail screens resolve them).

## 6. Limitations (explicit)

1. **No physical-device run or Android build in M3** (same as M2) — screens typecheck against the tested repository, and all business logic runs in the automated suite; device verification is the M7 gate.
2. **Reminders are stored, not scheduled.** Due/overdue state is computed and displayed; OS notification scheduling and user-initiated WhatsApp share-sheet reminders beyond the statement share are not wired in M3.
3. **Bulk undo covers simple transactions.** The Transactions screen's Undo restores reversed non-loan entries; loan restores live on the loan screen (`restoreLoan`).
4. **Person merge is not supported** — renaming onto an existing person is rejected with guidance, rather than silently merging financial histories.
5. **Classification changes** are not offered as an edit (delete + recreate with the right purpose via Send/Receive); amount/date/wallet/metadata edits are covered.
6. Budgets, savings goals, and recurring transactions (Phase 8) and encrypted backup/export files (Phase 13/M6) remain scheduled for later milestones, as does the M5 visual redesign of these new screens.

## 7. Next milestone

**M4 — Android notification import, parsing, and deduplication:** import inbox on top of `import_observations` (New / Needs Review / Imported / Ignored / Duplicates), parser hardening (pending/failed never posted), cross-source dedup using the scoped external identities delivered in M2, transfer classification to replace the disabled amount-pairing, and the Faysal allowlist resync fix. M4 should not start until the owner approves this report.
