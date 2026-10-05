# PocketHisaab — Product Requirements Document

**App:** PocketHisaab · **Repo:** [github.com/hussnainahmedd/pockethisaab](https://github.com/hussnainahmedd/pockethisaab) (public)
**Current version:** 1.0.3 · **Distributed as:** Android APK via GitHub Releases
**Status:** Live — user uses it daily for real personal finances
**Stack:** React Native + Expo (SDK 57), Expo Router, TypeScript, expo-sqlite
**Last verified against source:** 2026-10-05 (local working copy `~/workspace/projects/pockethisaab`, v1.0.3)

> This PRD describes the app **as it exists today**. It proposes no redesigns and no new features.

---

## 1. Purpose

A personal pocket-money manager for a student: track money received (pocket money/allowance), money spent (expenses by category), and informal loans (udhaar — who owes you, who you owe) — in one app, with a live balance. Built for daily, on-the-go use.

## 2. Users

| User | Notes |
|---|---|
| **Primary: Hussnain (owner)** | Daily active user, tracks real personal finances. Wants speed and simplicity — add an entry in seconds. |
| Anyone else who installs the APK | Single-user design: each install is its own private world. No accounts, no sharing, no onboarding. |

There is exactly one user per install. The app has no login, no roles, no permissions model.

## 3. Current feature list (verified in source)

### 3.1 Home dashboard (`app/(tabs)/index.tsx`)

- Balance hero card: `balance = totalIncome − totalExpenses − open lent − open borrowed` (computed in `getDashboardSummary`, `lib/db.ts`)
- Month stats: this month's income and expenses (local-time `YYYY-MM` prefix matching)
- Quick-add buttons (jump to add-income / add-expense / add-udhaar screens)
- Recent activity feed: last 8 entries merged across income, expenses, and udhaar, newest first
- In-app update check: on launch, fetches `version.json` from `raw.githubusercontent.com`; if a newer version exists, shows a one-time prompt per version ("don't nag" state stored in the `meta` table) with a link to the release APK. Fails silently offline.

### 3.2 Udhaar ledger (`app/(tabs)/udhaar.tsx`, `app/person/[name].tsx`)

- Add udhaar entry: person name, amount, direction (**lent** = they owe me / **borrowed** = I owe them), optional note, date (`add-udhaar.tsx`)
- People list: per person — total open lent, total open borrowed, net (`lent − borrowed`), open entry count; sorted alphabetically (case-insensitive)
- Person detail page: full entry history (including settled entries), open lent/borrowed totals, count of settled entries
- One-tap settle / unsettle toggle per entry (`setUdhaarSettled`)
- Edit entry (`edit-udhaar.tsx`) and delete entry (with confirmation)
- Only **open** (unsettled) entries count toward ledger totals and the home balance
- Person names: leading/trailing whitespace trimmed, `/` replaced with space (slashes would break the `/person/[name]` route)

### 3.3 Expense tracker (`app/(tabs)/expenses.tsx`)

- Add expense: amount, category, optional note, date (`add-expense.tsx`)
- 7 fixed categories: Food 🍔, Transport 🚌, Recharge 📱, Shopping 🛍️, Health 💊, Bills 🧾, Other 📦 (defined in `lib/db.ts`)
- Filter by month and by category; entries grouped by date
- Edit expense (`edit-expense.tsx`) and delete expense (with confirmation)

### 3.4 Pocket money / income (`app/income-list.tsx`)

- Add income: source, amount, optional note, date (`add-income.tsx`)
- 5 fixed sources: Pocket Money, Gift, Refund, Work, Other (`INCOME_SOURCES` in `lib/db.ts`)
- Income list, newest first; edit (`edit-income.tsx`) and delete (with confirmation)

### 3.5 Stats (`app/(tabs)/stats.tsx`)

- Money in vs money out, net savings for the selected view
- 6-month bar chart (income vs expenses per month)
- Top 5 expense categories for the current month

### 3.6 Data layer (`lib/db.ts`)

- On-device SQLite via `expo-sqlite`, file `pockethisaab.db`, `WAL` journal mode
- Tables: `income`, `expenses`, `udhaar`, `meta` (key/value for app state); indexes on `expenses(date)`, `income(date)`, `udhaar(person)`, `udhaar(date)`
- All queries parameterized (`?` placeholders) — no string-concatenated SQL
- All database logic lives in `lib/db.ts`; screens only call these functions (no SQL in UI)
- Dates stored as `YYYY-MM-DD` text

### 3.7 Platform & packaging

- Android APK built with EAS (`eas.json`, `preview` profile → APK); package `com.hussnain0702.pockethisaab`
- Distributed via GitHub Releases with attached APK (current release: v1.0.3, per `version.json`)
- Portrait orientation, light UI, deep-link scheme `pockethisaab://`

## 4. Non-goals (explicitly out of scope)

- No cloud sync, no backup service, no multi-device access
- No accounts, login, or multi-user support
- No analytics, tracking, ads, or crash reporting
- No push notifications or reminders
- No iOS distribution (codebase is cross-platform; only Android APK is released)
- No data export/import
- No encrypted database (plain SQLite today)
- No recurring/scheduled entries, no search, no budgets

## 5. Success criteria

- [ ] Installs from the release APK and opens with zero configuration
- [ ] Works fully offline — every feature except the update check needs no network
- [ ] CRUD works on all three ledgers (income, expenses, udhaar); entries persist across app restarts
- [ ] Home balance matches the formula in §3.1 against the stored data
- [ ] Settle/unsettle correctly includes/excludes udhaar from totals
- [ ] Update prompt appears once per new release when online, never when offline or up to date

## 6. Known limitations

1. **Single device, no backup.** Uninstalling the app or losing the phone deletes all data permanently. There is no export feature.
2. **Database is not encrypted.** `pockethisaab.db` is plain SQLite; protection relies on the Android app sandbox + the device's own lock screen.
3. **No search.** Finding an old entry means scrolling; people list is alphabetical only.
4. **No recurring entries.** Repeating monthly pocket money must be re-entered each time.
5. **Balance formula quirk (as-built behavior).** Open *borrowed* amounts are subtracted from the balance (treated as owed), not added — document rather than assume intent.
6. **Update check is the only network call.** The app is marketed as "100% offline"; strictly, the home screen makes one outbound HTTPS GET to `raw.githubusercontent.com` for the version check (sends no user data, fails silently). See SECURITY.md.
7. **No access control inside the app.** Anyone holding the unlocked phone can open the app and read/edit everything — there is no PIN/biometric gate in the app itself.
