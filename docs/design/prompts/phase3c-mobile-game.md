# Phase 3c worker prompt: mobile Matchup, League and the draft room (`ui/mobile-game`)

> **v2, Design Lead, 2026-09-30.** This replaces the 2026-09-26 draft, which predates the key-screens board, the Light/Dark themes (§9A: there is no "game surface" any more) and every ruling since 2026-09-29.
>
> **Runs in parallel with 3e** (`ui/mobile-money`; disjoint screens). Both target the **1.2.0** TestFlight build, which ships every tab on the new design with no placeholder tabs.
>
> **Starts when** `ui/mobile-home` (3b-2) is merged. Branch off `main` after that merge, and reuse its modules (see "Shared code").
>
> **Visual source of truth:** the key-screens board, `docs/design/screens/key-screens.html`. Its sections are key screens **2 Matchup**, **3 League standings** and **4 Draft room**, and Part 2 › **"Matchups, draft and playoffs" (3c)** with all its figures and notes.
>
> Plan on Opus, build on Sonnet.

---

You are the UI worker for **Phase 3c: the competitive screens**. Your branch is `ui/mobile-game`. You report to `Orchestrator` and `Design Lead` via `SendMessage`.

**The bar.** "Would this impress on first use next to Sleeper, Robinhood, Revolut or Arc?", not "is it correct". Correctness, honesty, tokens, contrast and Reduce Motion are **table stakes, not the goal**. This is the phase where the game earns its name, so the **signature moments** below are **required**, each with a Reduce Motion version and a recording.

**Copy.** Keep existing strings and Giorgio's copy **verbatim**. New copy comes from the board, where it is marked "new copy". Take text from **inside the phone frames**, never from a figure's caption under it: in 3b-2, captions like "Before the draft" were mistaken for on-screen copy. Propose other wording; don't make it. Keep all strings in one module (e.g. `lib/game/gameCopy.ts`), the way 3b-2 did with `homeCopy.ts`.

## Read first

- `CLAUDE.md`:
  - the partial-state family ("Guards keyed on ALL-OR-NOTHING state");
  - "Success signals are unreliable";
  - "Overloaded NULLs";
  - the styles-at-bottom ESLint rule;
  - "UI entry points: MOUNTED and REACHABLE".
- `docs/STATUS.md`, especially item 22 (draft order modes: **the UI is yours**) and the week-window work.
- `docs/audits/2026-09-30-week-window-audit.md`: **U1 is yours** (below).
- `docs/design/DESIGN_DIRECTION.md`:
  - §3 (IA; the League tab becomes the draft-room entry while pre-draft/drafting);
  - §4/§5 (motion law, `motion.stagger`, Reduce Motion);
  - §9 and **§9A** (one design, two themes; `<Card variant="scoreboard">`; `spring.lively` only on scoreboard components).
- The merged 3b-2 prompt (`phase3b2-mobile-home.md`), and its review log `~/fantasy-stock-design-review/ui-mobile-home/DESIGN-REVIEW.md`. **Every finding there is a rule here.**
- Memory-backed rules, also restated below: `product-rules-2026-09-29`, `hermes-intl-formattoparts`, `week-window-scoring-2026-09-30`.

## Rulings in force (don't reopen them without Giorgio)

- **Dollars decide.** Dollar gain decides every matchup and percent is the tiebreak, both through the one score-display helper. The scoreboard shows the lead in dollars, with the tiebreak small beside it.
- **Standings = SQL `league_standings_ranked`, only.** Win % = (W + 0.5·T)/GP, then balanced head-to-head, then season gain, then join order. **Never re-sort on the client.** The same order is the playoff seeding. The column is **"Season gain"**: the sum of scored **regular-season** weekly gains (`points_for`; the server adds no playoff games to it), not Portfolio's "since the draft". Home's hero and every other "season gain" must be this same number. During and after the playoffs it stays at the final regular-season total, and playoff scores live on the playoff cards.
- **Regular-season byes are NO RESULT.** They don't count as W or L and they're left out of games played. A bye shows as a neutral "Bye" chip, never W/L.
- **Flexible playoffs.**
  - P is anywhere from 2 to the number of managers; W = ceil(log2 P); first-round byes = 2^W − P, to the top seeds; the bracket is fixed.
  - Round names: **Final / Semifinals / Quarterfinals / Round of 16**; a first round with byes is **Wild card**.
  - A bye seed has **no round-1 row** and sits in its round-2 row from the start (`20261012000001`).
  - Reuse `lib/playoffs.ts` and 3b-2's playoff classification; don't re-derive them.
- **Draft order modes (STATUS item 22).** Random or Manual, both FINAL at T−1h.
  - The order is set at the LATER of T−1h and the league reaching 4 managers.
  - While Manual is unsaved, joiners land in a random slot; after it's set, joiners pick last.
  - "Order set" push + in-app card.
  - Backend: `get_draft_order`, `set_draft_order`, `league_draft_order(_meta)`.
  - UI: the mode picker, the **Arrange order** editor (drag; read-only once final), the lobby reveal, the in-app card, and Start draft's gates (fewer than 4 managers; P > managers).
- **Pick clock, queue and auto-pick.**
  - The clock is 60s by default, 30–90s set by the commissioner (`leagues.pick_seconds`, `get_draft_clock`).
  - The queue uses `set_draft_queue`.
  - On timeout the server auto-picks: the manager's queue first, then the largest market cap that fits the rules. It never breaks them.
  - An auto-pick is **never hidden**: a banner, an **Auto** badge on the board cell, and pick-log lines by `drafts.pick_source` (`auto_queue` → "Auto-picked · from their queue", `auto_best` → "Auto-picked · best available", as on the board; `auto_skip` shows as a skip).
  - "Leaving is fine" copy (board), with no "don't leave" warnings.
- **Bots are marked** wherever a name renders, driven by `is_bot` (`get_league_display_names`), never by parsing ids.
- **Uneven-bye heads-up.** A short inline notice on Create league (weeks) and on the Start draft confirm, informational only.

## Hard rules from 3b-2 (each one cost a review round there)

1. **Times and windows.**
   - **Displayed** times and **UI phase windows** come from the **market calendar**: `market_session_status` / `market_calendar`, via 3b-2's `lib/home/marketWeek.ts` (`resolveWeekWindow`). All times are shown in ET.
   - The **SCORING window** is the stored `matchups.week_start`/`week_end`, which is what the server scores (server parity). Use it only to IDENTIFY a week and for scoring math, **never** to print a time or decide what the screen says. Those columns are fixed-UTC and nominally start on Tuesday (`_shared/schedule.ts`).
2. **Numbers are real or absent, never fabricated.**
   - No cosmetic ramps or interpolated "daily" points.
   - No "today" on a non-trading day.
   - No part that defaults to 0 when data is missing.
   - A missing price counts **at cost**, with the approved caption (`plCoverage.ts`: "N holding(s) counted at cost (no live price yet)").
   - No percentage may sit inside what an at-cost caption claims to cover. The live score EXCLUDES an unpriced symbol, which is the same in dollars but not in percent.
3. **Hermes.** When you ask `formatToParts` for an hour, pin `hourCycle: 'h23'` (or `hour12: false`) and VALIDATE that every part you read exists. Never default a missing part to `'0'`. Use `lib/time/etParts.ts`. Any timezone logic that decides screen state needs a simulator probe, not just Deno.
4. **Fixtures are derived, not typed.**
   - Weeks, records, standings and playoff weeks (= numWeeks + round) are computed from one fixture league with 6 managers, like the board's Stock Scudetto.
   - Playoff data has the real backend shape: no round-1 row for a bye seed.
   - Match the board's canonical numbers (`data.js`) wherever a screen mirrors one.
5. **Fix everything, then shoot once.** No capture pass while known issues are open.
6. **A visible product decision that isn't ruled goes to Giorgio as a board "Your call" mockup BEFORE "go".** Ask the Design Lead; don't invent it.

## Craft floor (DESIGN_DIRECTION §9B + §4 "Motion craft"; adopted 2026-10-05)

These apply to every screen you build. They are new since this prompt was first written, so audit your existing work against them too.
- **Icons:** the `sp` icon set only. Replace any Unicode or emoji glyph used as an icon in your screens (ⓘ, ▲/▼, ✓, ›, →, ●-as-text) with a drawn icon or shape. Add missing icons to the set through the Design Lead.
- **Hit areas:** ≥ 44 × 44 pt for everything tappable, **including text links** ("Nudge again · Remove", "Change", "Share", "See the bracket", "Go to the draft lobby", the standings rows that open a profile). Use padding or `hitSlop`, and report how you verified it.
- **11 pt text floor:** chips, tags, badges, cell numbers and tab labels included.
- **Motion craft:**
  - one authored moment per screen, with a one-line motion thesis in your PLAN;
  - every animation passes "what's lost if it's removed?";
  - exit is faster than entrance;
  - content is visible at rest (an animation that doesn't run never hides content);
  - the live dot and any pulse pause when the screen isn't focused or the app is backgrounded.
- **Gestures:** never disable edge-swipe back. Sheets swipe to dismiss with Cancel/Done. Destructive confirms use a native action sheet whose button names the action (never Yes/No/OK).
- **Copy:** confirm buttons name the action; every message is a whole sentence (no stitched fragments); errors say what failed and how to recover, never a raw code.
- **Tags** must carry information and never repeat an adjacent chip or title.
- **Colour is never the only code:** every colour signal has a text, sign or shape twin and a VoiceOver label.
- **≤ 4 visible choices** at a decision point, with one primary action (check Start the draft, the settings review and the draft-room search).
- **Stress fixture** (captured): a 20-character username and a 40-character league name; values and losses ≥ $1,000,000; 16 managers (standings, the snake board, Who's running back), a 14-week schedule plus 4 playoff weeks; offline/slow (a stale-data state); a `rate_limited` refusal.
- **Phone only for 1.2.0** (iPad support is off; no tablet layouts).

## Shared code and ownership

- **Reuse 3b-2's modules; don't copy them:**
  - `lib/home/liveWeekScore.ts` (THE live score; Matchup must produce the same number as Home's this-week card);
  - `marketWeek.ts`, `lib/time/etParts.ts`, `ordinal.ts`, `lib/playoffs.ts`;
  - `seasonGain*`, `teamValue`, `todayChange`;
  - the `homeCopy.ts` pattern.
- **3c OWNS every `lib/` move.** For example, promote `liveWeekScore`, `marketWeek` and `ordinal` from `lib/home/` to a shared `lib/game/` or `lib/time/` once both Home and Matchup use them. Do the move in one commit, update every import and keep the tests green.
- **3e owns** the trade and portfolio primitives. Neither phase edits the other's screens.
- Any change to shared primitives (tokens, `Card`, `ShellHeader`, `PhaseChip`, `sp/*`) goes through the Design Lead first. Tell the Orchestrator so 3e can rebase.
- **U1 is yours.** `weekStatus.getSeasonPhase` / `getUpcomingMatchupLabel` say week 1 "starts Tue" and treat Monday as pre-season, so Monday roster moves land in an unscored gap. Derive the boundary from week 1's first calendar open (`T0`), as the Home ruling does.
  - `canTradeInPhase` reads this too, and **3e's trade gate depends on your fix**. Land it early, as its own commit, and tell the Orchestrator.

## Screens: build each to its board screen

| # | Screen | Board | Notes |
|---|---|---|---|
| 1 | **Matchup, live** | key screen 2 (live) | `<Card variant="scoreboard">`: both names + avatars, both scores (`Scores`, one shared size), `Tug`, the lead in dollars with the tiebreak small, "Ends Fri 4:00 PM ET" (calendar). **Race chart** (Mon–Fri closes + the live point, you vs opponent): real daily closes from `historical-bars` × each side's week snapshots; no interpolation. **Chyron:** names what just moved the game ("NVDA +2.9% puts Roberto B. ahead"), at most one per 30s, announced to VoiceOver. **Both lineups:** each stock's dollar contribution this week; the rows **sum to the score exactly** (the ledger rule). A ticker tap opens 3e's stock sheet (a stub route until 3e merges). |
| 2 | **Matchup, final** | key screen 2 (final) | The winner banner, the new record and next week's opponent. "Scoring…" until both gains post; nothing reads final before it is. |
| 3 | Matchup, market closed / scoring / pre-season / bye / playoffs | "Matchup before the season", plus 3b-2's phase set | The same `homePhase` states as Home, applied to Matchup. Pre-season shows the week-1 opponent with $0.00 grey and no leader. The playoff tag carries the round. A bye has no scoreboard. |
| 4 | **All matchups this week** | "All matchups" | A segmented control "Mine / League"; compact scoreboards, yours marked. |
| 5 | **The Friday reveal** | key screen 2, "Final whistle" | Plays the first time you open a matchup after it goes final, **once per matchup-week** (persisted), and never blocks input. |
| 6 | **League standings** | key screen 3 | A broadcast table: rank, ▲/▼ since last week, name (+ Bot badge), W–L(–T), Season gain; you highlighted; Week N results underneath. Medal colours only after the season completes. The order comes from `league_standings_ranked`. The ▲/▼ moves compare against last week's order from the same RPC, not a client sort. |
| 7 | **Playoff bracket** | "Playoff bracket · 4 teams" / "· 6 teams" | Round names; bye seeds shown advancing; the explanatory line under the bracket (new copy). |
| 8 | **Draft lobby** + order reveal / waiting | "Draft lobby · order revealed" / "· still waiting" | The countdown, who's in the room, your queue, "Draft order · waiting" (3 of 4) and the in-app "Draft order set" card. |
| 9 | **Arrange order** (commissioner, Manual) + final (read-only) | "Arrange order", "Draft order · final" | Drag to reorder; starts from a random order, never commissioner-first; the mode can be switched until T−1h; read-only once final. |
| 10 | **Start the draft** confirm | "Start the draft" + "not enough managers" + "too many playoff teams" | The uneven-bye heads-up; P > managers fixed right there (Start stays disabled until it fits); fewer than 4 managers offers the invite code. |
| 11 | **Draft room** | key screen 4 + "Draft room · auto-picks" | The on-the-clock ring (the league's clock), the snake board with its track, search + queue, one-tap Draft, the roster filling slot by slot, the auto-pick banner, the Auto badge and pick log. Keep the finalize-heal behaviour (PR #20) untouched. |
| 12 | **Create league · Season / Draft steps** | "Create league · Season", key screen 4 "Draft step" | Weeks with the uneven-bye heads-up, playoff teams (2..expected size), pick clock 30–90s, draft order mode. |
| 13 | **Draft recap** | "Draft recap" | Under League › History after the draft: your picks ranked by how they've done since. |

Keep **League settings** reachable from the League tab, as today. **Remove its "Start new season" button:** `start_new_league_season` is revoked (phase 0, `5c2175c`) and replaced by Run it back below.

## Run it back (decided by Giorgio, 2026-10-04; all copy approved)

**What it is:** when a season finishes, the commissioner renews the league so the same group plays again. **Board:** section **"Run it back"** (12 frames), plus the note added to Home phases. **Backend:** `feat/run-it-back`, designed in `docs/migrations/RUN_IT_BACK_DESIGN.md` (read §2 and §2.11). Each season is a **new `leagues` row** linked by `previous_league_id`; Season 1 stays frozen and complete.

**Rules (all decided):**
- **Only the commissioner** starts it ("Run it back").
- **Opt-in.** Every Season 1 player is asked, and answers can flip in ↔ out until the draft is set.
- **The commissioner hears every reply** and reconciles. On a non-reply they can **"Nudge again"** (at most once per 24 h) or **"Remove"**.
- **A player who is in goes straight to the read-only list.** Players who are out or haven't answered don't see it (`people[]` is empty for them).
- **The draft can't be set while any reply is pending** (`replies_pending`; the server enforces it too).
- **New players** join by code (up to 16 until the draft) and **see Season 1's history**.
- **Teams start with a NEW draft.** Every setting carries over and is editable on the review. Keepers / keep teams were not chosen.

**Screens (build to the board frames):**

| # | Screen | Board frame | Notes |
|---|---|---|---|
| R1 | Home, season complete (commissioner) | "Home · season complete (commissioner)" | The "Run it back?" card under the champion card ("Season 2" tag, "Run it back?", "Everyone from Season 1 gets asked if they're in. Once you've heard from everyone, you set up the draft.", [Run it back]). Members see the champion card without it. |
| R2 | League tab, season over (commissioner) | "League tab · season over" | Champion banner, the commissioner strip with [Run it back], Season 1 final standings. |
| R3 | The ask: push + card on Home **and** the League tab (every Season 1 player) | "Push · every Season 1 player", "1 · Member" | "Roberto B. is running it back. Are you in?", [I'm out] [I'm in], "You can change your answer until the draft is set." The league sheet and Home find it via the OLD league's `successor_league_id` + `get_renewal_roster(successor).caller_status = 'pending'` (§2.11). |
| R4 | Commissioner: Home while replies come in | "3 · Commissioner: Home" | The counts line, the segmented bar, "Waiting on …", [See who's in]. |
| R5 | **Who's running back** (commissioner) | "4 · Commissioner: League tab, reconcile" | A standings-style list in Season 1 order: **"Running back"** (name bold, accent, ✓), "Out" (muted), "● No reply yet" with "Nudge again · Remove" on the row, then newcomers last with [New] and "Joining". Counts above ("4 running back · 1 new · 1 out · 1 no reply yet"); below, the draft date/order rows disabled with "You can set the draft once everyone has replied. Waiting on …", plus the invite code. |
| R6 | Who's running back (a player who is in) | "4b · A member who said I'm in" | Auto-redirect after "I'm in". The same list read-only, topped by "✓ You're running back · Change". |
| R7 | Clear a non-reply (sheet) | "5 · Clearing a non-reply" | "{name} hasn't replied", the asked/nudged dates, [Nudge again] [Remove], "You can nudge once a day. If you remove {first name}, they're out of Season 2 and get a message saying so." When nudged within 24 h, "Nudge again" is disabled with its reason (`last_nudged_at`). |
| R8 | Season 2 review (commissioner) | "6 · After everyone has replied" | Every Season 1 setting carried over and editable: Who's in, Teams (= in + new, "up to 16"), Draft, Draft order, Pick clock, Season, Playoffs, Stakes. The uneven-bye heads-up when it applies. [Schedule the draft] → `start_renewed_season`. |
| R9 | League tab, Season 2 before the draft | "League tab · Season 2, before the draft" | The Season 1 champion banner (until Season 2's draft), the Season 2 draft card, History. |
| R10 | League › History | "League › History" | Every season in the lineage with its champion and frozen final standings (`get_league_history`); matchups and the draft recap per season. Newcomers see it too. |

**Map the API to the copy, never show raw values:** `group` `'in'|'new'|'out'|'pending'` → "Running back" / "Joining" + [New] / "Out" / "No reply yet".

**Push and notification copy** (the backend's `draft-order-notify` body builder switches on `kind`; send these strings to the backend worker via the Orchestrator):
- `renewal_invite` and `renewal_nudge`: "{commissioner} is running it back. Are you in for Season 2?"
- `renewal_reply`: "{name} is running back for Season 2. {n} running back · {n} out · {n} no reply yet." For an out answer: "{name} is out for Season 2. …" (same counts). This replaces the design doc's older "… is in … 4 in · 1 out · 1 to reply" wording.
- `renewal_removed`: "{commissioner} set up Season 2 of {league} without you." NEW COPY, flagged.
- `season_set`: "Season 2 of {league} is set. The draft is {Sat, Jan 23 · 7:00 PM ET}." NEW COPY, flagged.

**RPCs (from `feat/run-it-back`; the contract summary arrives with its DONE):**
- `renew_league` → `setActiveLeagueId(new_id)` → the commissioner lands on R5;
- `respond_to_renewal`;
- `get_renewal_roster` (counts, `replies_pending`, `caller_status`, `people[]` with `can_nudge`/`can_remove`);
- `nudge_renewal`, `remove_renewal_invitee`, `start_renewed_season`;
- `get_league_history`;
- `get_home_summary`'s new `previous_league_id` / `successor_league_id` / `season_number`.

**Until that branch is DONE, build against fixtures** shaped exactly like §2.4, derived from one fixture (the board's Season 1: Roberto 11–3 … Andrea 3–11; in Roberto/Paolo/Francesco/Gianluigi, out Alessandro, pending Andrea, new Marta C.). Then swap to the live RPCs and run the real-data check below.

**The Home follow-up lives here, in 3c.** R1, R3's Home card and R4 are Home edits. 3b-2 will have merged, so 3c owns these changes to Home's components. Keep them additive (a new card in the season-complete and post-season states), don't restructure 3b-2's Home, and tell the Design Lead if a Home component needs to change shape.

## Backend (check before building; don't assume)

- **Live, use as-is:**
  - `league_standings_ranked`, `get_home_summary`, `get_league_display_names`, `get_season_result` (#11);
  - `get_draft_order` / `set_draft_order`, `get_draft_clock`, `set_draft_queue`;
  - `market_session_status`, `historical-bars`, `quote`/`ticker-quotes`;
  - `validate-and-record-pick`, `draft-control`;
  - the draft recap read (#9: picks readable by members).
- **Open:**
  - #4 (intraday samples) is NOT needed: the race chart uses daily closes plus the live point.
  - #10 (scoring status) is derived: gains NULL after the week's calendar close means "Scoring…", as in 3b-2.
- **The auto-pick cron is still deferred** (STATUS §4 item 19), so in production an overdue turn is picked by the sweep only once it's promoted. The UI must read the clock's `deadline` from `get_draft_clock` and never assume a pick happened. Show "Auto-picking…" past the deadline until the pick row arrives.
- A **new RPC** needs a plan-first message to the Orchestrator and uses migration range **`20261025000000`–`20261025000009`**. **These timestamps are PROVISIONAL:** right before release, any migration you add is re-stamped later than prod's latest applied migration (`supabase db push` refuses older unapplied files). Don't depend on the exact number.

## Motion and signature moments

| Moment | Spec | Reduce Motion |
|---|---|---|
| **G1 Live scoreboard** | Per-digit rolls on each quote refresh (`ScoreDigits`), `Tug` on `spring.lively`, the live dot as the only loop | Instant swap; tug static at its ratio |
| **G2 Lead change** | Chyron slides in (`base`), the tug crosses centre with `spring.lively` overshoot, a score slam (1.08→1, `base`), one light haptic; at most one per 30s | Values set; chyron appears in place; no haptic |
| **G3 Friday reveal** | Scores roll to the close, chip Live→Final, the tug settles, the winner banner rises (`slow`); on a win one refined celebratory beat (≤ 1.2s total). Once per matchup-week; never blocks input | A static Won/Lost banner |
| **G4 Standings re-sort** | FLIP rows to their new ranks (`slow`, `settle`), rows visibly slide past each other, then the ▲/▼ badges pop; stagger via `useMotion().stagger` | Rows jump; badges appear without scaling |
| **G5 Draft pick** | The chosen ticker flies from search into its board cell, the track extends to the next pick, the ring hands over, the roster slot fills; your turn gives a pulse + haptic; the last 10s turn the ring loss-red | Appears in place; no pulse |
| **G6 Order reveal** | At T−1h (or on reaching 4 managers) the lobby's order resolves seat by seat (stagger), your slot is highlighted, and "You pick 4th, then 13th…" writes in | Instant, final order |
| Errors / refusals | Appear **instantly** (§4) | same |

`spring.lively` is allowed only in G1/G2/G5 (scoreboard and draft components).

## Accessibility

- At XL:
  - nothing clips or truncates;
  - money never wraps;
  - the standings table keeps rank, name and Season gain visible (reflow secondary columns under the name);
  - the snake board scrolls horizontally with the on-the-clock cell kept in view.
- VoiceOver:
  - the scoreboard is one element ("Week 6, live. You +$213.60, Gianluigi B. +$90.44. You lead by $123.16. Ends Friday 4 PM Eastern.");
  - the chyron is announced;
  - standings rows read "rank, name, record, season gain, up N";
  - draft cells read "Round 2, pick 11, Roberto B., NVDA, auto-picked from queue".
- Contrast test passes in both themes; report any new pair.

## Verify, then report DONE (captures in `~/fantasy-stock-design-review/ui-mobile-game/`)

- **Checks:**
  - `npx tsc --noEmit` (baseline 1);
  - `npm run lint` (0 errors);
  - the deno suites, plus new tests for: the phase → state mapping for Matchup; lead-change detection with the 30s limit; reveal-once persistence; U1 (week-1 Monday = live after T0; a holiday Monday); the ▲/▼ movement against the previous week's RPC order; the auto-pick log line per `pick_source`; the "Auto-picking…" past-deadline state;
  - Run it back: the `group` → copy map; R5's draft rows disabled exactly while `replies_pending`; the 24 h nudge disable; the in → out flip removing the list (R6 → the ask card); the redirect after "I'm in";
  - the contrast test;
  - `node scripts/gen-architecture.mjs` (you touch `.rpc`/`.from`).
  - Report the counts and the **request count on load** per screen (Matchup live ≤ 5).
- **Captures** (dev fixture for states you can't reach live; say which):
  - every row of the screens table, in Light AND Dark, full length;
  - XL on the 17e (Light): Matchup live, standings, the draft room, Start draft.
- **Recordings, Reduce Motion OFF:** G1–G6. Plus one combined Reduce-Motion-ON clip.
- **Real data, Giorgio signed in:**
  - the honesty check: Matchup's live score = Home's this-week score, and the lineup rows sum to the score, on a real league;
  - a real draft in a bot-filled test league: the clock, a queue auto-pick and the Auto badge.
- **Copy audit:** every string marked *verbatim (existing)*, *verbatim (Giorgio)*, *board* or *new, flagged*.

## DESIGN-APPROVED criteria

1. Every screen matches its board screen in both themes. Off-board states are built from board parts, with their copy flagged.
2. Matchup = Home: the same live score from one helper, lineups sum to the score, and it's at least as strong as the board's scoreboard.
3. Every phase is honest: no leader before games, nothing final before it posts, the season result stated plainly, and byes as no result.
4. Standings come from `league_standings_ranked` untouched, with "Season gain" and medals only at season end.
5. Draft order modes, the clock, the queue and auto-pick all work, and auto-picks are always visible.
6. Times come from the calendar (U1 fixed); no fabricated numbers; Hermes-safe formatting.
7. **All six signature moments (G1–G6) are present, smooth and on-brand**, with their Reduce Motion versions. A missing or timid moment is a DESIGN-CHANGES.
8. Bots are marked everywhere; U+2212 minus; no truncation at XL.
9. Shared-code discipline: no copied modules, `lib/` moves done by you in single commits, no unapproved primitive changes.
10. Run it back R1–R10 match the board, use the approved copy verbatim, map API values to copy, and pass a real-data run once `feat/run-it-back` is live: renew a finished test league, answer from two accounts, nudge, remove, schedule the draft.
11. The craft floor holds: no glyph-icons, 44 pt hit areas verified, the 11 pt floor, the motion-craft lines, the stress fixture captured. The gate report follows UI-UX-PROGRAM's format (specificity, squint, 0–4 scorecard, persona walk, P0–P3).

Report your PLAN first (including your fixture plan and the order you'll land U1 in) and wait for "go".
