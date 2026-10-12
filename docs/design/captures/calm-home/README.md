# A calm Home: gate captures (`feat/calm-home`)

Spec: `docs/design/reviews/ux-audit-2026-10.md`, "Build spec · a calmer Home (decided A,
2026-10-12)" (`design/call-calm-home` @ e3b32c23), with the build-time ruling B′ (playoffs on the
chart) and the rulings on `design/calm-home-build-rulings` @ 4f8ffe91. Board: `#call-calm-home`.

Two dedicated simulators, iOS 27.0, Expo Go SDK 54, 2026-10-12. "calm-home 17e" is 390×844 pt and
"calm-home 17 Pro" is 402×874 pt. Status bar pinned to 9:41. Light, Large (default) text unless
the file says otherwise. All DEV fixtures (`apps/mobile/.env.local`); nothing comes from prod.

Every capture's env sets `EXPO_PUBLIC_RUN_IT_BACK=1` and `EXPO_PUBLIC_SHELL_FIXTURE=leagues`
unless the row says otherwise. `HOME_FIXTURE` sets Home's phase.

**Block gap.** Every capture was measured from its pixels (`scratch gaps.py`: background runs at
the centre and right columns, 3× pixels → pt). Between blocks with edges it is **24.0 pt** in every
capture on both phones:
- range tabs (the underline's bottom) → This week;
- This week → Standings (or the message card);
- card → card in the pre-draft, season-over and drafting states.

The hero itself has no edge: hero text → first card reads about 32 pt from the last glyph's
bottom, which is the 24 pt gap plus the text line's own descent.

**Fold.** The top of the tab bar is at 749.7 pt on the 17e and 779.7 pt on the 17 Pro.

## Captures

| # | File | Shows | Env / navigation | Gap (pt) |
|---|---|---|---|---|
| 1 | `01-live_open-{17e,17pro}-light.png`, `…-fold.png` | Hero → chart (124 pt, W W L W W, the live dot on week 6) → 1W · 1M · Season; This week ("Live", chevron, 28 pt scores); Standings (chevron). Everything, Standings' 3rd row included, sits above the fold on BOTH phones (17e, after F1: the Standings card ends at 711 pt, fold 749.7). The `-fold` copies draw the fold. | `HOME_FIXTURE=live_open` | 24.0 · 24.0 (tabs: 8.3 under the marks, F1) |
| 1D | `01-live_open-17e-dark.png` | Dark spot-check of 1 | same, appearance dark | 24.0 · 24.0 |
| 2 | `02-live_closed-*` | Week 6 has no mark (closed: no result yet); the line's end is the static dot | `live_closed` | 24.0 · 24.0 |
| 2 | `02-scoring-*` | 28 pt skeletons, "Scoring…" | `scoring` | 24.0 · 24.0 |
| 2 | `02-scored_won-*` | The scored current week shows its letter: the 6th mark is "W"; 5–1 | `scored`, `SCORED_OUTCOME=won` | 24.0 · 24.0 |
| 2 | `02-scored_lost-*` | 6th mark "L"; 4–2 | `scored`, `SCORED_OUTCOME=lost` | 24.0 · 24.0 |
| 2 | `02-pre_season-*` | Hero only (no chart), the 28 pt $0.00 preview, no Standings | `pre_season` | (hero → card ≈ 32 from the glyph) |
| 2 | `02-bye-*` | The bye reads "Bye" in text2, never green or red | `bye` | 24.0 · 24.0 |
| 2 | `02-eliminated-*` | Regular marks only (W W L W W W); the bracket message card | `eliminated` | 24.0 · 24.0 |
| 3 | `03-playoff_live-{17e,17pro}-light.png` | B′: marks for the 6 regular weeks only, no playoff mark, no hairline; the static end dot; "Wild card" in the hero meta and the This week tag with the "Live" chip | `playoff_live` | 24.0 · 24.0 |
| 3 | `03-end-dot-live-vs-playoff-17e.png` | Zoom: live_open's pulsing LiveDot (halo) vs playoff_live's static end dot | crops of 1 and 3 | — |
| 4 | `04-live_open-xl-{17e,17pro}-light.png`, `04-live_open-xl-17e-dark.png` | XL (`accessibility-extra-large`): marks capped at 1.3×, no collisions; the range tabs fit. This week starts below the fold at XL (the spec's fold finding is ruled at Large text, where it is fully visible) | `live_open` | — |
| 4 | `04-live_open-xl-scrolled-{17e,17pro}-light.png` | XL scrolled: the 28 pt scores fit at their full 1.2× cap; the Standings header wraps "Through Week 5 ›" to its own line (fixed in this pass, see below) | same, scrolled | 24.0 |
| 4 | `04-live_open-xxxl-17e-light.png`, `…-xxxl-scrolled-17e-light.png` | XXXL sanity: marks stay capped; the Standings header wraps between words. Rows lose the names at XXXL: unchanged from main (rows untouched) | `live_open`, XXXL | — |
| 5 | `05-xl_million-*` | $1,234,567.80 and +$82,210.20 / +$11,503.30 fit; 28 pt scores | `xl_million` | 24.0 · 24.0 |
| 6 | `06-scrub-and-ranges-17e.mov`, `…-frames.png` | Scrub across weeks: "Week 1 $0.00", "Week 2 +$58.75", "Week 3 −$96.40"… then the live week's days; the 2 pt accent underline moves to the scrubbed week's mark (live dot included). Haptic ticks fire per index change (not visible in video). Then Season → 1W → 1M → Season: marks only in Season | `live_open`; long-press-drag, then the tabs | — |
| 7 | `07-tap-through-17e.mov`, `…-frames.png` | Tap This week → Matchup. League left on Schedule → Home → tap Standings → League on **Standings**. Schedule again → Home → **second** tap on Standings → Standings again (the param is applied, then cleared) | `live_open`, `GAME_SEAM=1` (League's data) | — |
| 8 | `08-pre_draft-scheduled-*` | No "Pre-draft" chip; countdown leads at score.xl; the date at callout 700; pick clock; order line with no dot; Build your queue; the no-buying caption centred under it. Two cards | `pre_draft`, `GAME_SEAM=1`, `DRAFT_START_FIXTURE=scheduled` | 24.0 |
| 8 | `08-pre_draft-no_date-commissioner-*` | Commissioner, no time: "Set draft time" primary, Build your queue secondary, the caption under both | `DRAFT_START_FIXTURE=no_date` | 24.0 |
| 8 | `08-pre_draft_waiting-*` | Waiting for managers: no button, no no-buying line | `pre_draft_waiting`, `scheduled` | 24.0 |
| 8 | `08-renewed_season2_pre_draft-commissioner-17e-light.png` | Renewed Season 2, commissioner: the counts card, then the draft card, then Members | `SHELL_FIXTURE=leagues-renewal`, `RENEWAL_FIXTURE=commissioner`, `pre_draft`, `GAME_SEAM=1`; pill → Summer Cup (pre-draft) | 24.0 · 24.0 |
| 9 | `09-complete-champion-commissioner-*` (+ `-17e-dark`) | One card: 60 pt medallion, the gold wash fading by the middle, hairline, tiles, hairline, "See the final standings ›" row. No filled button: Run it back is the only primary | `complete`, `GAME_SEAM=1` | 24.0 |
| 9 | `09-complete_runner_up-*` | Neutral disc, same structure | `complete_runner_up`, `GAME_SEAM=1` | 24.0 |
| 9 | `09-complete-member-ask_pending-17e-light.png` | Member: the ask ("I'm in") is the only primary | `leagues-renewal`, `RENEWAL_FIXTURE=pending`, `complete`, `GAME_SEAM=1`; pill → Summer Cup (finished) | 24.0 |
| 9 | `09-complete-member-out-17e-light.png` | Member who said I'm out: the GS-14 "You're out" chip | `RENEWAL_FIXTURE=out`, same | 24.0 |
| 10 | `10-drafting_on_clock-*` | Unchanged apart from the gap | `drafting_on_clock` | 24.0 |
| 11 | `11-reduce-motion-17e.mov`, `…-frames.png` | Reduce Motion: the frame after the skeleton already has the line fully drawn (#170 → #174); Season → 1W (#381 → #382) and back (#441 → #442) swap within one frame | `live_open`, Reduce Motion on | — |

## F1 re-check (Design Lead gate on e821bc8e): the range tabs belong to the chart

Before the fix, the tabs floated: marks' glyphs → tab text was 24.3 pt, and underline → This week
was also 24.0. The cause: the 8 pt layout gap sits between BOXES, and both boxes carry empty space
of their own (the chart's strip under the marks, the label's line leading). The fix pulls the tabs
row up (`rangeTabsPullUp`: 16 pt at standard text, 14 pt at the 1.3× cap). The 44 pt hit area stays
on `hitSlop`; on device a tap 10 pt above "1M" (over the chart's strip) and one 14 pt below "1W"
both select the tab.

Re-shot after the fix, measured from pixels (`tabgap.py`: the lowest mark pixel → the first
tab-label pixel; the underline's last row → the card's first row):

| File | Marks → tab text | Underline → This week |
|---|---|---|
| `01-live_open-17e-light.png` | **8.3 pt** (319.3 → 327.7) | **24.0 pt** (343.0 → 367.0) |
| `01-live_open-17pro-light.png` | **8.3 pt** (334.3 → 342.7) | **24.0 pt** (358.0 → 382.0) |
| `04-live_open-xl-17e-light.png` | **8.0 pt** (572.0 → 580.0) | **24.0 pt** (600.0 → 624.0) |

Only these three were re-shot, as asked. The other in-season stills (2, 3, 5, the Dark 1 and 4, and
the XL-scrolled/XXXL ones) and the recordings show the tabs as they were before F1, 16 pt lower.
Nothing else in them changes.

## R-1 check (score shrink)

No shrink, and the two sides are always the same size. Measured on the leading "+" glyph:
- **Large text:** 12.3×13.3 pt in both `live_open` and `xl_million`, on both phones and both sides.
- **XL:** 15.0×16.3 pt on both sides, which is the full 1.2× cap.

So nothing visibly shrinks in either case. This is not an R-1 finding.

## Fixed during the capture pass (in this commit)

- **The Standings header at XL/XXXL.** The new chevron and "Through Week N" ran off the card at XL,
  and at XXXL the caption broke mid-word. The header now wraps: the caption and chevron drop to
  their own line. At Large it is pixel-identical (diffed against the earlier captures on both
  phones).
- **The static end dot was clipped in half** at the chart's right edge. That is pre-existing: the
  circle sits at x = width. Shown in `playoff_live`, `live_closed` and `scored`. The line now ends
  6 pt in (r 4 + its 2 pt stroke), as the board's GainChart pads it. Every still with a chart was
  re-shot after this fix. The three recordings (6, 7, 11) were taken before it; they show the live
  dot, which was never clipped, and the only difference is the line's last point sitting 6 pt
  further left.

## Notes

- **Fixture seams, not product bugs:**
  - Home's Standings reads 4–1 and League's (seam) 4–2; these are two dev fixtures.
  - In 8, the order line says "Sat 6:00 PM" under a Wednesday draft: the order time comes from the
    Home fixture, the start time from the seam.
- **Metro's env reload never unsets a variable**, so a var removed from `.env.local` stays set. This
  surfaced as a "won" capture rendering lost.
  - **Re-shot clean:** every chart still (1–5) and the Dark 1 and 4, with every fixture var written
    explicitly after a `--clear` Metro restart.
  - **Taken earlier, with leftover vars:** rows 8–10 and the Dark 9 still had earlier rows' vars
    set (`GAME_SEAM=1`, `DRAFT_START_FIXTURE`, `RENEWAL_FIXTURE`). Their content matches each
    fixture as named.
  - **Clean before any var was set:** `pre_season`, and the original first `scored_won`.

  Worth adding to MOBILE_SIMULATOR.md.
- **Videos** are re-encoded to 390×844 at ~280 kb/s (AVAssetWriter) to keep the repo light.
  The full-resolution frames are the `-frames.png` sheets.
