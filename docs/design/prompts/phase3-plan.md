# Phase 3 plan: order, dependencies, backend asks

> Drafted by Design Lead, 2026-09-26, for the Orchestrator. Drafts only;
> nothing is spawned from here. Giorgio's brief: *"it's not just a basic
> website… it's really high end."* Richer landing motion is approved.
> Reduced-motion fallbacks and **never gating content** are binding. The
> product stays **name-agnostic** (`brand.name`, placeholder "Stockpile"),
> with the refined-bars mark; naming is deferred to pre-launch.

## Order (by first-impression impact)

The Orchestrator's suggested order stands, with **two adjustments**:

1. **3b is split** into **3b-1 Shell + first run** (no backend blockers) and
   **3b-2 Home dashboard** (blocked by asks #1–#2). 3b-1 can start the moment
   the mobile foundation merges, instead of waiting on the backend.
2. **A new 3e, Money screens** (Portfolio, stock-detail sheet, trade flow,
   history). The Portfolio and trade surfaces had no owner in the list, and
   they're where the "calm fintech" register lives.

| # | Phase | Surface | Can start | Prompt |
|---|---|---|---|---|
| 1 | **3a** | Web landing: the showpiece, **live on merge** | **Now** (web foundation merged, PR #35) | `phase3a-landing.md` |
| 2 | **3b-1** | Mobile shell + first run: nav, league pill/sheet, auth, onboarding, empty states, profile | When `ui/foundation-mobile` merges | `phase3b1-mobile-shell.md` |
| 3 | **3b-2** | Mobile Home: the selected league in every phase | After 3b-1 **and** decision D1 (season gain vs value, in the prompt). Asks #1/#2 live; #11 blocks only the season-complete state | `phase3b2-mobile-home.md` (v2) |
| 4 | **3c** | Mobile competitive screens: Matchup, Friday reveal, League/standings, Draft room | After 3b-1; ask #2 blocks, #7 blocks one state | `phase3c-mobile-game.md` |
| 5 | **3e** | Mobile money screens: Portfolio, stock sheet, trade, history | After 3b-1; ask #5 blocks history only | `phase3e-mobile-money.md` |
| 6 | **3d** | Web app pages (still paused) | After 3c/3e settle the patterns | `phase3d-web-app.md` |

3c and 3e can run **in parallel** after 3b-1: they own disjoint screens
(game register vs money register). Nobody edits `constants/tokens/*` or the
foundation primitives except through a proposal to the Design Lead.

## Backend asks → which phase they block

The Orchestrator starts backend workers now. Numbering follows
DESIGN_DIRECTION §7, with #9–#11 added here.

| # | Ask | Blocks | Nice-to-have for | Notes |
|---|---|---|---|---|
| **1** | **Home summary RPC**: one call returning, per league, the phase, rank, record, and this week's matchup (both display names, both dollar gains) | **3b-2** | 3d (web dashboard) | Removes N+1 reads on Home |
| **2** | **Opponent display names** on matchup/standings reads (today "Opponent --", bots as truncated ids) | **3b-2, 3c** | 3d | Includes a display name for bots |
| 3 | Daily value + per-day cost basis (+ realized P/L) series | **✅ MET on the client**: `buildPLSeries` + `windowPL` in `apps/mobile/lib/plCoverage.ts` (PR #37, merged), fed by paginated historical bars (PR #29, deployed). Cumulative gain = `pl + realized` (= value − cost + realized) | 3e (position chart), 3d (port the same logic) | No backend work needed |
| 4 | Intraday value samples per matchup participant | — | 3c (a "momentum" sparkline) | Direction B needs current values only |
| **5** | Trade-history view that **unions draft picks with trades** (text/uuid + numeric casts per CLAUDE.md) | **3e** (history screen) | 3d | |
| **6** | Username captured at signup is persisted (Home greeted "Trader") | **3b-1** (first-run greeting, profile) | — | Verify first; may be a client-only fix |
| **7** | **Market-session status**: open / closed / holiday, plus next open time | **3c** (the `live_closed` state: "Resumes Mon 9:30 AM ET") | 3b-2 | Holidays need data, not a hard-coded weekday rule |
| 8 | Drop "win probability" from the landing mock | — | — | **Not backend**; handled in 3a (no win-prob anywhere) |
| **9** | **Draft recap read**: picks by league with round/pick/owner, readable by league members | **3c** (League → History → Draft recap) | 3d | May already be RLS-readable; verify before building |
| 10 | Weekly **scoring status** per league-week (scoring / final) readable by members | — | 3c (Friday reveal "Scoring…" state) | Could derive from `team1_gain` being non-null; a status row is cleaner |
| 11 | Season result per member (champion / runner-up / final rank) | — | 3c (`season_complete` state; fixes the unexplained "Runner-Up" banner) | |

**Start first:** #2 and #1 (they block 3b-2 and 3c), then #7, #9, #5, #6. #3 is already met (PR #37).

## Shared rules for every Phase 3 worker

- **Ambition bar (2026-09-27):** each phase prompt now lists **signature
  moments**, and the review bar is "would this impress on first use next to
  best-in-class products" (Apple / Stripe / Linear on web; Robinhood / Sleeper /
  Revolut / Arc on mobile). Correctness and performance are table stakes, not the goal.
- **Keep Giorgio's copy verbatim** unless a prompt explicitly changes it;
  propose wording changes, don't make them.
- **Generic scoring copy (Giorgio, 2026-09-27).** Rules, marketing, onboarding,
  empty-state and help copy must hold for **any league setting** (stake modes
  change how much capital each player puts to work, so dollar and percent can
  rank players differently). Say "**best performance** wins the matchup", not
  "best return" or "biggest dollar gain". **Data displays** (scoreboards, lead
  lines, standings) show the metric the scorer actually uses, today dollar
  gain with percent as tiebreak, through **one shared score-display helper**,
  so a future scoring change is a one-place edit. Never hard-code "$" scoring
  language in prose.

- The charter's UI worker contract applies verbatim (branch from `origin/main`,
  `git branch --show-current` before commits, no push/merge/deploy, report
  PLAN → wait for "go" → DONE/BLOCKED to **both** `Orchestrator` and
  `Design Lead`).
- **Tokens and primitives only**: import from the foundation (`apps/web/src/design`,
  mobile `components/sp` + `constants/tokens`). No raw hex, no inline
  durations. Motion comes from `useMotion()`; `spring.lively` only in game components.
- **Surface discipline**: money screens use `Surface kind="money"`, competitive
  screens `kind="game"`. Colours resolve per surface (§9).
- **One lifecycle model**: every surface reads the league phase from the
  shared helper (`getSeasonPhase`, extended); nobody re-derives phase locally.
- **Honest numbers**: zero is never green, the minus is U+2212, money never
  wraps, and there's no win probability without a model.
- **Reduced motion** on every animation (the §5 table), with a recording of
  each in the DONE report.
- **Name-agnostic**: `brand.name` everywhere; no hard-coded product name in
  new code or assets.
- **After merging `origin/main`: restart Metro with `--clear`** (mobile).
- **Evidence** goes in `~/fantasy-stock-design-review/<branch>/`, absolute paths in the report.
