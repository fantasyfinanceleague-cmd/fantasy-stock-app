# Phase 3b-2 worker prompt: mobile Home, one league through the season (`ui/mobile-home`)

> **v2, Design Lead, 2026-09-29.** This replaces the 2026-09-26 draft. That draft described a cross-league dashboard (total value across leagues, a "This week" strip, a leagues list), which Giorgio's 2026-09-29 rulings removed: **Home shows the one league picked in the pill** (Concept B), with no cross-league totals.
>
> **Starts when** 3b-1 (`ui/mobile-shell`) is merged **and** decision **D1** below is ruled. Ask **#11** blocks only the season-complete state (see "Backend").
>
> **Visual source of truth:** the key-screens board. The file is `docs/design/screens/key-screens.html`, published as the "Stockpile Key Screens" artifact. Its sections are **Home** (key screen 1) and **Home phases** ("Home through the season", 3b-2).
>
> Plan on Opus, build on Sonnet.

---

You are the UI worker for **Phase 3b-2: mobile Home**. Your branch is `ui/mobile-home`. You report to `Orchestrator` and `Design Lead` via `SendMessage`.

**The bar.** "Would this impress on first use next to Robinhood, Sleeper, Revolut or Arc?", not "is it correct". Correctness, honesty, tokens, contrast and Reduce Motion are **table stakes, not the goal**. Home is the screen people open every day, so the **signature moments** below are **required**, each with a Reduce Motion version and a recording.

**Copy.** Keep existing strings and Giorgio's copy **verbatim**. New copy comes from the board (it is marked "new copy" there). Propose other wording; don't make it. Scoring copy stays generic ("best performance wins"); the numbers come from the shared score-display helper.

## Read first

- `CLAUDE.md`, especially:
  - "Guards keyed on all-or-nothing state" (partial snapshot weeks);
  - "Success signals are unreliable" (verify the data, not the status);
  - the styles-at-bottom ESLint rule and "UI entry points: MOUNTED and REACHABLE".
- `docs/STATUS.md`.
- `docs/design/DESIGN_DIRECTION.md`:
  - §3 Home, including the **chart decision** (a zero baseline, no jump for deposits);
  - §4 and §5 (motion law, including `motion.stagger`; Reduce Motion);
  - §9 and **§9A** (one design, two themes: `<Card variant="scoreboard">` replaces every "game surface").
- **The board:**
  - key screen **Home**, and its **ledger** row "Home (this league)";
  - **Home phases**, all seven screens and the four group notes;
  - `docs/design/screens/screens.jsx` (`HomeScreen`, `ThisWeekCard`, `GainChart`, `Roll`, `Scores`, `Tug`);
  - `docs/design/screens/inventory.jsx` (`HomePreDraft`, `OrderWaiting`, `HomeDrafting`, `HomePreSeason`, `HomeClosed`, `HomeScoring`, `HomeComplete`);
  - `docs/design/screens/data.js` (canonical sample data).
- **The 3b-1 shell as merged:**
  - the Home header (pill "+N" plus avatar, **no** phase chip);
  - the league sheet, S3 (sheet → pill) and S5 (bars pull to refresh);
  - the carded `EmptyState` for Home with no leagues, which stays as is.
- **Existing data code:**
  - `lib/useHomeData.ts`: it fans out across every league and is replaced;
  - `lib/plCoverage.ts` (`buildPLSeries`, `windowPL`, `matchupCardPL`);
  - `lib/useHistoricalPL.ts`, `lib/weekStatus.ts`, `lib/marketHours.ts`;
  - the live-score path in `app/(tabs)/matchup.tsx` (`week_snapshots` plus quotes).

## Home = the selected league, in every phase

The header comes from 3b-1: the pill with "+N" and the avatar, with no chip. The body is **one hero card that says what happens next and when**, keyed by the league's phase. **Nothing on Home guesses the phase on its own:** there is one `homePhase(league, summary, clock, calendar)` function with deno tests, and every state below reads it.

| # | State | Board | Contents (board copy verbatim) |
|---|---|---|---|
| 1 | **Live, market open** | Home (key screen 1) | 1. **Hero:** "Your team", then rank · record · "Week N of M", the value, and the gain line (see D1) plus "today".<br>2. **This-week card** (`<Card variant="scoreboard">`): "You" / "vs {opponent}", both dollar scores (`Scores`, one shared size), `Tug`, "You lead by / You trail by $X", "Ends Fri 4:00 PM ET".<br>3. **Season card:** the chart, W1…W(N−1) result chips plus a live chip for the current week, and a `SegmentedControl` 1W · 1M · Season.<br>4. **Standings card:** the top 3 plus your row if you're outside it, "Through Week N−1", "Season gain" column. |
| 2 | **Live, market closed** (nights, weekends, holidays) | "Market closed" | Scores frozen at the last close: "…at Thursday's close", "Resumes Fri 9:30 AM ET" from the **market calendar** (ask #7, live), never a weekday rule. The chip reads "Market closed". |
| 3 | **Week final, scoring** (Fri after 4 PM until results post) | "Week final, scoring" | Skeleton scores plus "Scoring… Results post a few minutes after Friday's close." **Nothing is shown as final before `team1_gain` / `team2_gain` are non-null for your matchup.** Derive this from the matchup row, not the clock alone. |
| 4 | **Week final, scored** (results posted, until Monday's open) | *not on the board* | The live card's layout with the "Final" chip, both final scores, the result line ("You win Week 6", as on onboarding card 3, or "{opponent} wins Week 6") and "Week 7 starts Mon 9:30 AM ET". **New copy: flag it.** I'll add it to the board; build it from existing parts. |
| 5 | **Before the season** | "Before the season" | Zero is grey, never green; "No leader yet. Scoring starts at Monday's open." |
| 6 | **Before the draft** + **waiting for managers** | "Before the draft" (both) | The countdown, "60-second picks · 6 rounds" (from `pick_seconds`), the draft-order line from `get_draft_order`, members (from display names, with bots marked), the invite code + Share, and "Build your queue". The waiting variant uses `OrderWaiting` (new copy on the board). |
| 7 | **Drafting** | "Draft in progress" | From `get_draft_clock`: "You're on the clock" / "Round R · Pick P · 0:42 left" and "Go to the draft room". When it isn't your turn: "Round R · Pick P · you're up in K picks" (**new copy: flag it**). Plus "Your team so far". |
| 8 | **Season complete** | "Season complete" | The champion / final-rank card and the stats grid. Needs ask **#11**, see "Backend". |
| 9 | **Bye week** (regular season) | *not on the board* | A bye is **no result** (ruling 2026-09-29): the card says "No matchup this week" and "Week N+1 starts Mon 9:30 AM ET". **New copy: flag it.** No score and no tug. |
| 10 | **Playoffs** | *not on the board* | The this-week card's tag becomes the round name from `playoffLine` / `playoffPlan` ("Wild card", "Semifinals", "Final"). A first-round bye shows "Bye to the Semifinals". Eliminated shows "Out in the Semifinals" plus "See the bracket". **New copy: flag it.** |

**No leagues:** keep the 3b-1 carded EmptyState. **Switching league** in the pill swaps all of Home (see the motion table: it crossfades and never rolls).

## The numbers: one source per number, and the chart matches the hero

- **Live week score (you and the opponent):** extract the live-score math that `matchup.tsx` runs today (Monday `week_snapshots` × quotes, mid-week buys from their entry, the `entered_mid_week` flag) into **one** pure helper, e.g. `liveWeekScore(snapshots, trades, prices)`. Home and Matchup both call it, and 3c will reuse it. Add deno tests, including a user with SOME mid-week buys (CLAUDE.md's partial-state family). The old Home comment "opponent portfolio not accessible client-side" is wrong: Matchup already reads it.
- **Rank, record, season gain:** from `get_home_summary` / `league_standings_ranked`. **Never re-sort on the client.**
- **"Today":** Σ qty × (price − `prevClose`) from the quotes. A position bought today counts from its entry price. Hide it on non-trading days.
- **The season chart plots the scored season, not mark-to-market** (subject to D1). Build a new pure transform, e.g. `buildSeasonGainSeries`:
  1. For each trading day in week *w*, the point is Σ scored gains of weeks < *w* plus week *w*'s gain at that day's close. Use the week's `week_snapshots` quantities and `week_start_price`, and daily closes from `historical-bars`.
  2. Weekends and holidays are flat. The draft and pre-season sit at 0, with no jump.
  3. **Pin each completed week's Friday point to its scored gain** from `matchups` (the source of truth). If the bar-derived close differs by more than $0.01, count it and report the count. Don't hide it.
  4. The last point is the live hero number.

  Windows:
  - **1W** is this week, from Monday's open; its endpoint must equal the this-week card's score.
  - **1M** is rebased to 0 at the window start.
  - **Season** starts at Week 1's open.

  `buildPLSeries` / `windowPL` stay mark-to-market for Portfolio (3e); Home does not plot them. **Never plot value.**
- **The honesty check (in the report, on real data):** the Season endpoint equals the hero's gain; the 1W endpoint equals the this-week score; the Friday points equal the `matchups` gains; and a table of value, basis, the scored season gain and **their difference**, which is the weekend/overnight drift D1 is about.

## Decision needed before "go": D1 (Giorgio, via the Orchestrator)

The board's ledger reads "Value = Portfolio = $12,343.59" and "Gain since the draft = weeks 1–5 + this week", so on the board **value − basis = the scored season gain**. In production they differ: matchups score Monday open → Friday close, but the portfolio's value also moves overnight and over weekends (Friday close → Monday open), and between the draft and Week 1. So a hero showing "$12,351.20 · +$343.59 since the draft" would invite a subtraction that doesn't work.

**Recommendation:**
- Keep the board's hierarchy: the value stays the big number, because it's what your team is worth.
- Make the gain line **the game number**: the scored weeks plus this week live.
- Relabel it from "since the draft" to **"season gain"**, the same words as the Standings column Giorgio chose. It then reads as a score, not as value − basis.
- The chart plots the same number.

**Alternative:** the hero's big number becomes the season gain, with the value as a secondary line.

Until D1 is ruled, the worker builds with the board's copy behind one string constant, so the ruling is a one-line change. **3e is affected too:** Portfolio's "Gain" is mark-to-market value − cost and stays that way, so Home and Portfolio will show different gains with different labels. The D1 ruling should say that out loud.

## Backend (all live except #11)

- **One call for the header and the sheet:** `get_home_summary()` (#42). It returns every league with its phase, rank, record, the current matchup, both display names, `is_bot` and both scored gains. It feeds the pill, the sheet and Home's headline together. **Replace `useHomeData`'s per-league fan-out.**
- **Per state:**
  - `get_league_display_names` for members and bots;
  - `get_draft_order` for the order state;
  - `get_draft_clock` for the turn and the deadline;
  - the market calendar (#7);
  - the quote / ticker-quotes functions for prices and `prevClose`;
  - `historical-bars` for daily closes;
  - `week_snapshots` and `matchups` for your league, which members can already read.
- **Request budget:** in the live state, at most **5 requests on load**: the summary, the snapshots (both players, this week), the quotes, `matchups` (your rows, all weeks) and the bars (lazy, when the Season card enters the viewport). State the count in the report.
- **Bots:** every place a name renders shows the bot treatment from `is_bot`, never from parsing ids.
- **Ask #11 (season result: final rank, champion, playoff W–L, best week), open.** It blocks state 8 only. If it hasn't landed, ship state 8 in its honest minimum: final rank, record and season gain, which the summary already has, and no champion claim you can't source. "Best pick" is dropped from v1 unless #11 carries it.

## Motion and signature moments

| Moment | Spec | Reduce Motion |
|---|---|---|
| **H1 Hero roll** | The value and the gain roll per changed digit (`Roll`, `base`, `settle`) on each live update, **never on first paint**. The gain line gets one soft tint pulse per change (a one-shot, not a loop). | instant swap |
| **H2 Season chart** | The line draws on first view (`feature`); a window change morphs the path (`base`). While the market is open the endpoint is the **live dot**, the only loop. **Scrub:** press and drag shows a floating label (date · gain), a light haptic tick at each trading day, and the matching week chip highlights. | drawn, instant change; the scrub label still works, no ticks |
| **H3 Live this-week card** | On a quote refresh the scores roll and the `Tug` moves (`spring.lively`). When the leader changes, the lead line crossfades and the card gets one accent wash (`base`). No haptic: it isn't user-initiated. | static at the new ratio, instant text |
| **H4 Enter + stagger** | The hero card rises in (`slow`, 8px, `settle`); the week chips and standings rows use `useMotion().stagger.delayFor(i)` (30ms, max 8). | crossfade `quick`, no stagger |
| **H5 League switch** | After S3 lands the name in the pill, Home crossfades to the new league (`quick`). **Numbers do not roll on a switch**: key `Roll` by league id so a different league's value is never presented as a change. | instant |
| **H6 Phase moments** | A phase change (e.g. scoring → scored) swaps the card in with a crossfade and 8px rise. Season complete: the trophy springs in once (`spring.lively`) with one glow sweep, **once per season** (a flag stored on the device). | static |
| Pull to refresh | S5 bars from 3b-1; numbers roll only where they changed | as 3b-1 |
| Error / stale data | Appears **instantly** (§4): no fade, no shake | same |

**Card → Matchup shared element** is **deferred to 3c**: Matchup is still a placeholder. In 3b-2, tapping the this-week card switches to the Matchup tab normally. Tag the score and name elements with stable shared IDs so 3c can connect them.

## Carry-overs from the 3b-1 review (required)

1. **Header height at XL:** on the 17e at Accessibility XL, the pill wraps the league name onto two lines. That's correct: never truncate. Home's content must start below the real header height (measure it, don't hard-code it), so nothing overlaps or jumps when the pill wraps. Capture it.
2. **Profile email at XL:** allow character wrapping on the email value only (it's one unbreakable string), and keep the stacked label/value layout. Capture 17e XL.
3. **Light-theme chip contrast:** the header phase chip's sunken fill is barely visible on the Light page background. On Home, **every chip that sits on the page background** (not inside a card) uses the `--c-surface` fill plus a hairline. Report the pair's contrast in the contrast test. Retrofit the 3b-1 header chip on Matchup, League and Portfolio the same way, and mirror any new pair on the board's PAIRS table (tell me; I'll update the board).

## Accessibility

- At XL:
  - nothing clips or truncates;
  - money never wraps (`tabular-nums`, one shared score size per `Scores`);
  - the chart keeps a 44pt scrub target;
  - the week chips wrap to a second row rather than shrink.
- VoiceOver:
  - the hero reads "Your team, {value}, {gain} {label}";
  - the this-week card reads as one element: "Week 6, live. You {score}, {opponent} {score}. You lead by {margin}. Ends Friday 4 PM Eastern.";
  - the chart has an accessible summary plus an adjustable action that steps through the weeks.
- The contrast test passes in both themes (including the carry-over chip pair).

## Verify, then report DONE (captures go to `~/fantasy-stock-design-review/ui-mobile-home/`)

- **Checks:** `npx tsc --noEmit`, `npm run lint`, and the deno tests: `homePhase` (all ten states, including the boundaries Fri 4:00 PM, results posted, Mon 9:30 AM and a holiday), `liveWeekScore` (including partial mid-week buys) and `buildSeasonGainSeries` (no deposit jump, flat weekends, Friday pinning, endpoint = hero). Also the contrast test and the architecture map (`node scripts/gen-architecture.mjs`; you touch `.rpc` / `.from`). Report the counts.
- **Captures, Light + Dark, standard size:** states 1–10 (use the dev fixture for states you can't reach live, and say which), the chart mid-scrub, and each window.
- **Captures, Accessibility XL, on the 17 Pro and the 17e:** states 1, 3, 6 and 7, plus the carry-overs.
- **Recordings, Reduce Motion OFF and ON:** H1 (a quote refresh), H2 (first view, window changes, scrub), H3 (a leader change: force it with the fixture), H4, H5 (switching between two leagues), H6 (scoring → scored, and the season-complete trophy), and pull to refresh. 60 fps; I review frame by frame.
- **On real data, signed in** (Giorgio signs in; never type credentials): state 1 or 2 in a live league, plus **the honesty check** and the **request count**.
- **Copy audit:** every visible string, marked *verbatim (existing)*, *verbatim (Giorgio)*, *board* or *new, flagged*.

## DESIGN-APPROVED criteria (the review gate)

1. Every state matches its board screen in both themes; the off-board states (4, 9, 10) are built from board parts, with their copy flagged.
2. `homePhase` is the single source of phase; nothing is final before the gains post; zero is grey.
3. **The honesty check passes:** the chart endpoint = the hero, 1W = the this-week score, the Friday points = the `matchups` gains, and the drift table is reported.
4. One live-score helper, shared with Matchup; rank never re-sorted on the client; request budget met.
5. The minus is U+2212, money never wraps, and there is no clip or truncation at XL on the 17e (including the header-height carry-over).
6. First paint shows no rolling numbers; a league switch never rolls.
7. **All six signature moments (H1–H6) are present, smooth and on-brand**, each with its Reduce Motion recording; motion comes from tokens only. A missing or timid moment is a DESIGN-CHANGES.
8. Bots are marked wherever a name renders, driven by `is_bot`.
9. The three 3b-1 carry-overs are done and captured.

Report your PLAN first (including your fixture plan for the states you can't reach live) and wait for "go".
