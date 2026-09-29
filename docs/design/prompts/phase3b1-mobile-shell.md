# Phase 3b-1 worker prompt: mobile shell + first run (`ui/mobile-shell`)

> **v2, Design Lead, 2026-09-29.** This replaces the 2026-09-26 draft, which predates the key-screens board and Giorgio's rulings.
>
> **Starts when** `ui/foundation-mobile` (PR #53, §9A themes) is merged.
>
> **Backend it uses (all live):** `set_username` / `check_usernames` (PRs #54–#58), the signup trigger, and `signups_paused`.
>
> **Visual source of truth:** the key-screens board. The file is `docs/design/screens/key-screens.html` (branch `design/key-screens-2026-09-29`), published as the "Stockpile Key Screens" artifact.
>
> Plan on Opus, build on Sonnet.

---

You are the UI worker for **Phase 3b-1: the mobile app shell and first run**. Your branch is `ui/mobile-shell`. You report to `Orchestrator` and `Design Lead` via `SendMessage`.

**The bar.** "Would this impress on first use next to Robinhood, Sleeper, Revolut or Arc?", not "is it correct". Correctness, honesty, tokens, contrast and Reduce Motion are **table stakes, not the goal**. Giorgio's brief is "cool animations and transitions", so the **signature moments** in the motion table are **required**, each with a Reduce Motion version and a recording. The Design Lead pushes back on timid work.

**Copy.** Keep existing strings and Giorgio's copy **verbatim**. New copy comes from the board; propose other wording changes, don't make them.

## Read first

- `CLAUDE.md`, especially:
  - the RN styles-at-bottom ESLint rule;
  - "UI entry points: verify MOUNTED and REACHABLE";
  - the Metro `--clear` lesson.
- `docs/STATUS.md`.
- `docs/design/UI-UX-PROGRAM.md` (the contract).
- `docs/design/DESIGN_DIRECTION.md`:
  - §3 (IA);
  - §4 and §5 (motion, reduced motion);
  - §9 (type, space, motion; its colour axis is superseded);
  - **§9A (one design, two themes: the colour law)**.
- **The board**, sections **Themes**, **Home** (the header only) and **Part 2 › Sign in and first run (3b-1)**. Its screen components live in `docs/design/screens/inventory.jsx` and `screens.jsx`, and its canonical sample data in `data.js`.
- The merged foundation: `constants/tokens` (the ThemeProvider, `useTheme()`, the contrast pairs), `components/sp` and the dev design gallery.

## Screens: build each to its board screen

| # | Screen | Board reference (Part 2 › 3b-1 unless noted) | Notes |
|---|---|---|---|
| 1 | Sign in | "Sign in" | Keep the existing app strings verbatim: "Welcome back", "Sign in to your league", "Forgot password?", "New here? Create an account". Sentence case. |
| 2 | Create account | "Create account" (keyboard up) | The button stays above the keyboard. Username helper: "Displayed on leaderboards". Password rules check off live. |
| 3 | Create account · sign-ups paused | "Create account · sign-ups paused" | When `signups_paused` refuses: a warn-tint banner with Giorgio's **final** text, verbatim: "{brand.name} is not open for new signups yet — check back soon. Existing accounts can still sign in." Then [Sign in instead]. |
| 4 | Forgot password + sent | "Forgot password", "Check your email" | Existing strings verbatim ("Send reset link", "Back to sign in", "Didn't receive it? Send again"). The explanation line is new copy. |
| 5 | Reset password | (none on the board; apply the same Field/Button pattern) | Keep the existing flow and strings ("Set a new password", "Passwords don't match.", "Update password"). Keep its recovery-flag behaviour from PR #41. |
| 6 | Onboarding ×3 | "Onboarding · card N of 3" | Copy: "Fantasy football, but with stocks." / "Draft real stocks. Face one friend each week." / "Best performance by Friday's close wins." Skippable, shown once. |
| 7 | Get started | "Get started" | Create a league / Join with a code. The two descriptions are new copy. |
| 8 | Pick a username | "Pick a username" (taken + suggestions) | See the username rules below. It can't be skipped, but Sign out is always there. |
| 9 | League sheet | "League sheet" | Opens from the league pill on every tab. Leagues are grouped **Live this week / Upcoming / Finished**, each row shows rank · record and a PhaseChip, with a check on the active league. [Create league] and [Join with code] are always at the bottom. |
| 10 | League pill (every tab header) | Key screens › Home header; any league-scoped screen | Shows the **"+N" more-leagues hint** (Concept B, Giorgio's decision). Home has **no other-leagues list**. The avatar sits on the right of Home's header. |
| 11 | Profile | "Profile" | Username (editable, goes to Pick-a-username validation), email once, Change password, **Appearance**, Sign out (danger text), version (the real `app.json` version). |
| 12 | Appearance | "Appearance" (+ Themes section) | System / Light / Dark, System by default, saved on the device. The preview swatches are the only place both themes appear together. Switching applies **live, with no restart**. |
| 13 | Change password | "Change password" | Its own screen, not an always-open form. |
| 14 | Home with no leagues | "Home with no leagues" | EmptyState "No leagues yet" / "Create or join a league to get started." with [Create a league] and [Join with a code]. Nothing loops back to another empty screen. |
| 15 | Tab bar + headers | Every board phone (bottom bar) | 4 tabs: Home · Matchup · League · Portfolio. `app/(tabs)/_layout.tsx` **reads `useTheme()`**, not `Colors.white`: tabbar token background, active tab = `accent`, inactive = `text2`. Filled vs outline icon for active vs inactive. |
| 16 | Placeholder tabs | n/a | Matchup, League and Portfolio show honest phase-aware placeholders (EmptyState plus PhaseChip) until 3b-2, 3c and 3e. No old screens restyled piecemeal. |

**Username rules (the server is the truth).** `set_username` / `check_usernames` enforce `^[A-Za-z0-9_]{3,20}$` with **case-insensitive** uniqueness.
- Show the rules inline: "3–20 characters", "Letters, numbers and underscores".
- Errors, verbatim where they exist:
  - taken → "This username is already taken." plus 3 available suggestions from `check_usernames`;
  - format → the rule that failed;
  - the client content check → "Username is not allowed".
- Shown whenever the signed-in account's username IS NULL, **before** the tabs.

**Routing (from the v1 brief, still required).** A single `Stack` with `Stack.Protected guard={!!user}` wraps every context-dependent screen. A signed-out deep link goes to sign-in, then continues to the intended target. Auth screens and the reset link stay outside the guard.

## Theme law (§9A), non-negotiable

- Every surface reads `useTheme()` tokens. No hex, no `Colors.white` / `Colors.*`, no `kind="game"`. A screen is entirely Light or entirely Dark.
- Any new text-on-fill combination adds its pair to `constants/tokens/contrastPairs.ts` **and** tells the Design Lead, who adds it to the board's PAIRS. The two lists stay identical, and the contrast test must pass.
- `--c-text-3` / `text3` is for disabled or decorative text only, never information.

## Motion (tokens only; every row is required, with a Reduce Motion version)

### Signature moments (the ambition bar; each needs its own recording)

| # | Moment | Full | Reduce Motion |
|---|---|---|---|
| S1 | **Onboarding live vignettes** | Each card shows the product working, built on the board's three cards: (1) roster slots filling round by round; (2) the tug bar swinging through a lead change with the scores counting up (ScoreDigits roll) and a Chyron; (3) the FINAL chip landing and "You win Week 6" rising. Each vignette plays once per card focus, with no loops. Parallax only on **decorative** layers (frame, backdrop shapes at 0.2×/0.6×), never on data (§4). Cards slide + fade (`slow`, settle) with the dots stretching (`quick`). | Each vignette shows its final frame, still; cards crossfade `quick`; no parallax. |
| S2 | **Tab bar sliding indicator** | A small accent pill under the active tab label springs between tabs (`spring.snappy`). The selected icon does a one-shot scale 1 → 1.12 → 1 (`quick`) as it goes outline → filled. Screens crossfade (`quick`). | The indicator jumps; no icon bounce; screens crossfade `quick` with no translation. |
| S3 | **League sheet → pill shared element** | Picking a league flies its name from the sheet row into the header pill as the sheet closes (`spring.snappy`). The "+N" hint re-counts. On open, the rows spring in, staggered 30 ms, max 8. | The sheet fades out and the pill text swaps; rows appear together. |
| S4 | **Auth brand moment** | On Sign in / Create account the three brand bars rise in sequence (`slow`, 60 ms stagger). A successful sign-in transitions into the app with a crossfade + a 0.96 → 1 scale-in of Home (`feature`), never a hard cut. | The bars are static; the transition is a `base` crossfade. |
| S5 | **Custom pull-to-refresh** | The three brand bars rise with the pull distance (armed at the threshold with a light haptic), then pulse while a refresh is actually in flight (a progress indicator, not a decorative loop), replacing the default spinner. It follows the theme. iOS gets the full treatment; Android falls back to an accent-tinted RefreshControl. | A static bar icon with a text "Refreshing…" label. |
| S6 | **Username check** | The field's trailing state animates checking (a 3-dot pulse) → available (a ✓ drawn with a stroke, gain colour, with a `spring.snappy` pop). **Taken/invalid appear instantly** (✗ in danger colour plus the message; §4: error states never animate, so no shake). The suggestions then stagger in (30 ms), which is the recovery path and allowed to move. | Instant swaps; suggestions appear together. |

### Standard transitions

| Moment | Full | Reduce Motion |
|---|---|---|
| Pressables | scale 0.98, `instant`, light haptic | no scale; haptic kept |
| Sheets (any) | `spring.snappy`; backdrop fades `base` | fade in place |
| Appearance change | the whole app crossfades, `base` | instant swap |
| Button → loading → done (sign in, save) | label crossfades to a spinner, then a ✓ (`quick`) | instant swaps |
| Error under a field | fades + rises 4pt (`quick`) | appears in place |

Motion lives in `constants/tokens` and `useMotion()` only: no raw durations, easings or spring constants in screens (the foundation's lint/test covers this).

## Accessibility

- Accessibility XL:
  - nothing clips;
  - buttons wrap to 2 lines and never truncate;
  - a lone primary action goes `fullWidth` at fontScale ≥ 1.35 (this includes EmptyState: the open nit from the foundation review);
  - tab labels scale within their cap;
  - avatar initials don't scale.
- VoiceOver: headers are headings; the pill announces "{league}, {N} more leagues, button"; sheet rows announce name, rank, record and phase.

## Verify, then report DONE (captures go to `~/fantasy-stock-design-review/ui-mobile-shell/`)

- **Checks:** `npx tsc --noEmit`, `npm run lint`, deno and unit tests (plus new tests for the league persistence store, phase grouping and username error mapping) and the **contrast test**. Report the counts.
- **Captures, Light AND Dark at standard size:** every screen in the table (1–15), including the sign-ups-paused state, the username taken state, and the league sheet open with all three groups populated.
- **Captures, accessibility-XL (Light + Dark):** Create account, Pick a username, League sheet, Profile, Appearance, Home with no leagues, and the tab bar.
- **Smallest width:** the same XL set on the iPhone 17e.
- **Recordings, Reduce Motion OFF and ON, one per row:** S1 onboarding (all three vignettes plus the swipe between cards), S2 tab switching across all four tabs, S3 picking a league from the sheet (the name flying into the pill), S4 the auth brand moment and the sign-in → Home transition, S5 pull-to-refresh on Home, S6 the username check (checking → taken → pick a suggestion → available), plus Appearance changing System → Dark → Light **live**. Record at 60 fps on the simulator; the Design Lead reviews them frame by frame.
- **Guard proof:** signed out, open `create-league`, `join-league` and `trade-history` deep links (`xcrun simctl openurl`). Each lands on sign-in and resumes after sign-in.
- **Reachability list (the CLAUDE.md lesson):** for the league sheet, Create, Join, Profile and Appearance, who navigates there and under what condition. Nothing may be reachable only from an empty state.
- **Copy audit:** a table of every visible string, marked *verbatim (existing)*, *verbatim (Giorgio)* or *new (board)*. No invented copy that isn't on the board.

## DESIGN-APPROVED criteria (the review gate)

The Design Lead compares the captures side by side with the board and approves only when:
1. Every screen matches its board screen in layout, hierarchy, copy and states, in **both themes**, and no screen mixes themes.
2. The theme switch is live, System follows the OS, and there are no hard-coded colours (grep proof: no hex or `Colors.` in touched files).
3. The contrast test passes, and any new pairs are reported and mirrored on the board.
4. XL and 17e: nothing clips, truncates or overlaps; a lone CTA is full-width at ≥ 1.35.
5. Username errors map to the server's outcomes; case-insensitive "taken" is proven with a capture (e.g. "Roberto" vs "roberto").
6. The pill's "+N" appears on every league-scoped header; the sheet groups by phase; the active league persists across relaunch.
7. The sign-ups-paused text is verbatim, through brand.name.
8. **All six signature moments (S1–S6) are present, smooth (no dropped frames visible in the recordings) and on-brand**, each with its Reduce Motion version recorded. Motion comes from tokens only. A missing or timid signature moment is a DESIGN-CHANGES, not a nit.
9. Signed-out deep links never render a context-dependent screen, and the target resumes after sign-in.

Report your PLAN first and wait for "go".
