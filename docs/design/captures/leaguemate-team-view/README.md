# The leaguemate team view: entry points and screen (`feat/leaguemate-team-view`)

Planner ruling 2026-10-16 (F5 of the W8 tap-through; `PRODUCT_RULES.md`, "A leaguemate's team opens
from the standings and the matchup"): wire the orphaned `player-portfolio` route the way ESPN /
Sleeper / Yahoo open another manager's team. Design Lead rulings the same day: the Home header is
the Standings link, rows open teams, the WHOLE Matchup half is the button.

**Frames live outside the repo**, in `~/fantasy-stock-design-review/feat-leaguemate-team-view/`
(PNGs, three `.mov`, and the scripts `fx.sh`, `run.sh`, `all.sh`, `rest.sh`, `rec.sh`). One build
for all of them: the branch tip this README ships in. File names:
`<state>-{before,after}-{l,xxxl}-{dark,light}-{17e,17pro}.png` (L = `large`, XXXL =
`accessibility-extra-extra-extra-large`; status bar pinned to 9:41).

## How it was captured, and what it is NOT

- Simulators "Team 17e" and "Team 17 Pro" (iOS 27.0), Expo Go, Metro on :8147, the capture seam
  (`EXPO_PUBLIC_SHELL_FIXTURE=leagues`, `EXPO_PUBLIC_GAME_SEAM=1`: the Matchup fixture's league, Roberto B.,
  Stock Scudetto). A dead Supabase URL: nothing reads or writes prod.
- **The matrix below was shot with the capture script, not fingers** (that was before the device grant;
  the real-tap pass is the next section). The "taps" are the DEV capture script
  (`lib/money/captureScript.ts`; `EXPO_PUBLIC_CAPTURE_SCRIPT`). Matchup's `opp` / `me` call the
  half's own `onPress`; League's `team`, Home's `hometeam` / `homeheader` replay the same
  `router.push(teamHref(...))` the rows run. Real taps on the row components were not exercised.
- **VoiceOver was not run** (it moves to Giorgio's phone pass). The labels and hints are pinned by
  tests (below), not heard.
- **The three `.mov` recordings were not frame-inspected** (no ffmpeg here); they exist and have a
  size, nothing more is claimed.
- Fixture limits, not product behaviour: the seam's league ledger holds only Roberto and
  Gianluigi, so a tap on Paolo or Luca finds no team (that is the "left member / not in the league"
  edge, frame `home-row-tap-not-in-ledger`); XOM has no seam quote, so Gianluigi's team reads
  "1 holding counted at cost" and the XOM row is a plain row (no card), the "never a dead tap" case.

## Frames

| Files | State | Shows |
|---|---|---|
| `standings-tap-before-*` / `-after-*` | League › Standings → tap Gianluigi B. | Before: the rows are the same tiles as before (no chevrons). After: his team: title = his name, value on the stake basis, since the draft, today, Holdings as roster rows (no sparklines, no rules). |
| `own-row-tap-after-*` | League › Standings → tap YOUR row | Your Portfolio tab, not the team view. |
| `matchup-opp-half-tap-before-*` / `-after-*` | Matchup → tap the opponent's half | His team. |
| `matchup-your-half-tap-after-*` | Matchup → tap YOUR half | Your Portfolio tab. |
| `home-header-tap-before-*` / `-after-*` | Home (scrolled to the card) → tap the card's header | League › Standings. |
| `home-your-row-tap-after-*` | Home → tap YOUR row | Your Portfolio tab. |
| `home-row-tap-not-in-ledger-after-*` | Home → tap Paolo M. (not in the fixture's ledger) | "This team didn't load" + Try again (the left-member edge). |
| `view-after-*` | the team view, normal | as above, opened by route. |
| `view-card-after-*` | the team view → BA's player card | "Owned by Gianluigi B.", Price / Week gain / Since the draft, season and week lines, "How they got it"; NO Save and NO Sell. |
| `view-failed-after-*` | the team view, read failed (`CAPTURE_FAIL=1`) | "This team didn't load" + Try again. |
| `home-rest-*`, `home-end-rest-*`, `matchup-rest-*` and `main-*` twins | at rest, branch vs `origin/main` | the identical-pixels proof, below. |
| `rec-standings-row-to-team-dark.mov`, `rec-matchup-opp-half-to-team-dark.mov`, `rec-home-header-to-standings-dark.mov` | 17e, Large, dark | scripted taps, see above. |

## Real finger taps (the merge condition): 17e, Large, dark

Driven through the iOS Simulator control tool (`tap`, duration 0.1, points on a 390×844 screen),
with `EXPO_PUBLIC_CAPTURE_TEAMS=1` (a capture-only knob: Paolo M. and Luca V. hold the fixture's
opponent roster so Home's excerpt rows open a team that loads). Each tap has a before and an
after still in `~/fantasy-stock-design-review/feat-leaguemate-team-view/`. All seven passed.

| # | Tap (point) | Result | Frames |
|---|---|---|---|
| 1 | Home Standings HEADER, near its TOP EDGE and OUTSIDE the text: (200, 533), above the title's top at ~538 (tests the hit slop) | League › Standings | `tap1-home-header-{before,after}-17e` |
| 2 | A Home row, Paolo M.: (200, 590). Gianluigi is rank 6, so Home's excerpt (top 3 + you) doesn't show him; Paolo's team is Gianluigi's roster in this fixture | his team | `tap2-home-row-{before,after}-17e` |
| 3 | YOUR Home row: (200, 636) | the Portfolio tab | `tap3-home-your-row-{before,after}-17e` |
| 4 | A League › Standings row, Gianluigi B.: (200, 519) | his team | `tap4-league-row-{before,after}-17e` |
| 5 | Matchup, the OPPONENT's half ON ITS SCORE "+$90.45": (289, 260) | his team | `tap5-opp-score-{before,after}-17e` |
| 6 | Matchup, YOUR half on your score "+$213.60": (108, 260) | the Portfolio tab | `tap6-your-score-{before,after}-17e` |
| 7 | The lead line "Roberto B. leads by $123.15": (195, 314) | NOTHING: before and after are pixel-identical, and no press fired (a temporary log counted 5 presses before and 5 after) | `tap7-lead-line-{before,after}-17e` |

Also tapped for real: the team view's × (back to where it came from) and the tab bar.

Two things worth knowing from this pass:
- Matchup's first taps missed because `SHELL_SCROLL_END=1` (set for Home's card) also scrolls Matchup's
  list to its end four seconds after it first mounts, so the scoreboard had moved up under the tap.
  A fixture-knob effect, not an app one; after scrolling back to the top every tap landed.
- **One observation I could not explain: the first time tap 6 landed, the Portfolio tab drew BLANK**
  (no header, no content; `tap6-first-attempt-blank-after-17e.png`) for more than 10 s and again on a
  fresh screenshot, then drew normally after I tapped Home and Portfolio in the tab bar. The press
  fired and the tab was selected. Repeating tap 6 from the same state twice more drew the Portfolio
  correctly both times (`tap6-your-score-after-17e.png`), and the scripted run of the same navigation
  (`matchup-your-half-tap-after-*`) was fine. The simulator also timed out twice on input ("could not
  finish sending input within 4 seconds"), so this may be the simulator stalling a frame, but I did
  not prove that. Worth a look on a real device.

## At rest: identical to main (17e, Large, both themes)

`origin/main` `162cf1aa` built in a clean worktree and shot with the same fixture, status bar and
sizes, then pixel-diffed (PIL `ImageChops.difference`, threshold > 8/255):

| Screen | dark | light |
|---|---|---|
| Matchup (top) | 0 differing pixels | 0 |
| Home, scrolled to the Standings card | 4 cells of 40px, all at the chart's live end dot | the same 4 cells |
| Home, top (any differing pixel at all) | two clusters: the live end dot and the LIVE chip's dot | the same |

The only differing pixels are the two PULSING live dots (an animation phase); nothing in the
Standings card, the Scoreboard or anywhere else differs. (17 Pro light at the Home scroll end also
differs inside the Dynamic Island strip, a status-bar artifact; not a screen difference.)

## VoiceOver (from the source, pinned by `tests-deno/leaguemate-team-view.test.ts`)

Each row or half keeps its CONTENT as its label, is a `button`, and carries the Planner's words
as its hint:

| Element | accessibilityLabel | hint |
|---|---|---|
| Home / League row (others) | "1, Paolo M., 5–0, +$512.40 season gain" (League adds the move: "up 1") | "View Paolo M.'s team" |
| Home / League row (yours) | "2, Roberto B., you, 5–1, +$129.99 season gain" | "View your portfolio" |
| Home Standings header | "Standings, Through Week 5" | "Opens Standings" |
| Matchup half (yours) | "Roberto B., you, +$213.60" | "View your portfolio" |
| Matchup half (theirs) | "Gianluigi B., +$90.45" | "View Gianluigi B.'s team" |
| Matchup bye half, compact All-matchups boards | not buttons (inert) | none |
| Team view: close | "Close" (new, VoiceOver-only) | none |
| Team view: a holding | "XOM, Exxon Mobil, 49 shares, $4,704.00" (+ ", −1.18% today") | "Opens its player card"; none on a plain row |

## Tappables (element → what it does)

| Element | Does | Evidence |
|---|---|---|
| League › Standings row (others) | opens their team | `standings-tap-*` |
| League › Standings row (yours) | opens your Portfolio tab | `own-row-tap-*` |
| Home Standings header | opens League › Standings | `home-header-tap-*` |
| Home excerpt row (others / yours) | their team / your Portfolio | `home-row-tap-not-in-ledger-*`, `home-your-row-tap-*` |
| Matchup half (theirs / yours) | their team / your Portfolio | `matchup-opp-half-tap-*`, `matchup-your-half-tap-*` |
| Team view holding row | its player card (Owned by them; no action) | `view-card-after-*` |
| Team view holding row with no price or opening event | nothing: a plain row, not a button | `view-after-*` (XOM) |
| Team view × | closes (back, or the Portfolio tab on a cold deep link) | `view-after-*` |
| Team view Try again | re-reads the ledger, their week and the slots | `view-failed-after-*` |

## Season-gain % basis

The team view builds from `playerPortfolio → portfolioSummary → teamValue`, the same
`teamValue.stake` as Home and Portfolio (a post-draft net buy grows the stake). Pinned by
`season-gain-basis.test.ts` and by a new test with a post-draft net buy.

## Observed, not caused here

- **Portfolio's hero sub-lines render letter-spaced at XXXL** ("+ $ 3 4 3 . 5 1 ·", one glyph per
  gap) on this build (iOS 27.0 simulator). It reproduces on `origin/main` `162cf1aa`
  (`main-portfolio-baseline-after-xxxl-light-17e.png`) and is visible in `own-row-tap-after-xxxl-*`.
  The team view does not use `RollingMoney` for its sub-lines (it never live-updates), so it is not
  affected.
- Home's excerpt at XXXL stacks a row's name over two lines ("Roberto / B."), as before.
