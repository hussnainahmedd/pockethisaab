# PocketHisaab v2 — M5 Design Research & System

**Date:** 2026-10-24 · **Milestone:** M5 (Phase 2 of the master prompt)

## 1. Research (done before designing, per the master prompt)

Sources consulted 2026-10-24: Pakistani wallet comparisons and reviews
(SadaPay vs NayaPay coverage on TechJuice, The Public Purview,
InfoHorizons, FreeToolForge, AreteBlogs) and 2026 fintech UX trend
analyses (Kindgeek "Fintech UX Design Trends 2026", OneThing "Fintech
UX Design Practices 2026", VezaDigital calm-design analysis, banking
app best-practice roundups).

### Recurring, evidence-backed patterns
1. **SadaPay ("Pakistan's Cash App")** wins praise for the *simplest*
   interface: dark by default, very few buttons, speed-first. Its
   differentiator in review after review is restraint, not features.
2. **NayaPay** is the social/feature-rich pole: chat-led, "Money
   Circles" (split bills), super-app ambitions — powerful but visibly
   more complex.
3. **JazzCash / Easypaisa** are dense utility super-apps (1,500+
   billers, mini-apps). Breadth is their value; nobody praises their
   calm.
4. **2026 fintech UX consensus** (multiple independent sources):
   design-token systems as the single source of truth; tabular numerals
   for money; status communicated with **labels + icons, not color
   alone**; "calm design" (white space, one clear action per view,
   restrained color) reads as *trustworthy* in finance; microinter-
   actions must reflect real state; biometric unlock is an expectation;
   dark mode is expected but needs its own contrast pass — a naive
   inversion fails with real data.

## 2. Adopt / Adapt / Reject for PocketHisaab

| Decision | Pattern | Rationale |
|---|---|---|
| **Adopt** | One hero number + few primary actions (SadaPay restraint) | PocketHisaab Home already centers net worth; quick actions stay at six, everything else lives behind Manage. |
| **Adopt** | Token-driven design system | `components/theme.ts` is the single source every screen reads; M5 formalizes it (below) instead of per-screen styling. |
| **Adopt** | Tabular numerals, labeled statuses | Already enforced in the ledger UI and import inbox (badges say PENDING/FAILED in words). Extended as a standing rule. |
| **Adopt** | Biometric unlock expectation | Delivered in M6 (PIN + biometric app lock). |
| **Adapt** | SadaPay's dark surface | A full dark theme can't be contrast-verified without a device pass (M7), and v1's identity is light. M5 takes the *dark moment* — a deep-ink hero card and a deep floating tab dock — inside a warm light system. Full dark mode is a deliberate post-v2 item, not a rushed inversion. |
| **Adapt** | Gen Z energy | Expressed through warm paper neutrals, a gold "coin" accent, chunky radii, sticker chips and heavy type — not neon/cyber palettes, which the calm-design evidence links to *lower* trust in finance. |
| **Reject** | NayaPay-style social/chat features | PocketHisaab is offline-first and private by architecture; there is no server to chat through, and adding one would break the privacy model. |
| **Reject** | Super-app feature density (JazzCash/Easypaisa pattern) | A personal ledger wins on clarity. Billers, mini-apps and promos are out of scope by product definition. |
| **Reject** | Copying any competitor asset | All marks below are original geometry drawn for PocketHisaab. |

## 3. The "Pocket Pop" system (implemented in M5)

- **Surfaces:** warm paper background `#F8F5EC`, pure-white cards,
  warm hairline `#E8E1CE`. Calm, print-like, distinct from the cold
  mint fintech sea.
- **Ink:** deep green-black `#101D15` — text, selected chips, the
  floating tab dock.
- **Brand:** emerald `#0E9F6E` (continuity with v1) deepening to
  `#052E21`; **gold coin accent** `#F2B33D` for the hero coin motif,
  active tab tint, and celebratory states. Semantic red/amber/violet/
  sky unchanged in meaning.
- **Shape:** card radius 22, hero radius 26–28, pill chips, 16–20
  radius inputs/buttons. Soft green-tinted shadows.
- **Type:** system font, 800/900 weights for numbers and headings,
  `tabular-nums` on every money value (unchanged rule).
- **Navigation:** floating deep-ink dock (absolute, rounded 24,
  gold-active) replaces the flat white tab bar; every scroll surface
  already clears it with ≥110 bottom padding.

## 4. Original logo — "Pocket Coin"

Original mark drawn programmatically (Python/PIL, no third-party
assets): a white pocket outline — the universal "pocket" PocketHisaab
is named for — with a gold coin stamped `₨` dropping into it, on a
deep-emerald field. The coin is the money; the pocket is the app; the
gesture is the product (money, kept). Geometry: rounded-rectangle
pocket with a curved mouth, circle coin with an inner ring, bold ₨
glyph (DejaVu Sans Bold, an open font). Delivered as `assets/icon.png`
(1024×1024, full-bleed) and `assets/adaptive-icon.png` (transparent
foreground, mark inside the Android safe zone); the adaptive
background is the deep brand green `#052E21`.
