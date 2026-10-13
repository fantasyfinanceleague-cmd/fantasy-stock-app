# W4 Home on Game Night: gate captures (`feat/gn-w4-home`)

Simulators "calm-home 17e" (390×844) and "calm-home 17 Pro" (402×874), iOS 27.0, Expo Go SDK 54,
2026-10-12, status bar 9:41. Captured HEADLESS (`simctl io screenshot`): the panel's device-access
prompt went unanswered, so nothing here needed a tap or a scroll. All DEV fixtures
(`apps/mobile/.env.local`, every var written explicitly, Metro restarted with `--clear` per fixture);
env for every row: `SHELL_FIXTURE=leagues RUN_IT_BACK=1` + the row's own. Every file exists in
`-light` and `-dark`, for `-17e` and `-17pro`. Theme verified per frame from the page `bg` pixel.

**Block gap (measured from pixels, full-width page-bg runs, 3× → pt): 24.0 pt in every capture with
an edge** (tabs underline → This week; This week/message card → Standings; card → card). The hero has
no edge. **F1:** date glyph (descender) → tab glyph 7.7 pt at Large, 7.3 pt at XL; marks → dates 10.3.

| # | Files | State | Env |
|---|---|---|---|
| 1 | `01-live_open-*` | in season, live | `HOME_FIXTURE=live_open` |
| 2 | `02-live_closed-*`, `02-scoring-*`, `02-scored_won-*`, `02-scored_lost-*` | closed, scoring, final W/L | `live_closed`, `scoring`, `scored` + `SCORED_OUTCOME=won/lost` |
| 2 | `02-pre_season-*` | hero only, $0.00 preview | `pre_season` |
| 2 | `02-bye-*`, `02-eliminated-*`, `02-playoff_bye-*`, `02-missed_playoffs-*` | every PhaseMessageCard state | same names |
| 3 | `03-playoff_live-*` | B′: static end dot, "Wild card" in meta and tag | `playoff_live` |
| 4 | `04-live_open-xl-*` | XL (`accessibility-extra-large`) | `live_open` |
| 5 | `05-xl_million-*`, `05-xl_million-xl-*` | ≥ $1M values, Large and XL | `xl_million` |
| 6 | `06-draw-in-17e.mov`, `-frames.png` | the line draws left to right (#293 → #305), then the end dot | `live_open` |
| 8 | `08-pre_draft-scheduled-*`, `08-pre_draft-no_date-commissioner-*`, `08-pre_draft_waiting-*` | before the draft | `pre_draft`/`pre_draft_waiting`, `GAME_SEAM=1`, `DRAFT_START_FIXTURE=scheduled/no_date` |
| 9 | `09-complete-champion-commissioner-*`, `09-complete_runner_up-*` | season over + Run it back | `complete`/`complete_runner_up`, `GAME_SEAM=1` |
| 10 | `10-drafting_on_clock-*`, `10-drafting_waiting_turn-*` | drafting | same names |
| 11 | `11-reduce-motion-17e.mov`, `-frames.png` | Reduce Motion: the line's first frame is whole (#280 none → #290 whole) | `live_open`, RM on |
| 12 | `12-stress-*`, `12-stress-xl-*` | stress: 20-char names, ±$1M standings, you behind | `HOME_FIXTURE=stress` (new DEV fixture) |

**Not captured (need device access):** the tap-through recording, the scrub recording, scrolled
(below-fold) stills incl. the stress table's losses and your 5th-place row, the renewal states that
need a league-pill switch.

**Open finding (accent by area, §5):** 8 frames read 5.1–5.3% accent (limit 5%):
`09-complete*-17e`, `10-drafting_on_clock-*`, both themes. Cause: a full-width accent primary
button; the board's `.dr-btn` is content-width. Not fixed in this branch.
