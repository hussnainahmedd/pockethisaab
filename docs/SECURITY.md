# PocketHisaab — Security Review

**App:** PocketHisaab v1.0.3 (React Native + Expo, Android APK via GitHub Releases)
**Scope:** Local working copy `~/workspace/projects/pockethisaab`, verified 2026-10-05. **Read-only review — no code was changed.**
**Framework:** The user's "Vibe Coding: A Complete Beginner-to-Production Guide" security checklist, applied item-by-item below.

> **Explicit note:** the Vibe Coding guide contains **no mobile security guidance** — its checklist is written for web apps with servers, databases, and auth. Each item below is therefore marked OK / GAP / N-A and **mobile-adapted** where the guide's web framing doesn't fit, instead of blanket-marking everything N-A.

---

## 1. Threat model (plain terms)

PocketHisaab is an offline, single-user app with **no backend, no accounts, no analytics, and no server**. That shrinks the attack surface dramatically — there is no database to breach remotely, no API to abuse, no session to hijack. The real risks are:

| # | Threat | How bad |
|---|---|---|
| 1 | **Lost/stolen phone** | Medium. Person names, income sources and notes are AES-256 encrypted (key in Android Keystore); amounts/dates stay numeric so offline totals work. No lock-screen enforcement in the app per user choice (2026-10-05). |
| 2 | **Malware / rooted device** | High. App-private storage is only private until the OS boundary is broken; then `pockethisaab.db` is readable. |
| 3 | **Malicious APK substitution** | Medium. APKs are sideloaded from GitHub Releases; a lookalike APK from elsewhere could carry malware. |
| 4 | **Secrets baked into the bundle** | None found (verified by grep, §3) — nothing to steal from the APK. |
| 5 | **Dependency CVEs** | Low–Medium. 11 prod deps (Expo 57 stack); no audit process today, so a vulnerable transitive dep could ship silently. |
| 6 | **Network interception** | Very low. One outbound HTTPS GET (update check) sends **no user data**; no transport risk for financial data because it never leaves the device. |
| 7 | **Accidental data loss** | High (availability, not attack). No backup/export: uninstall, "clear data", or device loss = total, unrecoverable loss. |

## 2. The guide's checklist, item by item (mobile-adapted)

### AI rules

| Rule | Verdict | Evidence |
|---|---|---|
| Never expose API keys | **OK** | `grep -riE "api[_-]?key\|secret\|token\|password\|bearer"` over `app/`, `components/`, `lib/`, `app.json`, `eas.json` → zero hits. The EAS `projectId` in `app.json` is a public identifier, not a secret. |
| Validate user input | **OK** | Amounts go through `parseAmount` + `> 0` check with an error message before saving (e.g. `app/add-expense.tsx`). All SQL uses `?` placeholders (`lib/db.ts`) — no injection path. Person names are trimmed and `/` is flattened so they can't break routing. |
| Verify authorization server-side | **N-A** | No server, no auth, single local user. Nothing to verify. |

### Gates (lint → typecheck → unit → integration → E2E)

| Gate | Verdict | Evidence |
|---|---|---|
| lint | **GAP** | No linter configured (no ESLint config in repo). |
| typecheck | **OK** | `npm run typecheck` (`tsc --noEmit`) exists and the codebase is fully typed. |
| unit / integration / E2E | **GAP** | No test suite, no test runner in `package.json`. Releases ship on manual testing. |

### Pre-deploy checklist

| Item | Verdict | Evidence |
|---|---|---|
| No secrets in git | **OK** | Verified by source grep (§AI rules). No `.env` needed — the app has nothing secret to store. |
| Authentication verified | **N-A** | No login exists by design. |
| Authorization verified | **N-A** | Single-user local DB; no cross-user path exists (README's privacy model: each install = fresh private DB). |
| Database security configured | **OK** | Field-level AES-256-CBC (random IV) for person/source/note columns; key in expo-secure-store; one-time transactional migration with file backup |
| Input validation | **OK** | See AI rules above. |
| API validation | **OK** (adapted) | The single outbound call (`lib/update.ts`) validates the remote `version.json` shape strictly (`isValidRemoteVersion`) before use; malformed/offline responses are discarded silently. No user data is ever sent. |

### Pipeline & secrets

| Item | Verdict | Evidence |
|---|---|---|
| Pipeline LOCAL → PREVIEW → QA → PRODUCTION | **GAP** (partial) | `eas.json` `preview` profile builds the release APK ≈ PREVIEW; there is no formal QA or PRODUCTION stage — APKs go straight to GitHub Releases. |
| Secrets only in `.env` + platform env vars; repo carries only `.env.example` | **N-A** | Nothing secret exists to store; no `.env` in repo or needed. |
| Supabase row-level / access policies, never open tables | **N-A** | No backend database at all. |
| Database logic in services, not UI | **OK** | All SQL/query logic lives in `lib/db.ts`; screens call functions only — verified by reading every screen. |
| Auth verified server-side | **N-A** | No server. |
| Users only access their own resources | **OK** | Trivially true: one local DB per install, no sharing mechanism. |
| File upload validation | **N-A** | App accepts no file uploads or external file intake of any kind. |
| Production QA on the live URL (adapted: release-APK QA) | **GAP** | No documented release QA checklist; testing has been manual/ad-hoc. |
| Monitoring: error tracking | **GAP** | No crash reporting (Sentry etc.) — consistent with the offline/no-tracking stance, but crashes go unseen. |
| Monitoring: backups | **GAP** | No backup or export feature; the user's real financial data has exactly one copy, on one phone. |
| Monitoring: uptime | **N-A** | No server to monitor. |

### Gaps the guide does NOT cover (stated honestly)

| Gap | Status here |
|---|---|
| **Dependency / CVE scanning** | **GAP** — no `npm audit` step, no Dependabot, no lockfile review in the release process. |
| **Auth audit logging** | N-A — no auth exists. |
| **Mobile-specific guidance** | **GAP** — the guide has none; §4 below fills it for this app. |

---

## 3. Secrets scan (bundle verification)

Ran over the full shipped source (`app/`, `components/`, `lib/`, `app.json`, `eas.json`, `version.json`):

- `api_key / secret / token / password / bearer` → **0 hits**
- Hardcoded URLs → only `https://raw.githubusercontent.com/hussnainahmedd/pockethisaab/main/version.json` (update check) and the release APK URL in `version.json`
- Network calls (`fetch`/`axios`/WebSocket) → exactly one: the update check in `lib/update.ts`, which sends no identifiers, no device info, no financial data — just a GET of a public JSON file over HTTPS with an 8s timeout, failing silently

**Result: nothing secret is baked into the APK.**

## 4. Mobile-specific guidance

- **Storage reality.** `pockethisaab.db` lives in the app's private internal storage. On a stock, unrooted Android device with a lock screen, other apps cannot read it — the OS sandbox does the protecting. The app **cannot force** a device passcode/biometric; that is an OS setting and entirely the user's responsibility. Recommendation: require device lock (PIN/biometric) — a phone without it exposes the whole ledger to anyone picking it up.
- **Encryption at rest** — ✅ IMPLEMENTED 2026-10-05 (`lib/crypto.ts`, `lib/db.ts`): udhaar person names, income sources and all notes are AES-256-CBC encrypted with a per-value random IV; the 256-bit key is generated once and stored in expo-secure-store (Android Keystore-backed). Existing installs migrate inside one SQLite transaction (file backup taken first; any failure rolls back and the app keeps working). Amounts and dates intentionally stay numeric/plaintext so offline SUM totals keep working — documented, not a gap.
- **No transport risk for data.** Financial data never leaves the device. The update-check GET leaks nothing except the fact that *someone* fetched a public file (IP visible to GitHub, as with any web request) — negligible.
- **Backup is the user's responsibility today.** There is no export feature (GAP). Do not uninstall the app or "clear data" without accepting total loss; keep the phone's own backup enabled. An export (CSV/JSON) feature is the durable fix — needs user approval to build.
- **APK signing & substitution.** Release APKs are built by EAS (signed with EAS-managed credentials) and published on GitHub Releases. Install **only** from the official releases page; a same-named APK from a chat forward or third-party site is untrusted. Publishing SHA-256 checksums per release closes this loop.
- **Dependency hygiene.** Run `npm audit` before every release; enable Dependabot on the repo so vulnerable transitive deps surface automatically.

## 5. Prioritized actions

> Implementation is **OUT OF SCOPE** for this review and needs the user's explicit approval first. Each action says exactly what to do and where.

### 🔴 Critical

1. ~~Turn on the device lock screen~~ — REMOVED per user decision 2026-10-05: no lock-screen enforcement in the app; protection comes from field-level encryption + the Android app sandbox.
2. **Stop the single-copy risk: approve building an export feature.** What: add "Export data (CSV/JSON)" — e.g. a settings screen that writes income/expenses/udhaar to a dated CSV the user can save to Drive/email. *Where: new `app/settings.tsx` route + export functions in `lib/db.ts`.* Until then: never uninstall / clear app data, and keep the phone's system backup on.

### 🟠 High

3. **Publish SHA-256 checksums with every GitHub Release.** What: after EAS builds the APK, run `sha256sum pockethisaab-vX.Y.Z.apk`, paste the hash into the release notes; install only when the downloaded file's hash matches. *Where: GitHub Releases page + release process notes.*
4. **Add `npm audit` to the release process (and enable Dependabot).** What: `npm audit --audit-level=moderate` before each release build; turn on Dependabot alerts in repo Settings → Code security. *Where: repo settings + a `RELEASE_CHECKLIST.md`.*
5. **Write and run a release QA checklist.** What: fresh install → add/edit/delete one income, one expense, one udhaar → settle/unsettle → verify home balance → update-check with network on and off → confirm no crash. *Where: `RELEASE_CHECKLIST.md` in the repo; run on a real device per release.*

### 🟡 Medium

6. ~~Evaluate SQLCipher~~ — SUPERSEDED 2026-10-05 by field-level AES-256 (no native SQLCipher module needed in Expo; whole-DB encryption would have required a dev-client rebuild).
7. **Verify Android Auto Backup behavior.** What: check whether `allowBackup` is effectively on for the EAS build — if yes, `pockethisaab.db` may be copied to the user's Google Drive backup (a privacy consideration worth knowing, not necessarily disabling). *Where: installed APK manifest inspection.*
8. **Decide on crash reporting.** What: the offline/no-tracking stance conflicts with Sentry-style reporting; if blind crashes are acceptable, document that decision; otherwise add opt-in reporting. *Where: product decision, then `app/_layout.tsx`.*

## 6. Verification loop (mobile-adapted — replaces the Strix loop)

**Honest note on Strix:** the reel's verification loop (Strix-AI/Strix autonomous "hacker" agents pentesting the app/API/database, wired into CI/CD) is built for web apps with reachable APIs and databases. PocketHisaab has no API, no backend, no login, and no network attack surface — pointing web pentest agents at it would test nothing. The loop below is the mobile equivalent, and it is the **pending pass** to wire in:

1. **Pre-release secret scan** — `grep` for keys/tokens/secrets over the bundle source + `git log -p` check for accidentally committed secrets. Automate in CI (GitHub Actions) on every tag.
2. **Dependency audit** — `npm audit --audit-level=moderate` in CI on every release build; Dependabot alerts on the repo for the quiet weeks between releases.
3. **Release-APK QA on a real device** — the checklist from action #5, including the offline test (airplane mode: everything except the update banner must work).
4. **Local security review per release** — re-read `lib/db.ts` + `lib/update.ts` diffs for: new network calls, new permissions in `app.json`, changes to SQL construction, changes to the update-check flow.
5. **Checksum publish** — SHA-256 in the release notes (action #3), so installs stay verifiable.

Wire steps 1–2 into a GitHub Actions workflow on release tags; steps 3–5 stay manual per release until the user approves automation. Re-run this SECURITY.md review after any change to the data layer, permissions, or networking.
