# PocketHisaab v1.1.0 — Auto-fetch ⚡

Bank & wallet transactions now log themselves. No typing, no confirm taps.

## What's new
- **SMS auto-fetch** 💬 — transaction SMS from JazzCash, Easypaisa, HBL, MCB, UBL, Meezan, Allied, Faysal Bank and more are parsed on-device and logged automatically as income/expense.
- **Notification auto-fetch** 🔔 — SadaPay, NayaPay and Finja send push notifications instead of SMS; PocketHisaab can now read those too (extensible app list).
- **Smart & safe** — only messages matching known transaction formats are logged; unclear ones are skipped, never guessed. Every transaction ID is remembered so nothing is ever added twice.
- **⚡ tag** — auto-added entries carry a lightning tag and stay fully editable/deletable.
- **100% on-device** — parsing happens on your phone. No message ever leaves the device.
- **History import** — enabling SMS reading imports the last 7 days of transaction SMS.

## Setup
Open the app → tap the **⚡ Auto-fetch** card on Home → grant SMS permission and/or notification access. That's it.

## Notes
- Auto-fetch needs the installed APK (it can't run inside Expo Go previews).
- First launch after update migrates your database (adds the auto-fetch tag column) — existing data is untouched.
