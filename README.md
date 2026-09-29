# PocketHisaab

A personal expense + udhaar (lend/borrow) tracker for Android and iOS, built with Expo + React Native + TypeScript.

**Your data never leaves your phone.** PocketHisaab stores everything in a local SQLite database on the device. There is no backend, no account, no login, no network calls — it works fully offline, and each install starts with its own fresh, empty database.

## Features

- **Home dashboard** — total balance, this month's spending, money people owe you, money you owe, plus quick-add buttons and recent activity.
- **Udhaar ledger** — track who owes you and who you owe, per person, with full history and one-tap "settle".
- **Expenses** — log spending by category (food, transport, recharge, shopping, health, bills, other), filter by month and category, long-press to delete.
- **Pocket money** — record money received (allowance, gifts, refunds…) so your balance stays accurate.
- **Stats** — monthly money-in vs money-out, net savings, 6-month bar chart, top spending categories.

## Run it

```bash
npm install
npx expo start
```

Then scan the QR code with the [Expo Go](https://expo.dev/go) app, or press `a` for an Android emulator.

## Build an installable APK

```bash
npx expo prebuild
# then build with Android Studio, or use EAS Build:
npx eas build --platform android --profile preview
```

Release APKs are also attached to this repo's GitHub Releases for direct install.

## Privacy

All data is stored locally via `expo-sqlite` in `pockethisaab.db` on the device. Uninstalling the app deletes everything. No analytics, no tracking, no servers.
