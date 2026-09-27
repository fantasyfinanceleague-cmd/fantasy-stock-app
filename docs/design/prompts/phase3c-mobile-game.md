# Phase 3c worker prompt — Mobile competitive screens (`ui/mobile-game`)

> Drafted by Design Lead, 2026-09-26. Starts after **3b-1 merges**. Backend
> asks: **#2** (display names) blocks; **#7** (market session / next open)
> blocks only the `live_closed` state; **#9** (draft recap read) blocks the
> recap screen. Nice-to-have: **#4** intraday (momentum sparkline), **#10**
> scoring status, **#11** season result. Runs in parallel with 3e (disjoint
> screens). Plan on Opus, build on Sonnet.

---

You are the UI worker for **Phase 3c · the competitive screens**, where the
Game Day direction earns its name. Your branch is `ui/mobile-game`. You report
to `Orchestrator` and `Design Lead`.

## Read first

`CLAUDE.md`, `docs/STATUS.md`, the charter contract,
`docs/design/prompts/phase3-plan.md`. `docs/design/DESIGN_DIRECTION.md`
**§1 B**, **§3 lifecycle table**, §4 (including `spring.lively`), §5, §9 (game
surface + action tokens). `docs/design/AUDIT-2026-09.md` §5 (Matchup was "a
static table, weaker than the landing's own mock"; the League "Leader"
contradiction; no draft recap route; the unexplained "Runner-Up" banner). The
board's Game Day matchup mock (`docs/design/directions/direction-board.html`,
§B) is the target look.

## Scope

All on `Surface kind="game"` unless noted.

1. **Matchup tab**
   - **Scoreboard** (foundation `Scoreboard`): league + week, "LIVE" /
     "FINAL" tag, both **display names** (ask #2), both dollar gains
     (`type.score.xl`), the TugBar, "You lead by $X", time to Friday close.
   - **Lineups:** two columns (you / opponent) of holdings with dollar and percent
     change; tapping a ticker opens the 3e stock sheet (a stub until 3e merges).
   - **Lead-change Chyron:** when the leader flips (client-side, comparing
     successive quote refreshes), slide in "NVDA +4.1% puts you ahead", with an
     accessibility announcement; at most one per 30s.
   - **Every phase honest** (§3 lifecycle table): `pre_draft` / `drafting`
     (PR #36's states, restyled), `pre_season` (week-1 opponent, no leader, no
     gains), `live_open`, `live_closed` (a frozen scoreboard + "Resumes Mon
     9:30 AM ET" from ask #7), `week_final` ("Scoring…" until processed, then
     FINAL), `playoffs` (a bracket position line), `season_complete` (the final
     result stated plainly: champion / runner-up / "won the regular season,
     lost the final"; ask #11, or derive it).
   - **All matchups this week** via a `SegmentedControl` ("Mine" / "League"):
     compact scoreboards.
   - **Friday reveal:** the first time a user views a matchup after it goes
     FINAL, play the reveal once (scores lock → winner emphasised → one
     celebratory beat on a win; persist "seen" per matchup-week).
2. **League tab**
   - A **season banner** with a `PhaseChip`; KPI row (Leader: "—" until games
     are played; Week; Players incl. bots, per PR #26).
   - **Standings** as a broadcast table (not a card per row): rank, the
     rank-change arrow since last week, name, W-L-T, gain; "you" highlighted
     with the `team.you` fill; **medal colours only after the season completes**.
     Re-sort animates position.
   - Schedule, and History → **Draft recap** (ask #9): picks by round.
   - League settings (commissioner) stays reachable; Create/Join live in the
     league sheet (3b-1), **not** pinned above the content.
3. **Draft room** (reached from the League tab while the draft is pending or
   in progress)
   - Pre-draft: countdown to the scheduled time; "Ready to draft" when
     startable (PR #26's copy); commissioner Start/Fill bots.
   - Live: an **on-the-clock** header (whose pick, a timer ring), the board
     (rounds × teams), search + pick. A **pick "slam"** (card scales in,
     `spring.lively`); your pick has a light haptic; others' picks slide into
     the board.
   - Keep the finalize-heal behaviour (PR #20) untouched; restyle only.

## Motion

| Moment | Spec | Reduced |
|---|---|---|
| Matchup open | Scoreboard wipe-in, `slow`, `settle` | Crossfade `quick` |
| Score change | `ScoreDigits` roll, `base` | Instant |
| Lead change | TugBar `spring.lively` overshoot + score slam (scale 1.08→1, `base`) + Chyron slide (`base`) | Values set; the Chyron appears static |
| Friday reveal | Lock (`base`) → winner emphasis (`slow`) → one celebratory beat (`feature`, ≤ 1.2s total) | A static "Won" / "Lost" badge |
| Standings re-sort | Animated row reorder, `base`; rank arrows fade in `quick` | No movement; arrows static |
| Draft pick | Card slam `spring.lively`; board insert `base` | Appears in place |
| On-the-clock timer | Ring countdown (linear) | Numeric countdown only |

## Verify, then report DONE

- tsc / lint / deno tests (+ tests for lead-change detection with a
  30s rate limit, the reveal-once persistence, and phase → state mapping for all 8 phases).
- **Device capture** (populated account; Giorgio signs in; you may use bot
  leagues and `test_timer_*` leagues to reach each phase): Matchup in **every
  phase** you can reach (list any you can't, and why), League standings,
  Draft recap, and the draft room pre-draft and live (fill bots to run a draft).
- XL Dynamic Type and **iPhone 17e** for Matchup and standings.
- Recordings: lead change, Friday reveal, standings re-sort, a live draft pick.
  **Reduce Motion on/off** each.
- Architecture map regenerated if call sites change.

## DESIGN-APPROVED criteria

1. Matchup is at least as strong as the landing's scoreboard (the audit bar).
2. Every lifecycle phase is honest: no leader before games, no gains before the season, and the season result stated plainly.
3. Standings are a broadcast table, not a stack of cards; medals only at season end; "Leader" consistent with Matchup.
4. The Friday reveal plays once per matchup-week and never blocks input.
5. Team colours mark people, gain/loss colours mark money, and nothing swaps.
6. Motion from tokens, `lively` only here; every reduced-motion row evidenced.

Report your PLAN first and wait for "go".
