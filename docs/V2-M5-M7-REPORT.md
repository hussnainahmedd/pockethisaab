# PocketHisaab v2 — M5–M7 Completion & Release Report

**Date:** 2026-10-24 · **Release:** v2.0.0 (versionCode 7)
**Source commit:** `de5c514eea170ecb91234a6ce21bb184630c9df3` (GitHub main, tree verified 100/100 files)

## M5 — Gen Z redesign & branding (Phase 2)

- Research first (`docs/V2-M5-DESIGN.md`): Pakistani wallets
  (SadaPay restraint, NayaPay social density, JazzCash/Easypaisa
  super-app breadth) + 2026 fintech UX consensus, recorded as
  adopt / adapt / reject with rationale. Social/chat features and
  super-app density were rejected (offline-first privacy product);
  SadaPay-style restraint was adapted, not copied.
- "Pocket Pop" design system in `components/theme.ts`: warm paper
  surfaces, deep green ink, emerald brand, gold coin accent; tokenized
  radii; tabular numerals everywhere money appears. Shared components
  refreshed (`components/ui.tsx`): deep-ink hero with gold coin motif,
  sticker chips, warm inputs. Floating deep-ink tab dock with gold
  active state replaces the flat tab bar.
- **Final branding is the owner's own provided assets** (2026-10-24):
  his animated-SVG PocketHisaab logo rendered to the app icon +
  adaptive icon, and his neon wallet artwork as a continuously
  floating badge on Home (`components/FloatingLogo.tsx`,
  native-driver animation, artwork byte-identical to the file he
  provided; gold ring + emerald glow as theme grading).

## M6 — Security, backups, privacy (Phases 13–14)

- **Encrypted backups** (`lib/finance/backup.ts` +
  `LedgerRepository.exportBackupData/importBackupData`): complete
  ledger export; protected fields decrypted only inside the payload,
  which is sealed with PBKDF2-HMAC-SHA256 (100k iterations) +
  AES-256-CBC under a user passphrase; salt/IV from the injected
  native RNG (expo-crypto — never `WordArray.random()`). Restore
  re-encrypts with the restoring device's key (device-portable),
  is refused into a non-empty ledger, and must pass
  `verifyIntegrity()` inside the same transaction or nothing is kept.
- **App lock:** 4-digit PIN (salted SHA-256, stored only in
  expo-secure-store), optional biometric unlock
  (expo-local-authentication), lock gate on cold start and on every
  return from background (`components/LockGate.tsx`, `lib/lock.ts`).
- **Security & Backup screen** (`app/security.tsx`): PIN setup /
  change / disable, biometric toggle, backup export via share sheet,
  restore via document picker, and a plain-language privacy note.
- A real bug was caught by tests during M6: CryptoJS throws
  "Malformed UTF-8" on wrong passphrases — now normalized to a clear
  "Wrong passphrase, or the backup file is damaged" error.

## Owner fresh-start directive (2026-10-24 ~04:02 PKT)

"Make a total new, no previous records": v2.0.0 carries over **no**
v1 records. The v2 ledger is a separate database starting at zero,
and `purgeLegacyRecordsOnce()` (lib/legacyDb.ts) wipes the v1
income/expenses/udhaar tables on first v2 launch — fail-safe and
marker-gated; auto-fetch settings and the dedup seen-store are kept
(they are preferences, not records).

## M7 — Verification (all executed 2026-10-24, none assumed)

| Gate | Result |
|---|---|
| Finance test suite (`npm run test:finance`) | **95/95 pass** (ledger, CRUD, udhaar, import dedup, parser fixtures, backup round-trip, PIN) |
| TypeScript (`npm run typecheck`) | Clean |
| Expo config (`npx expo config --type public`) | OK |
| GitHub source tree vs local working copy | 100/100 files, exact match |
| npm audit | Endpoint errored in this environment (same limitation recorded in M1) — no vulnerability conclusion claimed either way |

Not device-verified (no device run in this environment): the Kotlin
allowlist note from M4 is comment-only (functional fix is JS-side);
first-launch purge, lock gate, and backup share/restore flows are
code-reviewed and covered at the logic level by the node suite, and
should be smoke-tested on the owner's phone after install.

## Release pipeline

- `eas.json`: profiles `preview` (APK), `production-apk` (APK for
  GitHub distribution), `production` (AAB for future Play use);
  `appVersionSource: local`.
- `.github/workflows/ci.yml`: tests + typecheck + config on push/PR.
- `.github/workflows/release.yml`: manual, gated (type `PUBLISH`,
  version must match app.json, duplicates refused, signing
  certificate verified against the v1.1.3 fingerprint, version.json
  flipped only after the Release exists). See
  `docs/RELEASE-PIPELINE.md`.
- The v2.0.0 release itself was executed agent-side through the same
  gates on the owner's explicit instruction (approval gate waived
  2026-10-24 ~03:49 PKT); build, certificate and checksum evidence
  is recorded in the GitHub Release notes.
