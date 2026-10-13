# W4 Home on Game Night: gate captures (`feat/gn-w4-home`, gate pass 2)

Re-shot after the Design Lead's BLOCK on `bdd450a7` (2026-10-13), on the fixes in `a5376a59`.
Simulators "calm-home 17e" (390×844 pt) and "calm-home 17 Pro" (402×874 pt), iOS 27.0, Expo Go
SDK 54, status bar 9:41. All DEV fixtures (`apps/mobile/.env.local`, every fixture var written
explicitly, Metro restarted with `--clear` per fixture). Env for every row:
`SHELL_FIXTURE=leagues RUN_IT_BACK=1` plus the row's own. Every still exists in `-light` and
`-dark` (theme verified per frame from the page `bg` pixel), on the phones the row names.
Stills were shot headless (`simctl io screenshot`); everything that needs a tap or a scroll was
shot with the simulator panel's device access (17e).

**Recordings** live outside the repo (one is 68 MB), in
`~/fantasy-stock-design-review/gn-w4-home/`; their frame sheets are here.

## Measurements (from pixels, 3× → pt)

- **Block gap: 24.0 pt** wherever two blocks have edges, in every capture, both phones and
  themes (tabs underline → This week; This week / message card → Standings; card → card).
  The hero has no edge (hero text → first card in pre-season is the 24 + the glyph's descent).
- **F1, the tabs under the dates** (row-wise: the dates' lowest pixel, a descender, → the
  tabs' highest): **7.7 pt** at Large on both phones, **8.0 pt** at XL on both phones; tabs
  underline → This week **24.0 pt**. The two no-pull measurements behind `weekMarks.ts`'s
  constants: **28.7 pt** (Large) and **28.0 pt** (XL; 5.0 pt measured with the 23 pt pull then
  in place). Above 1.3× the pull is flat: every row above the tabs caps at 1.3×.
- **The live mark under the end dot** (read off the chart crop, ±1 pt): `live_open` 17e, dot
  and mark both at x ≈ 378 pt; `week1_monday`, both at ≈ 10 pt (the dot clamped in to keep its
  halo on screen).
- **Accent by area (§5 as amended 2026-10-13):** `accent-split.txt`, every still: the ONE
  primary measured apart, everything else ≤ 5%. Highest primary **4.7%** (season over, 17e:
  Run it back); highest rest **1.32%**. No frame over.

## Stills

| # | Files | State | Env |
|---|---|---|---|
| 1 | `01-live_open-{17e,17pro}-*` | in season, live | `HOME_FIXTURE=live_open` |
| 1b | `01b-week1_monday-*` | **the season line before its first close: one point** (today), the full axis, the live mark under the dot | `week1_monday` (new) |
| 1c | `01c-week1_tuesday-*` | **after one close: two points** (Sep 21 → Sep 22) | `week1_tuesday` (new) |
| 2 | `02-live_closed-*`, `02-scoring-*`, `02-scored_won-*`, `02-scored_lost-*` | closed, scoring, final W/L | `live_closed`, `scoring`, `scored` + `SCORED_OUTCOME=won/lost` |
| 2 | `02-pre_season-*` | hero only, the $0.00 preview | `pre_season` |
| 2 | `02-bye-*`, `02-eliminated-*`, `02-playoff_bye-*`, `02-missed_playoffs-*` | every PhaseMessageCard state | same names |
| 3 | `03-playoff_live-*` | B′: static end dot, "Wild card" in the meta and the tag | `playoff_live` |
| 4 | `04-live_open-xl-*` | XL | `live_open`, `accessibility-extra-large` |
| 4 | `04-live_open-xl-scrolled-17e-*` | XL scrolled: This week + Standings, the rows stacked (name over numbers) | same, scrolled (panel) |
| 4 | `04-live_open-xxxl-*` | XXXL sanity (F1) | `accessibility-extra-extra-extra-large` |
| 5 | `05-xl_million-*`, `05-xl_million-xl-*` | ≥ $1M values, Large and XL | `xl_million` |
| 8 | `08-pre_draft-scheduled-*` | before the draft; order time = draft time − 1 h (fixed) | `pre_draft`, `GAME_SEAM=1`, `DRAFT_START_FIXTURE=scheduled` |
| 8 | `08-pre_draft-no_date-commissioner-*` | Set draft time as the primary pill | `DRAFT_START_FIXTURE=no_date` |
| 8 | `08-pre_draft_waiting-*` | waiting for managers | `pre_draft_waiting`, `scheduled` |
| 8 | `08-renewed_season2_pre_draft-commissioner-17e-*` | Season 2 pre-draft, commissioner | `SHELL_FIXTURE=leagues-renewal`, `RENEWAL_FIXTURE=commissioner`, `pre_draft`, `GAME_SEAM=1`; pill → Summer Cup (Pre-draft) |
| 9 | `09-complete-champion-commissioner-*`, `09-complete_runner_up-*` | season over + Run it back (pill) | `complete` / `complete_runner_up`, `GAME_SEAM=1` |
| 9 | `09-complete-member-ask_pending-17e-*` | member, the ask is the only primary | `leagues-renewal`, `RENEWAL_FIXTURE=pending`, `complete`; pill → Summer Cup (Final) |
| 9 | `09-complete-member-out-17e-*` | member who's out: the GS-14 chip | `RENEWAL_FIXTURE=out`, same |
| 10 | `10-drafting_on_clock-*`, `10-drafting_waiting_turn-*` | drafting | same names |
| 12 | `12-stress-*`, `12-stress-xl-*` | stress: 20-character names, ±$1M, you behind | `HOME_FIXTURE=stress` |
| 12 | `12-stress-scrolled-17e-*` | **your 5th-place row, −$1,234,567.80**, on your tint | same, scrolled (panel) |
| 13 | `13-range-1W-17e-*`, `13-range-1M-17e-*` | the 1W and 1M tabs selected (1M now carries the past weeks) | `live_open`, `GAME_SEAM=1`, tapped |

## Recordings (frame sheets here, files in `~/fantasy-stock-design-review/gn-w4-home/`)

| File | Shows |
|---|---|
| `06-draw-in-17e.mov` · `06-draw-in-17e-frames.png` | The line draws left to right (#283 9.43 s → #300 10.00 s), then the end dot (#320) |
| `11-reduce-motion-17e.mov` · `11-reduce-motion-17e-frames.png` | Reduce Motion: skeleton (#290) → the hero and the tabs already in place over an empty plot for one frame (#292, the layout pass) → the whole line with its dot (#293). Nothing moves |
| `06-scrub-17e.mov` · `06-scrub-17e-frames.png` | Scrub on past weeks ("Aug 28 · +$100.05", "Sep 4 · +$3.65", "Sep 11 · +$75.75") then this week ("Sep 21", "Sep 23", "Sep 24 · +$343.59"); the accent underline follows the scrubbed week's mark, the live dot included |
| `07-tap-through-in-season-17e.mov` · `-frames.png` | League pill → Your leagues → X; avatar → Profile → Home; This week → Matchup; Home; the chevron → Matchup; Home; 1W, 1M, Season; Standings → League › Standings |
| `07-tap-through-season-over-17e.mov` · `-frames.png` | See the final standings → League › Final standings; Home; Run it back (seam) → the renewed league's roster |
| `07-tap-through-pre-draft-17e.mov` · `-frames.png` | Set draft time → the Draft time sheet → X; Build your queue → League; Home; Share → the share sheet (dismissed) |

## For the Design Lead

- **The primary is a pill, secondaries keep 10 pt** (as ruled): "Set draft time" (pill) sits over
  "Build your queue" (10 pt) on the commissioner's pre-draft card.
- **XL, This week:** "vs Gianluigi B." at 40 pt can't fit half the card and truncates after two
  lines ("vs / Gian…"). Not changed.
- **"Through Week 0"** shows on the Standings card in a live Week 1 (`01b`/`01c`): existing copy
  logic (`standingsThroughWeek`), not touched; a copy decision.
