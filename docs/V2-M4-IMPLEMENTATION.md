# PocketHisaab v2 — M4 Implementation Report

## Android Notification Import, Parsing, and Deduplication (Import Inbox)

**Date:** 2026-10-24
**Milestone:** M4 of the PocketHisaab v2 master development prompt (Phase 3)
**Baseline:** M3 (63 tests passing)
**Status:** Complete. 87/87 automated tests pass, full-app typecheck is clean, and nothing was pushed. No device data was touched.

---

## 1. Objective

Replace v1's "parse → instantly post → hope dedup works" pipeline with a review-first import system: every detected transaction lands in an **Import Inbox** where layered deduplication classifies it as New, Needs Review, or Duplicate; pending/failed bank transactions can never be posted as completed; own-account movements are paired as transfers instead of being destructively deleted; and the Faysal allowlist sync defect (M1 finding P0-7) is fixed at its root.

---

## 2. The import engine (`lib/finance/repository.ts`, new M4 section)

`import_observations` grew from M2's minimal dedup table into the full inbox record: parsed amount (integer paisa), direction, encrypted counterparty, reference, local date, **suggested classification/wallet/category**, a 0–100 **confidence score**, `parse_status` (completed/pending/failed), a human-readable **reason**, and links to the posted transaction and to candidate duplicates/transfer pairs. A short (≤140 char) encrypted excerpt is kept for inbox context; full message bodies are never stored. All columns are added idempotently at init for pre-release dev databases, following the M3 pattern.

### `ingestParsedEvent` — layered deduplication
1. **Source fingerprint** — institution + reference + amount + direction + minute + counterparty. The same event delivered twice (receiver + inbox scan) collapses to one observation; re-delivery returns the existing row.
2. **Scoped bank reference** — identity scope is `institution:account` (e.g. `faysal:acct8588`, fixing P0-6's global TID keys). A reference already in the ledger files the new event as **Duplicate** immediately. The same reference at a different institution/account remains a separate legitimate transaction (tested).
3. **Pending/failed gate** — non-completed parses go straight to Needs Review with an explicit reason.
4. **Candidate matching** — posted transactions with the same amount within ±15 minutes are compared post-decryption; a counterparty match (exact or containment, ≥3 chars) — or extreme time proximity (≤2 min) with no counterparty — flags **Needs Review** with a link to the similar entry. **Amount alone never merges anything** (tested: two same-amount events with different references/counterparties both import cleanly; an unrelated same-amount entry 5 hours later is not flagged).
5. **Transfer pairing** — a completed event whose opposite-direction twin exists at a *different* institution within ±30 minutes flags **both** items as a possible own-account transfer. Same-institution and out-of-window events are never paired (tested).

Suggestions are computed at ingest: institution → wallet (JazzCash→JazzCash, Easypaisa→Easypaisa, everything else→Bank Account), parser category key → v2 category (Food/Transport/…/Fees), income source → category + classification (Refund → `refund_received`). Confidence: base 40, +30 bank reference, +15 counterparty, +15 known-wallet institution (else +5).

### Inbox actions (all ledger writes remain single-transaction and append-only)
- `confirmObservation` — posts with overrides (wallet/category/classification/amount/date/counterparty/note) and the scoped external identity, then links the observation. Confirming an already-imported/ignored/duplicate item throws a specific error; **pending/failed items refuse confirmation** with the bank status in the message.
- `confirmObservationAsTransfer` — posts ONE `transfer` transaction (correct wallets resolved from both sides' suggestions or explicit overrides), marks the confirming item Imported and its pair Duplicate-of-that-transfer. Income/expense statistics are untouched (tested).
- `ignoreObservation`, `markObservationDuplicate` — guarded state transitions.
- `bulkConfirmObservations` — per-item independent, returns confirmed IDs and per-item failure reasons (a pending item in the batch fails loudly, the rest succeed — tested). `bulkIgnoreObservations` — one guarded UPDATE that never touches imported items.
- `countObservationsByStatus` / `listObservations` power the inbox tabs.

Auto-confirm eligibility is a pure, tested predicate (`LedgerRepository.autoConfirmEligible`): status New + completed + bank reference + confidence ≥ 80 + no candidates.

---

## 3. Parser hardening (`lib/autofetch/parser.ts`)

- Every parse now carries a **`status`** (`completed` / `pending` / `failed`) from conservative keyword detection (`detectStatus`): failure wording ("failed", "unsuccessful", "declined", "rejected", "not successful") wins over pending wording ("pending", "processing", "in progress"). Ordinary success wording stays `completed` (tested so the existing "successful" templates don't false-positive).
- **`accountHint`** extraction (conservative: `A/C *8588` / `from *8588` → `acct8588`) feeds the scoped dedup identity.
- **Parser fixture suite** (sanitized formats): Faysal QR notification (Rs 76, HASSAN TUC SHOP, Ref 366002, `acct8588`, shopping), JazzCash received/paid templates, failed payment parse, pending transfer parse, OTP/balance/promo rejection, generic notification spend.

## 4. Service rewrite (`lib/autofetch/service.ts`)

- The ingestion path no longer posts anything directly. Queue drain and inbox scan parse events and hand them to `ingestParsedEvent`; the run reports `{ added, review }` (auto-posted count / items waiting).
- **The destructive v1 self-transfer pairing is removed from the service** (it deleted opposite-direction entries by amount+date — P0-3). Own-account movements are now paired as transfers in the inbox, where the user confirms them.
- The v1 seen-key dedup store is retired from the ingestion path (fingerprints + scoped identities replace it); the legacy meta table remains only for settings and the SMS scan watermark.
- **Auto-confirm** runs only when the user opted in (`af_autoconfirm`) AND the item is auto-confirm eligible; a failed auto-confirm attempt falls back to the review count, never to silence.

## 5. P0-7 fix — allowlist resync

Root cause (confirmed in code): the native listener reads its package list from SharedPreferences, which was only written when the user toggled auto-fetch on. An install that enabled auto-fetch before Faysal DigiBank was added kept the old persisted list forever, even though both codebases' defaults included Faysal.

Fix: `syncAllowlists()` in the service pushes the current JS package/sender lists to native — and `runAutofetch()` now calls it **on every run**, before the enabled check. The native side already replaces (never merges) its persisted set and reads it fresh per event, so every launch/foreground heals stale installs deterministically. The Kotlin `AutofetchPrefs` header now documents that JS lists are authoritative and resynced per run, so this contract survives future edits.

## 6. UI

- **`app/import-inbox.tsx`** — five tabs with live counts (New / Needs Review / Imported / Ignored / Duplicates). Each card shows institution, direction, amount, date, reference, suggested wallet, confidence %, a PENDING/FAILED banner, the review reason, and the excerpt. Actions: Confirm, **Edit & confirm** (amount, wallet, classification, category), **Confirm as ONE wallet transfer** (when paired), view the similar ledger entry (when a duplicate candidate exists), Ignore, Mark duplicate. Multi-select mode offers bulk Confirm all / Ignore all with honest per-item failure reporting.
- **Auto-fetch settings** — the obsolete "Skip my own transfers" toggle is replaced by an **Import inbox** card (live New/Review counts + open button) and an **Import policy** card with the auto-confirm opt-in and its exact conditions spelled out. Safety copy updated to describe layered dedup and the pending/failed rule.
- **Transactions screen** links to the inbox; the route is registered in the root stack.

## 7. Tests and evidence

`npm run test:finance` — **87 tests, 87 passed, 0 failed** (63 prior + 16 import-engine + 8 parser fixtures). `npm run typecheck` — clean.

Import-engine coverage: suggestion correctness (JazzCash wallet, Food category, confidence 100), fingerprint collapse, low-confidence ineligibility (45%), Faysal scoping (`faysal:acct8588`, Bank Account suggestion, 90%), confirm-posts-once + same-scope duplicate + different-institution legitimacy, refund override (never counted as income), pending/failed review + confirm refusal + zero dashboard effect, amount-alone non-merge, cross-source candidate flagging + user resolution, 5-hour non-flagging, transfer pairing end-to-end (one transfer, correct wallet deltas, zero income/expense, pair marked duplicate of the transfer), pairing negatives (same institution, out-of-window), bulk confirm failure honesty, bulk ignore guard, status counts.

## 8. Limitations (explicit)

1. **No Android build or device run in M4** (M7 gate, as with M2/M3). The Kotlin change is a comment documenting the existing replace semantics; the functional fix is entirely in the JS service, which runs on every `runAutofetch()`.
2. **Statement/CSV file import and share/paste intake** are inbox *sources* in the schema (`statement`, `share`, `paste`) but their intake UIs are not built in M4 — the inbox today is fed by SMS + notifications. (Master prompt Phase 3.3 lists these as later intake methods.)
3. **Cross-source reference dedup across different institution ids** (e.g. Faysal SMS scope `fbl:` vs Faysal app scope `faysal:`) intentionally does not hard-merge: those copies meet at Layer 4 candidate review instead, where the user resolves them. Same-scope references hard-deduplicate.
4. **Transfer pairing suggests; it never auto-pairs.** Even with auto-confirm on, paired items wait for the user's "Confirm as transfer" tap — by design.
5. The inbox list is capped at 200 items per tab per load (personal-scale volumes); pagination can be added if real usage ever approaches it.
6. Parser status detection is keyword-based; an unusual bank wording for failure could parse as completed — the review-first default (auto-confirm off unless opted in, and reference+candidate gates when on) bounds the blast radius, and such items still land in the inbox rather than posting silently when auto-confirm is off.

## 9. Next milestone

**M5 — Gen Z redesign and original branding:** research current Pakistani Gen Z fintech patterns first (per the master prompt), then redesign Home/Udhaar/Expenses/Statistics/Add flows + the new M3/M4 screens in one coherent system, with a new original logo and app icon (no copied assets). M5 should not start until the owner approves this report.
