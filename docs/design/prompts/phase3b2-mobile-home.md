# Phase 3b-2 worker prompt — Mobile Home dashboard (`ui/mobile-home`)

> Drafted by Design Lead, 2026-09-26. Starts after **3b-1 merges** **and**
> backend asks **#1** (Home summary RPC) and **#2** (display names) have
> landed. Ask **#3 is already met on the client** (`buildPLSeries` /
> `windowPL`, PR #37). This is
> the "architectural rebuild" from `STOCKPILE_UI_OVERHAUL.md`; CLAUDE.md
> notes it's the one job that may justify Fable (session-scoped, not
> security-adjacent). Otherwise plan on Opus, build on Sonnet.

---

You are the UI worker for **Phase 3b-2 · the mobile Home dashboard**, the
cross-league personal overview. Your branch is `ui/mobile-home`. You report
to `Orchestrator` and `Design Lead`.

## Read first

`CLAUDE.md`, `docs/STATUS.md`, the charter contract,
`docs/design/prompts/phase3-plan.md`. `docs/design/DESIGN_DIRECTION.md` **§3
Home, including the "Chart decision (2026-09-26)"** (PR #38): **plot
cumulative gain against a zero baseline, not value**. Also §4, §5, §9.
`docs/design/AUDIT-2026-09.md` §5 "Populated": the staircase chart, the
"+29.29%" basis bug (fixed on branch `fix/mobile-home-pl-partial-basis`, approved, pending merge), the pre-season "This week"
honesty bugs (fixed in #36). `STOCKPILE_UI_OVERHAUL.md` Screen 2 for the
original intent.

## Scope: Home, top to bottom

1. **Header:** greeting + avatar (from 3b-1). Greet by username (ask #6), never
   "Trader".
2. **Hero value:** `Money` at `type.display`, total across leagues, with the
   **cash-flow-adjusted gain** for the selected window beneath it (`sign:
   'always'`, gain/loss colour, zero neutral). Any assumption caption (unpriced
   holdings, incomplete window) keeps the wording approved on `fix/mobile-home-pl-partial-basis`, in `text.secondary`.
   Digit-roll **only on change**, never on first paint.
3. **Performance chart:** **cumulative gain** (value − cost basis + realized) over
   the window, a **zero baseline**, gain colour above and loss colour below, and **no
   jump for deposits** (drafts, joins). An optional small axis marker for
   "joined <league>". Window control: `SegmentedControl` 1W · 1M · Season · All.
   Scrub-to-inspect (press and drag shows the date and gain; light haptic at data
   points). Draws once on first view (`feature`); window changes morph (`base`).
   **Data:** `buildPLSeries` in `apps/mobile/lib/plCoverage.ts` (PR #37) already
   yields per-day `value`, `cost`, `pl` (value − cost), `realized` and `invested`.
   Plot **`pl + realized`**, rebased to 0 at the window start, and take the
   hero's window gain from **`windowPL(start, end)`**, the function the current
   `PerformanceChart` uses, so the chart and the hero share one source. Extend
   these helpers rather than re-deriving the numbers; add deno tests for anything new.
   **Never plot `value`.**
4. **"This week" strip:** a horizontal row of **game-surface** mini
   scoreboards, one per league in `live_open` / `live_closed` / `week_final`
   (from ask #1): league name + week, **both display names** (ask #2), both dollar
   gains, a mini TugBar, and "You lead by $X" / "Priya leads by $X". Pre-season
   and pre-draft leagues show their phase state (PR #36's copy), never a fake
   score. Tapping a card sets the active league and opens Matchup.
5. **Your leagues:** grouped by phase (the same grouping as the league sheet);
   each row shows name, `PhaseChip`, rank ("1st of 4"), record and gain. Tapping a row sets
   the active league and opens League.
6. **Empty / new user:** the 3b-1 `EmptyState` with Create / Join.

## Motion

| Moment | Spec |
|---|---|
| Screen enter | Crossfade + 8px rise, `slow`, `settle` (reduced: crossfade `quick`) |
| Hero number change | Digit roll, `base`, `settle` (reduced: instant swap) |
| Chart first view | Line draws, `feature` (reduced: drawn) |
| Chart window change | Path morph, `base` (reduced: instant) |
| This-week strip | Cards stagger 30ms, max 8, `base`; the TugBar settles with `spring.lively` on first view (reduced: static at the final ratio) |
| Pull to refresh | Native; numbers roll on change |

## Verify, then report DONE

- tsc / lint / deno tests (+ tests for the cumulative-gain transform built on
  `buildPLSeries`: a deposit (draft/buy) produces **no jump**; a realized gain
  persists after a sell; the window's final point equals `windowPL`).
- **Device capture** in the populated account (Giorgio signs in): Home on each
  window; the strip with ≥ 2 live leagues and 1 pre-season league; chart
  scrub mid-drag; an empty account; XL Dynamic Type; **iPhone 17e**.
- **The honesty check, in the report:** for one league, show the chart's final
  point equals the hero's window gain (same number, same basis).
- Recordings: first load, a window change, pull to refresh. Reduce Motion on/off.
- **Architecture map:** you will touch `.rpc` / `.from` call sites, so run
  `node scripts/gen-architecture.mjs` and commit the result.

## DESIGN-APPROVED criteria

1. The chart tells the same story as the hero number (the honesty check passes; no staircase).
2. The "This week" strip is on the game surface, with real names and phase-honest states.
3. Zero is neutral, the minus is U+2212, money never wraps (XL and 17e shots).
4. First paint shows no animated numbers; rolls only on change.
5. Motion from tokens; every reduced-motion row evidenced.
6. One call on load (ask #1), not N+1 (state the request count in the report).

Report your PLAN first and wait for "go".
