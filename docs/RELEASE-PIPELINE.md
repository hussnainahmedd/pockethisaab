# PocketHisaab — Build & Release Pipeline

How PocketHisaab is built, verified, and published. Two GitHub Actions
workflows live in `.github/workflows/`:

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` | Push to `main`, pull requests, manual | Tests (`npm run test:finance`), TypeScript check, Expo config check. Never builds, never releases. |
| `release.yml` | **Manual dispatch only** | Full gated production release (below). |

## EAS profiles (`eas.json`)

| Profile | Output | Use |
|---|---|---|
| `preview` | APK | Day-to-day test builds (unchanged from v1). |
| `production-apk` | APK | **GitHub releases** — direct installation, updates existing installs. |
| `production` | AAB (app bundle) | Future Google Play distribution. |

Versions come from `app.json` (`cli.appVersionSource: "local"`), so the
version and versionCode in a build are always exactly what the release
gate read from the source. The Android application ID is
`com.hussnain0702.pockethisaab` — unchanged since v1, which is what
allows new APKs to install as updates.

## Signing identity (critical)

All releases are signed by the **EAS-managed keystore** stored on
Hussnain's personal Expo account (`hussnain0702`). EAS Build uses it by
default (`credentialsSource: remote`); **never generate new credentials
and never let a build create a fresh keystore** — a different key makes
Android refuse the APK as an update, and an uninstall would erase the
user's on-device ledger.

Ground truth, extracted from the shipped v1.1.3 APK's signing block
(2026-10-24):

- **Signing certificate SHA-256:**
  `56:57:C8:7F:EC:CB:23:12:72:01:6E:15:DA:A0:D7:DA:82:4D:DD:53:83:7A:3A:09:7F:82:FF:9D:82:F2:F2:CC`

The release workflow compares the freshly built APK's certificate
against this value and **aborts the release on any mismatch** — it will
never publish an APK that cannot update existing installs.

## One-time setup for the GitHub Actions release workflow

1. **Expo token** — expo.dev → account settings → *Access tokens* →
   create a token → GitHub repo → Settings → Secrets and variables →
   Actions → New repository secret → name `EXPO_TOKEN`.
2. **Signing variable** — same settings page → Variables tab → New
   variable → name `SIGNING_CERT_SHA256`, value = the certificate
   fingerprint above.
3. Nothing else. The workflow uses the built-in `GITHUB_TOKEN` for the
   release and the `version.json` commit.

Secrets are only ever read from GitHub/Expo secret storage — never
committed, never printed (the workflow prints fingerprints and hashes,
which are public by design, never keys or tokens).

## Running a release (workflow path)

Prerequisites: the version in `app.json` (and `versionCode`) has been
bumped in source and pushed; CI is green; the milestone's checks have
passed; the owner has approved the release.

1. GitHub → Actions → **Release (manual, gated)** → Run workflow.
2. Enter the version (must match `app.json`) and type `PUBLISH`.
3. Optionally paste Markdown release notes; otherwise a changelog is
   generated from commits since the previous tag.
4. The workflow runs: gates → tests/typecheck/config → EAS
   `production-apk` build → APK download → package + signing
   verification → SHA-256 → GitHub Release with the APK attached →
   `version.json` flip commit (this is what makes the in-app update
   popup appear for installed users — it happens strictly after the
   release exists).

Any failure before the Release step aborts with nothing published and
`main` untouched, except the CI history. Duplicate tags/releases are
refused at the gate.

## The v2.0.0 release (agent-executed path)

The v2.0.0 release was executed by the development agent through the
exact same gate sequence the workflow encodes (tests → typecheck →
config → EAS `production-apk` build → certificate + checksum
verification → release → `version.json` flip), on the owner's explicit
instruction. The workflow above is the standing automation for every
release after it.
