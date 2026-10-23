# PocketHisaab v2 — M1 Audit Report

**Milestone:** M1 — Repository audit, database safety review, and financial correctness  
**Date:** 2026-10-24 (Asia/Karachi)  
**Audited application version:** 1.1.3 (Android versionCode 6)  
**GitHub baseline:** `main` at `eb330bc134586d9456b4339628bab098feea83c5`  
**Local source:** `~/workspace/projects/pockethisaab`  
**M1 status:** Audit complete. No production code was changed, no device database was accessed, and no financial record was created, edited, or deleted during this audit.

---

## 1. Executive verdict

PocketHisaab v1.1.3 is a useful three-table personal tracker, but it is **not yet a financial ledger**:

- Money is stored in SQLite `REAL` columns and processed with JavaScript floating-point numbers.
- There are no wallets, opening balances, transaction classifications beyond income/expense/udhaar, balanced postings, partial repayments, or a central accounting engine.
- The dashboard “balance” is neither reliable available cash nor net worth. Borrowing is subtracted instead of added to cash.
- Imported transactions are written directly into income/expense tables. Transfers, ATM withdrawals, loans, repayments, refunds, pending transactions, and failed transactions can therefore be misclassified or counted incorrectly.
- Deduplication is not protected by database uniqueness or atomic transactions. The self-transfer detector can delete a legitimate unrelated transaction solely because another auto transaction has the same amount on the same date.
- Existing users have no in-app backup/restore/export path. A phone loss, uninstall, or “clear data” can permanently destroy the only copy of the ledger.

**Recommendation:** Do not start the visual redesign or add budgets/goals/recurring features on top of the current data model. M2 must first introduce a versioned ledger schema, integer-paisa money, explicit transaction classifications, wallets/opening balances, atomic postings, and a migration that preserves legacy data without inventing balances.

---

## 2. Audit method and evidence limits

### 2.1 What was inspected

- `package.json`, `package-lock.json`, `app.json`, `eas.json`, `version.json`, `tsconfig.json`, Babel config, and `.gitignore`
- All Expo Router screens:
  - Home, Expenses, Udhaar, Stats
  - Add/edit income, expense, and udhaar
  - Income list
  - Person detail
  - Auto-fetch settings
  - Root and tab layouts
- Shared UI and theme (`components/ui.tsx`, `components/theme.ts`)
- Data and support libraries:
  - `lib/db.ts`
  - `lib/format.ts`
  - `lib/crypto.ts`
  - `lib/update.ts`
  - `lib/autofetch/parser.ts`
  - `lib/autofetch/senders.ts`
  - `lib/autofetch/service.ts`
- Native Android module:
  - Notification listener
  - SMS receiver
  - Native module bridge
  - Disk queue
  - SharedPreferences store
  - Expo config plugin
  - Module Gradle/config files
- README and product/security/release docs
- Existing app icon and the three screenshots stored in the repository
- GitHub `main` tree, recent commits, and repository file list through the GitHub API

### 2.2 Repository inventory

Excluding `node_modules`, the repository contains **51 files**. The reviewed source and documentation total approximately **5,319 lines**, including:

| Area | Files / notes |
|---|---|
| Routes/screens | 16 TSX files under `app/` |
| Shared UI | `components/theme.ts`, `components/ui.tsx` |
| Core libraries | `lib/db.ts` (642 lines), `lib/crypto.ts`, `lib/format.ts`, `lib/update.ts` |
| Auto-fetch JS | Parser 285 lines, service 341 lines, senders 78 lines |
| Native Android | 6 Kotlin files plus Gradle/config/plugin files |
| Tests | **None found** |
| GitHub Actions workflows in repo | **None found** |
| Lint configuration/script | **None found** |
| Screenshots in repo | Home, Expenses, Udhaar marketing-style images |
| App icon | `assets/icon.png` |

### 2.3 Local tree versus GitHub

The local working copy is not itself a Git checkout. Its file list was compared with GitHub `main` using Git blob hashes:

- Remote files: 51
- Local files: 51
- Missing/extra files: none
- Content difference: **`package-lock.json` only**

GitHub `main` is one Dependabot commit ahead of the v1.1.3 source baseline:

- `eb330bc1` — `source-map-js` 1.2.1 → 1.2.2

M2 must start from GitHub `main` (`eb330bc1`) or explicitly reconcile the lockfile. Building v2 from the stale local lockfile would silently revert that dependency update.

### 2.4 Screenshot evidence limitation

The three screenshots in the repository were inspected, together with the current icon. They are polished marketing-style phone mockups with generic sample values (for example, November 2024 and Rs 8,750 on the Expenses image). They do **not** show the reported live values:

- Home: Rs 19,736
- Expenses: Rs 20,223
- Statistics: Rs 20,223

The additional current-app screenshots named in the master prompt—Statistics values, Add Udhaar, Add Expense, person detail, settings, and the live Home/Expenses captures behind the Rs 487 discrepancy—are not present in the repository. They were therefore **not claimed as inspected**.

Transaction-level attribution of the exact Rs 487 record would require either:

1. The original live screenshots with their capture order/times, or
2. A privacy-safe export/snapshot of the device database showing expense rows around the capture time.

The code-level cause of how the screens can disagree is nevertheless proven below.

---

## 3. Current feature assessment

### A. Working features (within the v1 model)

- Manual income CRUD for individual records.
- Manual expense CRUD for individual records.
- Manual udhaar create/edit/delete for individual entries.
- Full-entry settle/unsettle toggle for udhaar.
- Home dashboard with income, expense, and open udhaar aggregates.
- Expenses filtered by month and one category.
- Stats with current-month income/expense, six-month bars, and top categories.
- Person list and person history derived from udhaar rows.
- In-app update check against `version.json`.
- Field-level encryption for person names, income sources, and notes.
- Android SMS receiver and NotificationListenerService with app/sender allowlists.
- Native disk queue for events captured while the JS app is not running.
- Strict-template parsing for a limited set of Pakistani SMS/notification formats.
- Faysal DigiBank QR notification parsing (verified by an audit probe in §11).

### B. Partially working features

- **CRUD:** Individual income/expense/udhaar records can be created, read, updated, and deleted, but there is no complete CRUD for people, categories, wallets, budgets, goals, recurring items, reminders, imported observations, or repayments.
- **Udhaar:** Only whole-entry settlement exists. There are no partial repayments, due dates, wallets, phone numbers, reminders, repayment history, or overpayment controls.
- **Auto-fetch:** It works for selected formats, but it writes directly to the ledger, has no review inbox, and cannot reliably distinguish all transfers/refunds/loans/statuses.
- **Statistics:** Only the current month and a fixed six-month view are available. There is no custom range, wallet/category analytics, cash-flow model, savings, or udhaar analytics.
- **Security:** Selected text fields are encrypted, but the database, amounts, dates, categories, native queue files, and pre-encryption backup are not fully protected. There is no PIN/biometric app lock.
- **Update flow:** The app can detect a newer `version.json`, but the APK is not verified against a published checksum/signature in-app.

### C. Broken or financially incorrect features

- Dashboard borrowed-money sign and balance definition.
- Expenses “Reset all” confirmation count/scope mismatch.
- Self-transfer cancellation based only on amount and date.
- Pending/failed payment notifications can be imported as completed expenses.
- Existing-install notification allowlist upgrades are not reliably synchronized (Faysal risk).
- Stats renders a small visible bar even for a month whose value is zero.

### D. Missing features required by v2

- Central ledger and balanced wallet postings
- Integer-paisa money type and safe decimal parser
- Wallets and explicit opening balances/reconciliation
- Send Money / Receive Money classification flows
- Transaction history screen with filters and detail view
- Import inbox with New / Needs Review / Imported / Ignored / Duplicates
- Source observations linked to ledger transactions
- People as entities
- Partial repayments and repayment reversals
- Categories as user-managed entities
- Budgets
- Savings goals
- Recurring transactions
- Reminders
- Search, sorting, filters, multi-select, bulk actions, and undo
- Backup/restore and CSV/PDF export
- PIN/biometric lock and privacy mode
- Dark/system theme
- Automated tests and CI
- Release QA checklist and checksum publication

---

## 4. Critical findings (P0)

### P0-1 — The dashboard balance is neither cash nor net worth

**Evidence:** `lib/db.ts`, `getDashboardSummary()`:

```text
balance = totalIncome - totalExpenses - openLent - openBorrowed
```

Borrowing money increases actual cash and creates a payable. The current formula subtracts it.

An in-memory SQLite simulation using the current schema/formula produced:

| Scenario | Current result | Correct cash | Correct net worth |
|---|---:|---:|---:|
| Opening/income Rs 10,000; expense Rs 2,000; lent Rs 3,000 | Rs 5,000 | Rs 5,000 | Rs 8,000 |
| Same, plus borrowed Rs 5,000 | **Rs 0** | **Rs 10,000** | **Rs 8,000** |

The formula also treats all historical income as if it were opening cash. There is no wallet or opening-balance concept.

**Impact:** The main balance cannot be trusted once borrowing is used. It also cannot be relabelled as net worth, because the borrowed case is wrong for that definition too.

**M2 correction:** Separate:

- Wallet balance
- Available cash
- Receivables
- Payables
- Net worth
- Monthly income
- Monthly expenses
- Monthly net cash flow

---

### P0-2 — Expenses “Reset all” can delete far more than the confirmation states

**Evidence:**

- `app/(tabs)/expenses.tsx` loads only the selected month and optional category.
- Its reset confirmation says it will delete `${expenses.length}` entries—the filtered count.
- It then calls `deleteAllExpenses()`.
- `lib/db.ts` implements that as:

```sql
DELETE FROM expenses
```

That deletes **all expenses from all months and categories**.

**Impact:** A user viewing three Food expenses for one month can be told they are deleting three entries while the action deletes their entire expense history.

**M2 correction:** Remove global reset actions from filtered views. Any bulk deletion must operate on explicit selected IDs, show the exact financial effect, execute atomically, and preferably create reversible/correcting records rather than silently erasing history.

---

### P0-3 — Self-transfer detection can delete a legitimate transaction

**Evidence:** `lib/db.ts` finds an opposite-direction auto record using only:

- `origin = 'auto'`
- exact amount
- exact date

`lib/autofetch/service.ts` then:

- Deletes the earlier income/expense.
- Skips the new transaction.
- Marks the new transaction’s dedup keys as seen.

It does not verify:

- Same user-owned wallets/accounts
- Institution relationship
- Reference
- Counterparty
- Time proximity
- Transaction purpose

**Counterexample:** A legitimate Rs 500 auto expense and an unrelated Rs 500 auto receipt on the same date can cancel each other. One real transaction is deleted and the other is never recorded.

This directly violates the rule that transactions must never be merged solely because they have the same amount.

**M2 correction:** Remove destructive amount-only pairing. Represent an own-account transfer only when evidence supports it; otherwise send both observations to the review queue. Never delete a posted ledger entry as a side effect of a heuristic.

---

### P0-4 — Failed and pending transactions can be imported as completed

The generic notification template accepts wording such as “sent to” without checking completion status.

Audit probes using the actual parser produced completed outgoing transactions for both synthetic status fixtures:

- `Rs 500.00 sent to Ahmed. Transaction is pending.` → parsed as an outgoing Rs 500 transaction
- `Rs 500.00 sent to Ahmed. Transaction failed.` → parsed as an outgoing Rs 500 transaction

**Impact:** Money that never left the wallet can be recorded as spent.

**M2 correction:** Every adapter must extract transaction status. Failed, cancelled, reversed, and pending events must not create completed postings. Pending events belong in the inbox with a non-posted state; reversals must link to the original transaction.

---

### P0-5 — Import insertion and dedup marking are not atomic

The import path performs these as separate operations:

1. Check dedup keys.
2. Insert an income or expense row.
3. Mark each dedup key as seen.

There is no SQLite transaction wrapping the full operation and no unique ledger constraint enforcing idempotency.

If the app/process stops after step 2 but before step 3, the same event can be inserted again on the next run.

**M2 correction:** Store the source observation, dedup identity, and ledger posting in one database transaction. Add database-level unique constraints for trustworthy external identities and idempotency keys.

---

### P0-6 — A transaction reference alone is treated as a global identity

When a parsed event has a TID/reference, the dedup key is only:

```text
tid:<reference>
```

It does not include:

- Institution
- Account/wallet
- Direction
- Amount
- Transaction type
- Date

Reference numbers are not globally unique across Pakistani banks and wallets. A legitimate transaction from another institution can be discarded because its numeric reference collides with an earlier one.

The reference extractor also accepts only numeric references. Alphanumeric references are ignored.

**M2 correction:** Use a scoped identity such as institution + account identity + normalized reference, with the raw reference preserved. References that are not trustworthy must be candidate signals, not absolute identities.

---

### P0-7 — The v1.1.3 Faysal allowlist fix may not reach already-enabled installs

The native listener reads a persisted SharedPreferences package set when one exists. The defaults are used only when no persisted set exists.

The JS allowlist is pushed to native storage when the user toggles auto-fetch settings. Ordinary app startup and `runAutofetch()` do **not** re-synchronize the current JS allowlist.

Therefore, an existing user who:

1. Enabled notification access before v1.1.3,
2. Already had a persisted package set without Faysal DigiBank, and
3. Installs v1.1.3 without toggling auto-fetch off/on,

can continue using the old native package set. The new Faysal package may never be listened to.

**Impact:** The headline v1.1.3 fix is not guaranteed for the exact existing-user case it was meant to solve.

**M2/M4 correction:** Add a versioned native-allowlist migration. On startup, reconcile the persisted set with the bundled supported set while preserving any future user-disabled source choices as separate preferences. Do not encode source enable/disable solely by deleting packages from the allowlist.

---

### P0-8 — No user-controlled backup/restore for a single-copy financial ledger

The app has:

- No backup export
- No restore
- No CSV/PDF export
- No recovery flow

The only backup-like artifact is an internal pre-encryption copy created during the field-encryption migration. It is not user-accessible, is not a supported restore format, and may be incomplete for a WAL database because only the main `.db` file is copied.

**Impact:** Device loss, uninstall, app-data clearing, or database corruption can permanently erase the user’s financial history.

**M2 prerequisite:** Before any v2 schema migration runs on a real device, M2 must create and verify a complete pre-migration backup and test restoration from it.

---

## 5. High-priority findings (P1)

### P1-1 — Money uses floating point throughout

**Evidence:**

- SQLite columns are `amount REAL` in income, expenses, and udhaar.
- TypeScript types use `number`.
- `parseAmount()` uses `Number()` and `Math.round(n * 100) / 100`.
- `formatRs()` rounds every displayed amount to whole rupees.

Audit probes of the actual `parseAmount()` showed:

| Input | Current result | Problem |
|---|---:|---|
| `1.005` | `1` | Incorrect rounding due binary floating-point behaviour |
| `0x10` | `16` | Hex notation accepted as money |
| `1e3` | `1000` | Scientific notation accepted |
| `1,2,3` | `123` | Malformed grouping accepted by stripping all commas |
| Very large integer string | Precision lost | Exceeds safe exact integer handling |

A standard float probe also confirms `0.1 + 0.2 = 0.30000000000000004`.

**M2 correction:** Store integer paisa in SQLite `INTEGER` columns and implement a strict string-to-minor-units parser. Reject hex, scientific notation, malformed grouping, excess precision, zero/negative values where inappropriate, and amounts outside a defined safe range.

---

### P1-2 — No versioned schema or real migration framework

`initDatabase()` uses `CREATE TABLE IF NOT EXISTS` plus one ad-hoc `ALTER TABLE` attempt for the `origin` column.

Missing:

- `PRAGMA user_version` or a schema-version table in active use
- Ordered migrations
- Migration transaction boundaries for schema evolution
- Foreign-key declarations
- `PRAGMA foreign_keys = ON`
- Database integrity checks
- Rollback/recovery procedure
- Migration fixtures from each released schema

The in-memory audit confirmed the current schema defaults to `user_version = 0` and foreign keys are not enforced by the app schema design.

**Impact:** Future schema changes can silently diverge between fresh and upgraded installs.

---

### P1-3 — Database constraints do not protect financial validity

The current schema and repository functions accept:

- Negative amounts at the DB layer
- Arbitrary date strings
- Duplicate income rows
- Invalid month/day strings

The audit simulation successfully inserted:

- An expense of `-500`
- An expense dated `2026-99-99`
- An income dated `not-a-date`
- Two identical income rows

The edit-screen date validator is also insufficient: it checks format and `Date` parseability, but JavaScript rolls invalid calendar dates such as 31 February into March instead of rejecting them.

**M2 correction:** Validate at the domain/repository boundary and add SQLite `CHECK` constraints for amount, classification, status, timestamps, and relationships. UI validation alone is not a financial integrity boundary.

---

### P1-4 — Direction is incorrectly treated as accounting classification

The auto-fetch inserter maps:

- Every incoming event → income
- Every outgoing event → expense

That is wrong for:

- ATM withdrawal (bank wallet → cash wallet transfer)
- Money borrowed (cash in + payable)
- Udhaar given (cash out + receivable)
- Udhaar repayment received (cash in + receivable reduction; not income)
- Udhaar repayment made (cash out + payable reduction; not an ordinary expense)
- Refund received (normally reverses/reduces an expense or creates a specific refund classification)
- Wallet transfer
- Fees (fee expense linked to a principal transaction)

Manual flows have the same structural limitation because there are no wallets or classifications beyond three separate tables.

---

### P1-5 — Udhaar has no partial repayment ledger

An udhaar row contains one amount and a boolean `settled` flag.

Missing:

- Repayment records
- Repayment amount/date/wallet
- Remaining balance per loan
- Overpayment prevention
- Repayment edit/reversal
- Due date
- Overdue state
- Person entity and contact details
- Loan status history

Toggling a borrowed entry to “settled” also creates the wrong dashboard movement: the current formula stops subtracting the borrowed amount, so the displayed balance rises. A real repayment made should reduce cash while reducing the payable.

The Home and Udhaar screens also define totals differently:

- Home sums gross open lent and gross open borrowed.
- Udhaar tab nets lent and borrowed per person before summing positive/negative nets.

Example: one person with Rs 3,000 lent and Rs 1,000 borrowed appears as gross Rs 3,000 / Rs 1,000 on Home-derived totals, but a net Rs 2,000 receivable on the Udhaar tab. Both views must state and use one accounting definition in v2.

---

### P1-6 — Imported observations are discarded; there is no review queue

The native queue stores events until the JS drain runs. During drain:

- Unparseable events are deleted.
- Events for a disabled channel are deleted.
- Corrupt queue files are deleted.
- Successfully parsed events are immediately posted.
- Ambiguous events are not retained for review.

There is no persistent import inbox, observation history, confidence score, error state, duplicate-candidate screen, or bulk review.

The SMS scan also advances its last-scan watermark to the current time after a scan. If processing individual messages fails or more than the scan limit is present, older unprocessed messages can be skipped permanently.

---

### P1-7 — Parser output is too small for safe financial import

`ParsedTransaction` contains only:

- Amount
- Direction
- Counterparty
- Bank label
- Channel
- Optional numeric TID
- Suggested category/income source
- Date milliseconds

It does not model:

- Institution/account identity
- Source wallet
- Transaction status
- Fee
- Reported balance (kept separate from amount)
- Currency
- Raw reference format
- Reversal/pending/failure state
- Confidence
- Parser/adapter version
- Original observation ID

The non-transaction filter rejects any body containing the word “loan”, which can suppress legitimate loan-related alerts rather than classifying them safely.

---

### P1-8 — Encryption is field-level and unauthenticated; a plaintext backup remains

Current protection:

- AES-256-CBC via CryptoJS
- Random IV per value
- Key generated with `expo-crypto` secure random bytes
- Key stored through Expo SecureStore
- Person names, income sources, and notes encrypted

Limitations:

- CBC provides confidentiality but no integrity/authentication tag. Tampering or corruption is not reliably detected.
- Amounts, dates, categories, directions, settled state, and table structure remain plaintext.
- The pre-encryption backup file is plaintext and is not deleted after successful migration.
- If the SecureStore key is lost while the DB survives, encrypted names/sources decrypt to empty/null values in UI paths; there is no key recovery flow.
- The native auto-fetch queue stores full SMS/notification bodies as plaintext JSON in app-private storage until drained.

The v1.0.5 lesson remains correctly implemented in one important respect: randomness uses `expo-crypto`, not CryptoJS `WordArray.random()`, and encryption setup fails open rather than bricking database opening.

---

### P1-9 — No app-level lock or privacy controls

Missing:

- PIN lock
- Biometric unlock
- Auto-lock
- Balance privacy mode
- Sensitive-screen protection
- Secure backup encryption
- Clear-data controls beyond destructive per-table resets

Anyone with access to the unlocked phone can open and alter the ledger.

---

### P1-10 — SMS permissions create a distribution-policy risk

The config plugin unconditionally adds:

- `READ_SMS`
- `RECEIVE_SMS`

The app requests both at runtime and can query the SMS inbox.

That may be workable for the current direct-APK distribution model, but it cannot be assumed acceptable for Google Play. Play’s SMS/Call Log policy is highly restricted. V2 must not promise Play distribution with automatic SMS reading unless eligibility and approval are separately established.

Compliant alternatives must remain first-class:

- Notification import
- Paste-a-message import
- Share-to-PocketHisaab
- Statement/document import
- Manual classification

---

## 6. The Rs 487 monthly-expense discrepancy

### 6.1 What the code proves

At the same database snapshot and with Expenses set to **All categories**, Home, Expenses, and Stats calculate monthly expenses from the same table and same local `YYYY-MM` prefix:

- Home: `SUM(amount) FROM expenses WHERE date LIKE '<current-month>%'`
- Expenses: all expense rows for the same prefix, summed in JS
- Stats: `SUM(amount) FROM expenses WHERE date LIKE '<current-month>%'`

Therefore, under identical filters and at the same instant, the totals cannot legitimately differ because of:

- A different expense SQL definition
- A different classification table
- A different month-prefix calculation
- Timezone conversion between the three screens

Floating-point display rounding also cannot explain a Rs 487 difference.

### 6.2 The proven stale-snapshot mechanism

The screens do not share a reactive financial store or ledger revision.

- Root layout initializes the DB, then starts `runAutofetch()` without awaiting its completion before the app becomes interactive.
- Home loads its dashboard when focused.
- Returning to the foreground triggers `runAutofetch()` again, but Home does not reload merely because auto-fetch finished; its focus state may never have changed.
- Expenses and Stats load when they receive focus.

A concrete sequence reproduces the reported pattern:

1. Home loads and displays Rs 19,736.
2. Auto-fetch or another ledger change adds expenses totalling Rs 487.
3. Home keeps its existing state because no focus change or pull-to-refresh occurs.
4. The user opens Expenses or Stats after the import.
5. Those screens load the newer DB state and display Rs 20,223.

The Rs 487 could be one record or several records totalling 487. The supplied repository assets do not identify the specific record(s).

### 6.3 Other possibility that must be checked on-device

If the Expenses screenshot had a category selected, its total would be a category subset and would not be comparable to Home/Stats. The prompt states that Expenses and Stats both showed Rs 20,223, which is consistent with “All” being selected, but the actual screenshot is not in the repository to verify the chip state.

### 6.4 Correct fix

Do not force the displayed numbers to match after the fact. M2 must:

1. Use one finance query service and one definition of monthly expenses.
2. Give every committed ledger change a monotonically increasing revision.
3. Publish an invalidation event after manual writes, imports, edits, reversals, and bulk operations.
4. Make every financial screen subscribe to that revision or use a shared query cache.
5. Await or clearly sequence the initial import before presenting the first dashboard snapshot, and refresh the visible screen when import completes.
6. Include the reporting window, wallet filter, category filter, ledger revision, and aggregation version in internal diagnostics so future mismatches can be traced.

**Conclusion:** The Rs 487 discrepancy is best classified as a **stale Home snapshot caused by non-shared, focus-only data loading and asynchronous auto-fetch**, not as three different expense formulas. Transaction-level confirmation requires the live DB or original screenshots with capture order.

---

## 7. Screen-by-screen audit

### 7.1 Home

Working:

- Balance hero
- Monthly spent tile
- They owe you / You owe tiles
- Total money-in tile
- Quick-add actions
- Auto-fetch status card
- Recent activity
- Update prompt

Problems:

- Balance definition is incorrect (P0-1).
- “Money in · total” is all-time while “Spent · this month” is monthly; the mixed periods are easy to misread.
- Recent activity merges three tables by date and independent numeric IDs. Within the same date, cross-table ordering is not a real timestamp order.
- Udhaar activity has no reliable origin marker and is always treated as manual in the activity model.
- No wallet overview, net worth, cash-flow definition, import inbox badge, budget status, or balance visibility toggle.
- No Send/Receive classification flows.

### 7.2 Expenses

Working:

- Month navigation (past months only)
- Category filter
- Individual edit/delete through long-press
- Filtered total and count

Problems:

- “Reset all” scope/count bug (P0-2).
- Long-press is the only visible edit/delete affordance, harming discoverability and accessibility.
- No search, sort choices, custom range, wallet filter, source filter, multi-select, bulk actions, undo, or export.
- Rows are rendered through `ScrollView`, not a virtualized list.
- The README says expenses are grouped by date; the current screen does not group them.

### 7.3 Income / Pocket Money

Working:

- All-income list
- Individual edit/delete
- Reset all with a count that matches the unfiltered list

Problems:

- No month filter, search, sort, source management, wallet, bulk actions, undo, or export.
- Edit screen loads and decrypts every income row just to find one ID; there is no `getIncomeById()` repository function.
- Income sources are a fixed string list, not categories/entities.

### 7.4 Udhaar and Person Detail

Working:

- People list with net receivable/payable per person
- Person history
- Individual create/edit/delete
- Whole-entry settle/unsettle

Problems:

- No partial repayments (P1-5).
- No person entity, phone, due date, reminder, wallet, status history, statement export, search, filter, sort, archive, or bulk actions.
- Person identity is an encrypted name string on each row. Case/whitespace variants can fragment one person; route handling also forces slash replacement in names.
- Person totals count settled entries, not settled amounts.
- `getPersonEntries()` and `getPersonTotals()` scan/decrypt far more data than necessary.

### 7.5 Stats

Working:

- Current-month money in/out
- Net income-minus-expenses
- Six-month paired bars
- Top five categories

Problems:

- No period selector or custom range.
- “Net” is only income minus expenses; it is not net cash flow once loans/transfers/adjustments exist.
- Zero-value months still draw a minimum-height bar, visually implying nonzero activity.
- No wallet balances, category drill-down, savings, udhaar overview, or six-month cash-flow trend based on a ledger.
- Fixed current-month prefix is captured in state; month rollover while the screen remains mounted is not handled through a shared clock/query key.

### 7.6 Add/Edit Forms

Working:

- Positive amount validation for normal decimal input
- Basic required-person validation
- Date editing on edit screens

Problems:

- Add screens always use today; there is no date/time picker.
- No wallet, counterparty, reference, purpose/classification, fee, or status fields.
- `parseAmount()` accepts malformed forms and loses precision (P1-1).
- Edit date validation accepts rolled-over invalid calendar dates.
- Future dates are accepted without warning.
- No client operation ID/idempotency protection against duplicate submission.
- Categories and income sources are fixed and cannot be managed.

### 7.7 Auto-fetch Settings

Working:

- Master, SMS, and notification toggles
- SMS permission status/request
- Notification-access status/settings shortcut
- Self-transfer toggle
- Basic privacy explanation

Problems:

- No last successful detection timestamp.
- No last error.
- No import status or review queue.
- No detailed supported-source list with per-source enablement.
- No import policy choice (review-first versus auto-confirm).
- The copy claims every transaction ID is remembered so nothing is added twice; that is stronger than the implementation guarantees.
- The SMS description implies broad support (“and more”) without per-format test evidence.
- The dangerous self-transfer behaviour is presented as a simple convenience toggle without warning that it can cancel unrelated same-amount transactions.

---

## 8. Auto-fetch and Android audit

### 8.1 What is actually implemented

#### Notification listener

- A real Android `NotificationListenerService` exists.
- It is protected by `BIND_NOTIFICATION_LISTENER_SERVICE`.
- It checks the app’s notification-channel toggle and package allowlist.
- It writes JSON queue files to internal app storage.
- It captures title, text, big text, package, and post time.

Notification package IDs currently bundled:

- NayaPay: `com.nayapay.app`
- SadaPay: `com.sadapay.app`, `pk.com.sadapay`
- Finja: `com.finja.consumer`, `com.finja.app`
- Faysal DigiBank: `com.avanza.ambitwizfbl`

The source comments identify the SadaPay/Finja IDs as candidates; only Faysal is explicitly marked verified in the current code. No device evidence in the repo proves the others.

#### SMS

- A manifest `BroadcastReceiver` handles `SMS_RECEIVED`.
- It checks channel state and a native sender pre-filter before queueing.
- The native module can query the SMS inbox with `READ_SMS`.
- JS sender rules exist for JazzCash, Easypaisa, Faysal, HBL, MCB, UBL, Meezan, Allied, Askari, Soneri, BankIslami, JS Bank, Bank of Punjab, National Bank, Silk, and Samba.

A sender rule is **not** proof of a working institution adapter. Most banks rely on generic debit/credit templates rather than institution-specific tested fixtures.

#### Important support distinction

- JazzCash and Easypaisa are SMS-rule sources; they are **not** in the notification package allowlist.
- HBL, UBL, Meezan, Allied, and most other listed banks are SMS-rule sources; their banking-app notifications are not currently listened to.
- Bank Alfalah has no explicit SMS sender rule in the current list.
- The v2 requirement to support adapters for JazzCash, Easypaisa, HBL, UBL, Meezan, Faysal, Allied, Bank Alfalah, and others is therefore only partially met.

### 8.2 Reliability problems

- Notification updates/reposts can queue repeated events; dedup is probabilistic for no-reference events.
- Queue files are deleted after drain attempts even when parsing fails or the channel is off.
- Queue writing is file-based but not fsync-verified; a partial file is treated as corrupt and removed.
- There is no queue size/age retention policy.
- No `onNotificationRemoved` or listener-disconnect reconciliation is implemented.
- SMS inbox scans are limited to 500 rows and then advance the watermark to now.
- Native allowlist changes are not version-synchronized on startup (P0-7).
- Battery optimisation and OEM background behaviour are not measured; no guaranteed-delivery claim is supportable.
- No parser fixture suite exists.

### 8.3 Privacy observations

Positive:

- The listener ignores non-allowlisted packages.
- The SMS receiver ignores senders outside the pre-filter.
- No accessibility service is used.
- No OTP is intentionally parsed as a transaction; OTP-like messages are rejected.

Concerns:

- Notification Access is inherently broad at the Android permission level even though the app filters packages in code.
- Full SMS/notification bodies are stored in the queue until the next drain.
- Inbox scanning returns full bodies to JS for allowlisted and non-allowlisted senders after the Android permission is granted; filtering occurs after the native query. The native receiver pre-filter does not apply to the inbox query path.
- Auto-fetch errors are logged generically, but there is no user-visible import error history.

---

## 9. Security and privacy audit

### Strengths

- No backend, account system, analytics, ads, or cloud sync.
- No hardcoded API keys, passwords, or tokens were found in the audited source/config.
- SQL statements use bound parameters rather than string-built user input.
- Update metadata is fetched over HTTPS and shape-validated.
- Encryption key randomness uses `expo-crypto`.
- Encryption migration failure does not brick the app.
- Native notification/SMS capture is off by default until app toggles are enabled.

### Gaps

| Area | Current state |
|---|---|
| App lock | Missing |
| Biometrics | Missing |
| PIN hashing/KDF | Missing because no PIN exists |
| DB encryption | Not whole-database; selected fields only |
| Cipher integrity | AES-CBC without authentication |
| Backup encryption | Missing |
| Backup/restore | Missing |
| Queue-file protection | Plaintext JSON in app-private storage |
| Pre-encryption backup | Plaintext and retained |
| APK integrity in update flow | No checksum/signature verification in app |
| Dependency audit | No completed audit evidence; `npm audit` was blocked in this environment (see §11) |
| Crash/error monitoring | None, consistent with no-tracking stance but releases are blind |
| Android backup behaviour | Not explicitly configured/verified in committed config |
| Release checksums | Not present in the audited release process/docs |

### Documentation drift

The security/product documents are stale:

- `docs/PRD.md` still describes version 1.0.3 and predates auto-fetch.
- It simultaneously reflects older statements about no encrypted database and newer field-encryption behaviour.
- `docs/SECURITY.md` is a v1.0.3 review and does not cover the SMS receiver, notification listener, native queue, or auto-fetch dedup risks introduced in v1.1.0.
- `docs/RELEASE-v1.1.0.md` overstates dedup certainty (“nothing is ever added twice”) and broad bank support.
- README says the app can be run through Expo Go, but the native auto-fetch module cannot work there.
- README claims expenses are grouped by date; the current Expenses screen does not group them.

V2 documentation must be regenerated from the implemented/tested support matrix, not from aspirational feature descriptions.

---

## 10. UI/UX, performance, and Android build audit

### UI/UX

Current personality is friendly and recognizably PocketHisaab: mint background, emerald/teal gradients, rounded cards, and emoji-led actions. It should be evolved, not discarded.

Gaps against the v2 design brief:

- Light mode only; `userInterfaceStyle` is fixed to `light`.
- No design-token architecture for light/dark/system themes.
- No custom font is bundled; the UI relies on system typography.
- Emoji are used as the main icon system rather than coherent vector icons.
- Several important actions are hidden behind long-press.
- No skeleton loading states, haptics, balance privacy mode, or reduced-motion support.
- Some tappable icon buttons are approximately 38px, below a comfortable 48px target.
- Pressables generally do not provide explicit accessibility roles/labels.
- No dedicated Transactions, Wallets, Settings, Budgets, Goals, or Import screens.
- The current logo is a generic wallet/ledger mark with a check badge. It is clean at large size, but it does not strongly encode the PocketHisaab “P/H” identity requested for v2.
- The same full icon image is used as the adaptive-icon foreground even though it already contains a rounded-square background; Android masks may crop it unexpectedly.
- No dedicated splash configuration is present in `app.json`.

### Performance

- Main lists use `ScrollView` with all rows rendered.
- Income list loads all history.
- Expenses load a full month into React state.
- Person functions scan and decrypt broad row sets.
- Dashboard performs six separate aggregate queries.
- Monthly stats perform twelve aggregate queries for six months.
- There are no measured benchmarks, profiling results, or device-performance tests in the repo.

These are acceptable for a tiny personal dataset but will degrade with years of imported transactions.

### Build/release

- Expo SDK 57, React Native 0.86.3, React 19.2.3, TypeScript strict mode.
- EAS `preview` creates an APK.
- EAS `production` profile is empty/default; release semantics are not formalized.
- No committed generated `android/` project; native behaviour is produced through the local module and config plugin at prebuild/EAS time.
- No CI, tagged-release workflow, checksum step, or release checklist.
- No Android version/device compatibility matrix is recorded.
- No evidence in the repo of a v1.1.3 upgrade test from every prior schema, a physical-device notification-listener rehearsal matrix, or reboot/battery tests.

---

## 11. Checks and probes actually run

### Passed

| Check | Result |
|---|---|
| Repository inventory | 51 remote/local files compared; only `package-lock.json` differs |
| TypeScript | `npm run typecheck` passed |
| Expo config resolution | Resolved as PocketHisaab 1.1.3, SDK 57, Android package `com.hussnain0702.pockethisaab`, versionCode 6 |
| Faysal QR parser fixture | Parsed Rs 76, outgoing, `HASSAN TUC SHOP`, reference `366002`, category `shopping` |
| JazzCash SMS fixture | Parsed Rs 30 incoming with TID `725981397486` |

### Failed / problem-confirming probes

| Probe | Result |
|---|---|
| Pending notification fixture | Incorrectly parsed as a completed outgoing transaction |
| Failed notification fixture | Incorrectly parsed as a completed outgoing transaction |
| Borrowed-money accounting simulation | Current balance Rs 0 where cash should be Rs 10,000 and net worth Rs 8,000 |
| Invalid DB values | Negative amount and invalid dates accepted by schema/DB functions |
| Duplicate DB rows | Identical income rows accepted; no ledger uniqueness constraint |
| `parseAmount('1.005')` | Returned `1`, not an exact safe monetary value |
| `parseAmount('0x10')` | Returned `16` |
| `parseAmount('1e3')` | Returned `1000` |
| Stats zero-month rendering logic | Minimum bar height causes a visible bar for zero |

### Not run / not established

| Item | Reason |
|---|---|
| Existing automated test suite | None exists in the repository |
| `npm audit` result | The npm audit endpoint was denied by this environment’s registry policy; no vulnerability conclusion is claimed |
| Android build in M1 | M1 is a read-only audit; no build was commissioned as audit evidence |
| Physical-device verification | No device DB or live banking notifications were accessed during M1 |
| Exact Rs 487 record identification | Original live screenshots/DB snapshot were not in the repository |

---

## 12. M2 plan — financial engine and safe migration

### Objective

Replace the three-table calculation model with a central, deterministic, integer-paisa ledger while preserving every legacy record and making all screens read the same committed snapshot.

### Proposed M2 work

1. **Start from the correct baseline**
   - Use GitHub `main` at `eb330bc1`.
   - Preserve the Dependabot lockfile update.
   - Create a separate v2 working branch/worktree; do not overwrite the only local working copy.

2. **Design the schema before coding UI**
   - `schema_migrations`
   - `wallets`
   - `people`
   - `categories`
   - `transactions` (business meaning, classification, status, timestamps)
   - `postings` (balanced wallet/receivable/payable effects)
   - `loans`
   - `repayments`
   - `import_observations`
   - `import_candidates`
   - `external_identities`
   - `meta` / settings
   - Use integer paisa, UTC event timestamps, local reporting dates, stable UUIDs, created/updated timestamps, and reversal links.

3. **Define legacy migration mapping**
   - Legacy income → a posted business transaction with an explicit legacy classification.
   - Legacy expense → a posted expense transaction.
   - Legacy udhaar → loan records with open/settled state preserved.
   - Do **not** invent a wallet split or opening balance for historical rows.
   - Introduce an explicit “Legacy / Unassigned wallet” only as a migration staging concept, then require user confirmation of actual wallet balances/opening balances before presenting v2 wallet totals as authoritative.
   - Preserve original IDs in migration mapping columns for traceability.
   - Keep a verified pre-migration backup and a rollback path.

4. **Build the central finance engine**
   - Pure classification/posting rules.
   - SQLite transaction wrappers with rollback.
   - One reporting query layer for Home, Transactions, Expenses, Stats, Wallets, and Udhaar.
   - Ledger revision/invalidation so all visible screens refresh after a committed change.
   - Reconciliation checks: postings balance, wallet balances recompute from postings, receivables/payables recompute from loan state.

5. **Add the M2 test gate before proceeding**
   - All financial examples in the master prompt.
   - Opening balance, expense, lend, borrow, partial repayment, transfer, refund, fee, edit, delete/reversal, bulk reversal.
   - Exact decimal parsing and paisa arithmetic.
   - Month boundaries and timezone behaviour.
   - Legacy migration row-count and total preservation.
   - Failed operation rollback.
   - Duplicate/idempotency constraints.

### M2 completion criteria

M2 must not be called complete until:

- A synthetic legacy database migrates with zero lost rows.
- Legacy totals reconcile under the documented mapping.
- The prompt’s six financial examples pass as automated tests.
- Home/Expenses/Stats use the same reporting service and revision.
- No production device database is migrated before a verified backup/restore rehearsal.

---

## 13. Final M1 assessment

**Working product value:** Real and worth preserving. The current app already solves manual pocket-money, expense, and simple udhaar tracking, and its on-device architecture is the right foundation.

**Production-grade financial readiness:** Not yet. The current model cannot safely support wallets, partial repayments, reliable import classification, or trustworthy net-worth/cash reporting without the M2 ledger rebuild.

**Safe next step:** M2 — schema/ledger design first, migration rehearsal second, implementation third, automated financial tests as the gate. No M5 visual work should be allowed to mask unresolved M2 accounting defects.
