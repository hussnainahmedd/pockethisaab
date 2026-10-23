## PocketHisaab v2.0.0 — the big one 🚀

PocketHisaab has been rebuilt from the inside: a real accounting engine under the app, a proper review inbox for auto-detected transactions, full control over every record, bank-grade backup & lock, and a fresh new look with an original logo.

### New features
- Import Inbox for auto-fetch: every detected bank/wallet transaction now lands in an inbox first — confirm, edit, ignore, or mark duplicate. Nothing posts silently.
- Smart duplicate protection: layered checks (source fingerprint, bank reference, similarity) catch the same transaction reported twice — by SMS and notification — without ever merging two different payments just because the amounts match.
- Transfer pairing: moving money between your own accounts (Easypaisa → JazzCash) is now recognized and recorded as ONE transfer, not fake income + expense.
- Wallets: separate Cash, JazzCash, Easypaisa and bank wallets with opening balances, transfers between them, and reconciliation against your real balance.
- Full control: every transaction, wallet, person and category can be added, edited, archived or deleted — including multi-select bulk actions with undo.
- Advanced udhaar: multiple loans per person tracked separately, partial repayments, repayment editing, overdue tracking, reminders, and shareable person statements (text or CSV).
- Send / Receive screens that classify by purpose (expense, udhaar, repayment, transfer, fee, refund).
- App lock: 4-digit PIN with optional fingerprint/face unlock.
- Encrypted backups: export your complete hisaab as one passphrase-encrypted file and restore it on any device — the restore verifies the ledger's integrity before keeping it.
- Fresh design: new "Pocket Pop" look — warm paper surfaces, deep-green ink, gold coin accents, a floating tab dock, and a brand-new original Pocket Coin logo.

### Improvements
- Money is now tracked in exact paisa with a balanced double-entry ledger — dashboard, expenses and statistics always agree because they read the same engine.
- Pending or failed bank transactions are never posted as completed anymore.
- Auto-fetch allowlists now resync automatically, so new bank apps (like Faysal DigiBank) reach existing installs.
- Search, filters and sorting across your full transaction history.

### Bug fixes
- Fixed the balance formula that made borrowed money reduce your balance.
- Fixed Expenses "Reset all" deleting records outside the filtered view.
- Fixed self-transfer handling deleting unrelated same-amount entries.
- Fixed reversal bookkeeping links found by the new test suite.

### Verification
- 95 automated tests pass (accounting, CRUD, udhaar, import dedup, parser fixtures, backup round-trip).
- TypeScript and Expo configuration checks pass.
- Signed with the same certificate as previous releases — installs as an update and keeps your data.
