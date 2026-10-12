# Design Lead handoff (2026-10-12)

From the outgoing Design Lead session to the fresh one that runs the visual-language reset
(`docs/plans/2026-10-12-visual-language-reset.md`, on `plan/visual-language-reset`). The
previous handoff is `docs/design/reviews/design-lead-handoff-2026-10-06.md`. Its open gates
have all since been run; what is still open is listed here.

**Read first:**
- `docs/PRODUCT_RULES.md` (Giorgio's rules, verbatim; they beat everything here);
- `docs/design/UX_RULES.md` (the eleven rules);
- `docs/design/FANTASY_CONVENTIONS.md`;
- `docs/design/reviews/ux-audit-2026-10.md` (every finding, ruling, gate and build spec, in date order).

## 1. Approved and shipped

**Release state.** 1.2.0 shipped on TestFlight (build 4) with every tab on the new UI. #217 (Home's
section gap) is live on Giorgio's phone. The calm-Home build (#222) and its gate (#223) are
merged; their OTA follows Giorgio's go.

Board "Decided" sections (`docs/design/screens/`, each with its ruling in the section header):

| Board id | Ruling | Shipped as |
|---|---|---|
| `#call-calm-home` | **A, "same content, calmer"**, all states (Giorgio, 2026-10-12) | #219 board, #222 build, approved @ `dd58a85c` |
| (calm Home, playoffs) | **B′**: the season chart is the regular season only. No playoff slots, marks or hairline; a static end dot in the playoffs (season gain stops moving after the regular season). | #220 |
| (calm Home, build rulings) | Mark spans: previous week's last point → this week's last point. "Live" chip everywhere. No no-buying line in the postponed commissioner state. Past ~23 weeks the letters become 5pt pips with a shape twin (filled W, hollow L, filled grey T, grey dash for a bye). League clears its `segment` param after reading it. | #221 |
| `#call-manager-row` | S-10: one manager row everywhere. Your name is bold with the light blue tint; no "(you)". Gains are coloured by sign; movement arrows on League only. In a bracket, bold means the winner, so you are marked by tint only (R-2). | live |
| `#call-sell-from-search` | **A**: a stock you hold can be sold from any sheet, search included. | live |
| `#call-medals` | **A**: once the season is over, medals follow the playoffs (champion, runner-up, better-seeded semifinal loser); records stay the regular season's. | live |
| `#call-watchlist` | **C + a–d**: Watchlist tab in Buy a stock, plus "Watching" on Portfolio; claims while closed. **Home hook still open** (see §2). | planned (plan 2026-10-08) |
| `#call-join-commissioner` | **A**: the Join preview names nobody, not even the commissioner. | live |
| `#call-leaver-names` | **A + frozen**: leavers stay named in past seasons, frozen as they were when they left; no "Former manager". | live |
| `#call-leave`, `#call-auto-start`, `#call-tier-trades` | Decided earlier (see the 2026-10-06 handoff). | live |

**The calm Home, in one line:**
- the season chart sits under the hero with no card;
- W/L marks on its axis, and text range tabs 8pt under the marks;
- one big number (the team value);
- This week (28pt scores, "Live") → Matchup;
- Standings → League › Standings;
- a 24pt block gap;
- one primary per state.

The build spec is in the audit ("Build spec · a calmer Home").

## 2. Open, by priority

**P2**
- **Standings names truncate at XL** ("P…", "R…"), on Home's excerpt and League's table. Fix:
  wrap a row onto two lines (name, then record and gain) at font scale ≥ XL.
- **R-1:** the This week scoreboard should share one fit for both scores (`Scores`,
  `screens.jsx:122`, floored at `score.lg`). It's not built. At 28pt on the calm Home no shrink
  was measured, so it's a condition, not a defect: if either score ever shrinks alone, R-1 is due.
- **GS-6:** League › Playoffs draws the byes in their own card under a duplicate round heading.
  Fix: byes become rows of their round.
- **GS-7:** the finished bracket doesn't mark the champion. Fix: one row under the Final, trophy +
  "{name} · Champion".
- **GS-9:** All matchups paints the left side blue in games you're not in. Fix: neutral bars,
  same-colour names. The board has the same error.
- **GS-12:** the league sheet lists Season 2 as plain "Summer Cup · Pre-draft". Fix: "Summer Cup
  · Season 2 · Pre-draft".
- **GS-13:** in the renewal review, the "Teams" sub-line indents under the value column. Fix: put
  it under the label, full width.

**P3**
- The member's Run it back ask uses compact left-aligned pills; the board draws two equal-width
  buttons.
- Scrubbing the season chart's first point reads "Week 1 · $0.00". Make it read the draft day,
  or make it unscrubbable.
- Matchup's `segment: 'all'` param is read once and never cleared, so a repeat push doesn't
  re-select. Fix it the way League's was fixed.
- Home's load-error state renders `PhasePlaceholder` (with its own pull-to-refresh) inside
  Home's `BarsRefresh`: a nested scroll view.

**Open design question**
- **The watchlist's Home hook.** UX rule 10 says pending claims surface on Home. The board's
  `HomeClaimsHook` frame predates the calm Home. When claims are built, the hook must fit the
  calm structure: one quiet tappable row or card under This week, not a fourth heavy card.

**The defect Giorgio just hit (Matchup, 1.2.x)**
- **What he sees:** on day 1 of a week, `WeekRace` (`components/game/WeekRace.tsx`, layout in
  `lib/game/weekRace.ts` / `raceLayout.ts`) shows only the Mon–Fri labels and an empty frame.
- **Cause (checked in code):** `weekRacePoints` emits one point per closed trading day only. It
  has no week-open point at $0 and no live "now" point, both of which the board's `WeekRace`
  (`screens.jsx`) draws. `WeekRace.tsx` draws a line only when it has more than one point. So on
  day 1 there are zero points before the close and one after it, and nothing draws.
- **Status:** a 1.2.x fix is queued separately. The reset will redesign Matchup anyway; carry
  the lesson: **every chart needs a designed state for 0 and 1 data points.**

## 3. The board

- **Where it lives:** `docs/design/screens/` is the visual truth. `README.md` lists the files.
  The newest section, `home-calm.jsx`, is its own file: it defines `window.KSHomeCalm`, which
  `board.jsx` renders FIRST (before Themes), and `index.html` inlines it after
  `inventory-board.jsx`.
- **Build:** run `node docs/design/screens/build.mjs`, which writes `key-screens.html`. **Never
  hand-edit `key-screens.html`.**
  - `build.mjs` only concatenates; it does not parse JSX. "It built" proves nothing. LOAD the
    page in a browser (`python3 -m http.server` in the folder) and check the console for Babel
    errors, in Light and Dark, before committing.
  - Cache-bust reloads (`?v=N`), or you'll be looking at the old build.
- **Merge conflicts:** two board branches that insert at the same anchor (the TOC array in
  `board.jsx`, the `window.KSInventory` export list, the line before a shared section) conflict.
  Git's auto-merge can silently drop one block's tail. Resolve by hand, then load the page.
  Putting a new section in its own file (as `home-calm.jsx` does) avoids most of this.
- **The TOC** is the array in `board.jsx`'s header (`['call-…', 'Label (decided)']`). Mark a
  section "(decided)" in the TOC, its `h2`, its captions (✓ chosen / not chosen) and its
  recommendation box the same day Giorgio rules.
- **Data:** `data.js` is the one dataset; derive every number from it, or caption it "sample".
- **Copy:** Giorgio's words verbatim; every other string flagged NEW; workers copy from inside
  the frames, so explanations go in captions.
- **Full-length frames:** to show a whole scroll, use `Device full`, and draw the fold at 791px
  (874 − the 83px tab bar). `home-calm.jsx` has `FitFull` and `Fold` for this.
- **Screenshots for hand-offs:** Playwright can only write inside the worktree
  (`.playwright-mcp/`). Move the files out and delete that folder before committing. To shoot
  frames at 1:1, override `.b-fit` height to the device height and set `.b-fit__in`'s
  transform to `none`, from a page script.

## 4. The gate (UI-UX-PROGRAM.md, "Design review gate")

Report format:
- the impeccable sections (specificity, squint test, scorecard, persona walk, P0–P3 with a drift
  class);
- the `ux-reviewer` table with an answer to each finding;
- the §9B mechanical checks.

Since 2026-10-12, add **"Block rhythm, measured":** measure the gap between consecutive blocks
in every capture, in points, against the board's token. A flush stack is a finding even when
it "reads as a grouped list".
- **Why this check exists:** #217's bug (every Home section touching) was visible in every Home
  capture from 09-30 on and passed three gates.
- **Measure the elements without edges too** (tabs, captions). The F1 tabs passed the
  card-to-card check yet sat 24pt from both neighbours.

How:
- Decode the PNG with `zlib` (no PIL on this Mac; about 30 lines).
- Find the background colour at a margin column.
- List the runs of non-background rows between two y-values.
- Divide the pixels by 3 to get points.
- Measure yourself; don't accept a worker's number unseen.

Simulator method: `docs/testing/MOBILE_SIMULATOR.md`. The traps that cost time this session:
- **Run from a clean checkout:** a fresh detached worktree with `npm ci` in `apps/mobile`, plus
  `.env` (URL + publishable key) and `.env.local` (fixtures). Delete both when done.
- **Opening the app:** open with the simulator tool's `open_url` only after Metro logs "Waiting
  on". The first open often lands on Expo Go's home screen; open again.
- **Env changes:** a fixture change needs `--clear`. **Metro never unsets a variable you remove
  from `.env.local`**, so write every fixture variable explicitly.
- **Fixture artifacts, not bugs:**
  - a past `draft_date` shows 00:00;
  - a non-15-minute draft time;
  - 4–1 on Home vs 4–2 on League (the seam);
  - a Saturday order line under a Wednesday draft.

## 5. Things not to rediscover

- **A fragment is invisible to layout; a wrapper View is not.** A `gap` on a container spaces
  its host children. Home's sections sit inside `HomeLeagueTransition` (an `Animated.View`), so
  the gap belongs on that wrapper.
- **The season chart is the regular season only** (R3, `chartEndWeek = min(currentWeek,
  numWeeks)`). Season gain is `points_for` and stays at its final regular-season total in the
  playoffs. Don't put playoff results on it, and don't animate its end as live during the
  playoffs.
- **Product-rule collisions are Giorgio's, not findings.** "Team value is the big number" and
  "the Home chart plots season gain, week by week" are his rules. The calm Home kept both.
  Anything in the reset that drops or moves them goes to him as a "Your call".
- **A spec copied from an old component can carry rules that don't fit the new one.** The week
  chips carried the bye-colour rule and the playoff round names. The marks kept the first; the
  second had no home (B′). When a component goes, list its rules and re-home each one
  explicitly.
- **A shortcut you accept needs its undo condition written down** (R-1's "if either score
  shrinks alone").
- **Live cues make claims.** A pulsing dot must follow the value's real state, not the market
  clock.
- **The 17e is 30pt shorter than the 17 Pro.** The calm-Home fold ruling: accept the last
  Standings row at the 17e fold; never compress the chart, the gaps or the type to win it back.
  It is a finding only if This week is cut, or if anything above Standings scrolls on the 17 Pro.
- **Hand-offs:** SendMessage to "Orchestrator", giving SHAs and capture paths. Review captures
  live in `~/fantasy-stock-design-review/<topic>/`; the calm-Home ones are in `home-calm/`.
- **Git:**
  - a fresh branch off `origin/main` for each piece of work (merged branches are dead);
  - board and docs only;
  - `git branch --show-current` and `git status` before every commit;
  - stage named paths only: other sessions leave untracked files in shared worktrees (this one
    had `.codex/` and `AGENTS.md`, not ours);
  - never edit `.claude/`;
  - the Orchestrator pushes; Giorgio merges.
