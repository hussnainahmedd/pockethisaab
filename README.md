<div align="center">

# 💰 PocketHisaab

**Your pocket money, udhaar & expenses — all in one place.**

[![Expo](https://img.shields.io/badge/Expo-000020?style=for-the-badge&logo=expo&logoColor=white)](https://expo.dev)
[![React Native](https://img.shields.io/badge/React_Native-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://reactnative.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![SQLite](https://img.shields.io/badge/SQLite-07405E?style=for-the-badge&logo=sqlite&logoColor=white)](https://www.sqlite.org)

*100% offline. 100% private. Your data never leaves your phone.*

[📥 Download APK](../../releases) · [🐛 Report a bug](../../issues)

</div>

---

## 📱 Screenshots

<div align="center">
  <img src="screenshots/screen-home.webp" width="250" alt="Home dashboard" />
  <img src="screenshots/screen-udhaar.webp" width="250" alt="Udhaar ledger" />
  <img src="screenshots/screen-expenses.webp" width="250" alt="Expenses" />
</div>

---

## ✨ Features

| | |
|---|---|
| 🏠 **Home Dashboard** | Total balance hero card, month stats, quick-add buttons, recent activity |
| 🤝 **Udhaar Ledger** | Track who owes you & who you owe — per-person history, one-tap settle |
| 🧾 **Expense Tracker** | Log spending by category, filter by month, group by date |
| 💵 **Pocket Money** | Record money received (allowance etc.) so your balance stays real |
| 📊 **Stats** | Money in vs out, net savings, 6-month bar chart, top categories |

## 🔒 Privacy by design

PocketHisaab has **no backend, no login, no tracking**. Everything is stored in a
local SQLite database on your device (`pockethisaab.db`). Install it on ten
phones and each one gets its own fresh, private database — nobody can ever see
anyone else's data. It works fully offline.

## 🚀 Run it yourself

```bash
git clone https://github.com/hussnainahmedd/pockethisaab.git
cd pockethisaab
npm install
npx expo start
```

Then scan the QR code with the **Expo Go** app, or press `a` for an Android
emulator.

## 📦 Build the APK

```bash
npx eas-cli@latest login
npx eas-cli@latest build -p android --profile preview
```

Or grab the ready-made APK from the [Releases](../../releases) page and install
it directly on your phone.

## 🛠️ Tech stack

- **Expo** + **React Native** + **Expo Router** — one codebase, Android & iOS
- **TypeScript** — type-safe throughout
- **expo-sqlite** — local on-device database
- Zero backend. Zero cost. Zero tracking.

---

<div align="center">

Made with ❤️ by [Hussnain Ahmad](https://github.com/hussnainahmedd)

</div>
