# Phase 3b-1 worker prompt — Mobile shell + first run (`ui/mobile-shell`)

> Drafted by Design Lead, 2026-09-26. Starts when **`ui/foundation-mobile` is
> merged**. Backend asks: **#6** (username persisted at signup; verify first,
> it may be client-only). Everything else is client-side. Suggested model:
> plan on Opus, build on Sonnet.

---

You are the UI worker for **Phase 3b-1 · the mobile app shell and first run**.
Your branch is `ui/mobile-shell`. You report to `Orchestrator` and
`Design Lead` via `SendMessage`.

## Read first

`CLAUDE.md` (especially the ESLint RN-styles header rule, "UI entry points:
verify MOUNTED and REACHABLE", and the Metro `--clear` lesson) and
`docs/STATUS.md`. `docs/design/UI-UX-PROGRAM.md` (the contract).
`docs/design/prompts/phase3-plan.md` (shared rules).
`docs/design/DESIGN_DIRECTION.md` **§3 (IA)**, §4, §5, §9.
`docs/design/AUDIT-2026-09.md` §5 (empty-state and first-run findings,
screenshots 10–19) and §8 (navigation). The mobile foundation:
`constants/tokens`, `components/sp` (+ `game/`), `useMotion`, and the dev
design gallery.

## Scope (the frame every other mobile phase lives in)

1. **Tab bar → 4 tabs:** **Home · Matchup · League · Portfolio**. Profile
   leaves the tab bar. Icons come from one consistent outline/filled pair per
   tab; the active tab changes icon fill and label colour (`quick`). Labels
   use `type.caption` and scale with Dynamic Type (today they're fixed at 10px).
2. **Header pattern:** Home shows an **avatar button** (→ Profile). Matchup,
   League and Portfolio show the **league pill** (`[emoji-free league name ▾]`
   + a `PhaseChip`).
3. **League sheet** (replaces the unreachable `leagues` screen; remove its
   `href:null` route or redirect it here): every league **grouped by phase**
   (Live this week / Upcoming / Drafting / Finished), each row with name,
   rank, record and `PhaseChip`. **Create league** and **Join with code** at
   the bottom. Choosing a league sets the **global active league, persisted
   with AsyncStorage** (already installed) and restored on launch.
4. **Auth** (login, signup, forgot/reset password) on the money surface,
   with **one input style** (build `TextField` into `components/sp` if the
   foundation lacks it; propose it to the Design Lead first). Keyboard-safe
   layouts: the submit button is never covered (audit: signup). Sheets close
   with ✕ or swipe, not a back arrow. Honest pre-launch copy: when
   `signups_paused` refuses a signup, say so plainly (the existing server
   message) instead of dead-ending.
5. **First run:** replace the "FANTASY STOCK LEAGUE" interstitial with a
   **Get started** chooser (Create / Join) on the brand system, plus a
   **3-card onboarding** before it. Card 1: "Fantasy football, but with
   stocks." Card 2: "Draft real stocks. Face one friend each week." Card 3:
   "Biggest dollar gain by Friday's close wins." Skippable, shown once.
6. **Empty states:** every "no leagues / no data" state uses the one
   `EmptyState` primitive (icon in a soft circle, title, one line, one real
   action; the action never loops back to another empty screen). Replace all
   emoji-as-icon on the screens you touch.
7. **Profile** (from the avatar): a settings-list screen with the username
   (editable, from ask #6), email **once**, and "Change password" as **its own
   screen**, not an always-open form. Sign out. Version = the real app
   version. "Open web app" is removed while the web is paused.
8. **Route transitions:** stack pushes use the platform default; **tab
   switches crossfade** (`quick`); sheets use `spring.snappy`.

**Out of scope:** Home's dashboard content (3b-2), Matchup/League/Draft
content (3c), Portfolio/trade content (3e). Put **honest phase-aware
placeholders** on those tabs (`EmptyState` / `PhaseChip`), not the old screens
restyled piecemeal.

## Motion (tokens only)

| Moment | Spec |
|---|---|
| Tab switch | Crossfade, `quick`, `ease.settle` |
| League sheet open / close | `spring.snappy`; backdrop fades `base` |
| Sheet row press / any pressable | Scale 0.98, `instant` + light haptic |
| Onboarding card advance | Horizontal slide + fade, `slow`, `settle`; the progress dots animate width `quick` |
| List appear (league sheet groups) | Stagger 30ms, max 8, `base` |

## Reduced motion

| Full | Reduced |
|---|---|
| Crossfade / slide transitions | Crossfade at `quick` only (no translation) |
| Sheet spring | Fade in place |
| Stagger | Appear together |
| Onboarding slide | Crossfade |

## Verify, then report DONE

- `npx tsc --noEmit`, `npm run lint`, deno tests (+ new tests for the league
  persistence store and phase grouping): counts in the report.
- **Device capture** on the simulator the Orchestrator assigns you:
  login, signup (keyboard up), forgot password, onboarding 1–3, Get started,
  every tab in an **empty** account and in the **populated** account
  (Giorgio signs in; never type credentials), the league sheet (open, with
  every group populated), Profile, Change password.
- The same set at **Dynamic Type accessibility-extra-large**, and on the
  **iPhone 17e** (smallest width).
- Recordings: tab switch, sheet open/close, onboarding. **Reduce Motion on
  and off** each.
- **Reachability proof** (the CLAUDE.md lesson): for the league sheet,
  Create, Join and Profile, list who navigates to each and under what
  condition. Nothing may be reachable only from an empty state.

## DESIGN-APPROVED criteria

1. Four tabs plus the avatar, one header pattern, and the league pill on every league-scoped tab.
2. The active league persists across relaunch; the sheet groups by phase; Create/Join are always reachable.
3. One input style, one empty-state pattern, and no emoji-as-icon on touched screens.
4. First run reads as the product (the onboarding copy above), not a template.
5. Nothing clips or wraps badly at XL Dynamic Type; tab labels scale.
6. Motion from tokens; every reduced-motion row evidenced.
7. No regressions on the untouched tabs (they show honest placeholders).

Report your PLAN first and wait for "go".
