# Trading window and watchlist

Status: Draft (awaiting Giorgio's answer to open question 1, then approval)
Planner session: "Planner" (Fable 5.1), 2026-10-08 · Orchestrator hand-off: —

## Goal

Keep trading tied to market hours (what's live today) and give players something to do when
the market is closed: search any stock, and **save it to a watchlist** so it's one tap away
when the market opens. This closes the real gap in the current rule, which is that a player
who finds a stock on Tuesday night has nowhere to put it. A later plan ("C", queued orders
that fill at the next open) is parked, not built.

## Giorgio's rules

All 2026-10-08, in the Planner session.

- The idea he was weighing: "since we are using simulated stocks, we dont need to close it
  during non market hours? instead the logic should be more that you cant buy or sell during
  market hours bc thats like if your fantasy player is in a game."
- His lean, before the options: "im leaning keeping it like a real portfolio where i cant
  buy/sell after hours".
- Search and save, regardless of the window: "a user should still be able to search a stock
  when they arent allowed to buy. they should still be able to search and add stocks to a
  watchlist or something to save for later."
- The ruling, on the Planner's three options (A keep it real; B fantasy-style lock; C real
  plus an after-hours queue): "I agree with your recommendation. Immediate A with C as the
  long term plan."

Both are recorded in `docs/PRODUCT_RULES.md` under Trading ("Trading window", "Search and
save any time").

## Decisions

| # | Question | Decision | Board section / date |
|---|---|---|---|
| 1 | Trading window | **A**: buy/sell only while the market is open (unchanged; `record-trade` enforces it from `market_calendar`, live since #89). B (fantasy-style lock) rejected | Planner chat, 2026-10-08 |
| 2 | Queued after-hours orders (C) | Parked as a future plan after 1.2.0; nothing in this plan precludes it | Planner chat, 2026-10-08 |
| 3 | Search while closed | Always allowed; never gated on market hours (already true in `TradeModal` and the 3e `StockSearchScreen`; this makes it a rule) | Planner chat, 2026-10-08 |
| 4 | A watchlist exists | Yes: save a stock from search or the stock sheet, any time; see it with price and day change; one tap to the Buy sheet | Planner chat, 2026-10-08 |
| 5 | Where the watchlist shows and what a row says | To Giorgio as "Your call" mockups (see open question 2) | pending |

## Open questions

1. **BLOCKING: does the watchlist belong to the player or to the league?**
   Recommendation: **the player** (one list across all your leagues, like Robinhood). It is
   simpler to build, matches the brokerage habit (UX rule 1), and the list is a *shortlist*,
   not a roster move. When you open a saved stock *inside* a league, the sheet already shows
   whether it fits (owner, slot, budget) at read time. A per-league list would need a league
   picker on save and would split one idea across N lists.
2. **Design (non-blocking; resolved on the board):** where the watchlist lives (a section
   at the top of the Portfolio tab, a tab inside the stock search screen, or both), what a
   row shows (price, day change, "fits your $100–$200 slot"), and whether Home gets a
   rule-10 hook when the market is closed ("Opens Mon 9:30 · 3 on your watchlist"). The
   Planner writes the brief; the Design Lead draws A/B; Giorgio picks.
3. **Cap (non-blocking; default proposed):** 50 symbols per player, the same cap as the
   draft queue (`draft_queue.position between 1 and 50`). Beyond that, a save is refused in
   place with "Your watchlist is full (50)".

## Scope

**In:**
- The product rules above.
- A `watchlist` table with owner-only access, and its migration.
- Mobile: Save / Saved on the stock sheet and in search results; a watchlist list with price
  and day change and a tap-through to the stock sheet (Buy pre-selected); the closed-market
  state of that list says when the market opens (rule 9) and never offers a dead Buy.
- The refusal messages for a full list and for a symbol that is no longer tradable (rule 8).
- Tests: a PGlite effect test for the table's RLS and grants; Deno unit tests for the pure
  client helpers; the UX gate (rulebook + `ux-reviewer`).

**Out (and why):**
- **C, queued after-hours orders.** A separate plan after 1.2.0 (see "Parked: C" below).
- **Price alerts or notifications for watched stocks.** Not asked for; a push on a price
  move is a different feature with its own rules.
- **Watchlist on the web app.** 3d has not started; the rulebook and this plan bind it when
  it does.
- **Changing the draft queue.** It stays what it is (a per-league ordered auto-pick list);
  the two must not be merged, because the queue has server-side meaning and the watchlist has
  none.
- **Sharing a watchlist with the league.** No.

## How it works

### The player's side

1. Any time, open or closed, search a stock by name or ticker (unchanged). Each result has a
   **Save** control; saved ones read **Saved**. Tapping toggles it; the change shows at once
   and is confirmed by the server (rule 9: optimistic here is safe, it is not money).
2. On the stock sheet, the same Save / Saved control sits in the header, next to the name.
3. The **Watchlist** (location per the board decision) lists saved stocks with the last price
   and the day's change. A row tap opens the stock sheet. While the market is open, the sheet
   offers Buy as today. While it is closed, the sheet says "Market's closed. Opens Mon 9:30
   ET." (the 3e `marketOpensLabel`) and the Save control still works.
4. Swipe or tap to remove. Removing a stock you hold does nothing to the position.
5. A stock that stops being tradable (delisted, or `symbols.active = false`) stays on the
   list with a "No longer tradable" tag and no Buy, so a player sees why it vanished from
   search rather than wondering (rule 8). Removing it is the only action.
6. If the list is full (50), Save is refused in place: "Your watchlist is full (50). Remove
   one to add another."

### The system's side

**Data.** A new table, following `draft_queue`'s shape
(`supabase/migrations/20261010000000_draft_pick_clock_and_queue.sql`):

- `watchlist(user_id uuid not null references auth.users(id) on delete cascade, symbol text
  not null check (symbol = upper(symbol) and length(symbol) between 1 and 12), created_at
  timestamptz not null default now(), primary key (user_id, symbol))`.
- `user_id` is the auth user (not the `text` manager id used by `drafts`/`draft_queue`),
  because the list is per player, not per league membership. Bots never have one.
- The 50 cap is enforced server-side (a BEFORE INSERT trigger counting the owner's rows,
  or the write RPC), never only in the client.
- Access: RLS on; owner-only `SELECT`, `INSERT`, `DELETE` for `authenticated` with
  `user_id = auth.uid()`; no `UPDATE`; **no `anon` access** (explicit `REVOKE ... FROM anon`
  on any helper function, verified by the `proacl` query, per CLAUDE.md). `service_role`
  never needs this table. Whether writes go through RLS directly or through a small
  `SECURITY DEFINER` RPC (`set_watchlist(symbol, saved boolean)`) is the migration writer's
  call; the RPC is preferred if the cap trigger gets awkward.
- A saved symbol must exist in `symbols` (FK or a check in the RPC). `symbols` is signed-in
  only since `20261114000000` (#177); the watchlist reads join it as the user, which is
  allowed.

**Reads.** The watchlist screen reads `watchlist` joined to `symbols` (`name`, `last_price`,
`active`, `is_draftable`) in one PostgREST call; the day change comes from the same price
source the Portfolio uses (`lib/money/prevClose.ts` / `priceReads.ts` on the 3e branch), so
the two screens never disagree on a number. `symbols.last_price` is refreshed by
`enrich-symbols` every 10 minutes during the day and holds the close after hours, which is
the right number for a closed-market list.

**Client.** On the 3e module (`apps/mobile/components/money/`, `apps/mobile/lib/money/`):
- `StockSearchScreen.tsx` and `StockSheetBody.tsx` gain the Save / Saved control; a pure
  helper (`lib/money/watchlist.ts`) owns the toggle state machine and the optimistic flip
  with server confirmation and rollback on error, tested in `apps/mobile/tests-deno/`.
- A `WatchlistScreen` (or section) reuses the Portfolio row primitive (UX rule 5: the same
  kind of thing looks the same) and the stock sheet.
- Refusals map in `lib/money/refusals.ts`: `watchlist_full`, `symbol_inactive`,
  plus the shared `not_authenticated` / `rate_limited`.

**Interaction with live features.**
- `record-trade` is untouched. The watchlist has no server-side meaning: it never funds,
  reserves, or pre-validates a trade.
- The draft queue is untouched. During a draft, the draft screen's search keeps using the
  queue; "Save" on the stock sheet still saves to the watchlist, which is a different list.
- After changing `supabase/migrations/` and the client call sites, run
  `node scripts/gen-architecture.mjs` and commit; re-capture `db-snapshot.json` after the
  grant/RLS change.

### Parked: C, queued after-hours orders (not in this plan)

Recorded so the Orchestrator does not build it by accident and the next Planner session
starts from here. C would add: an `orders` table (user, league, symbol, side, placed_at,
status); a fill sweep at the market open that prices each order at the open print and runs
it through the same `record_trade_atomic` path as a live trade; cancel-before-open; the
whole-position and proceeds rules applied to a queued sell-then-buy pair; a partial-state
story for a sweep that fills some orders and not others (CLAUDE.md's all-or-nothing family);
and the UX for "placed, fills at 9:30". It is additive on A and changes nothing here.

## Risks and edge cases

- **3e owns the files this touches.** `StockSearchScreen`, `StockSheetBody`, `refusals.ts`
  are on `ui/mobile-money`, mid-gate. The watchlist branches **after 3e merges** (or as a
  3e follow-up the same worker takes), never in parallel on the same files.
- **1.2.0 timing.** The UX final sweep (#176) has 1.2.0 on BLOCK for S-1..S-6. The watchlist
  is not a 1.2.0 blocker and must not delay the cut; if 1.2.0 is cut first, the watchlist
  ships in 1.2.x or 1.3. Giorgio decides the ordering when the sweep clears.
- **Security.** Owner-only RLS; the usual trap that `REVOKE FROM PUBLIC` leaves `anon` and
  `authenticated` grants in place on any function (CLAUDE.md); verify with `proacl`. No
  bearer capability lives in this table, so exposure is privacy (who watches what), still
  owner-only.
- **Migration CLI splitter.** No identifier may contain a bare `atomic`;
  `supabase/tests/migration_cli_split.test.ts` checks it. Never regenerate an applied file.
- **Delisted symbols.** `symbols.active` flips without touching the watchlist; the list shows
  the tag rather than silently dropping the row (rule 8; silence is the failure mode).
- **Price staleness.** `last_price` can be hours old after a close or NULL for the ~4k
  unpriced symbols; a NULL price renders "—", never `$0.00` (the overloaded-NULL lesson).
- **Optimistic toggle.** Safe for a save (no money); the helper must roll back on a server
  error and show the refusal, never leave "Saved" on a failed write (verify the effect).
- **Cap race.** Two fast saves at 49 could both pass a client check; the server trigger/RPC
  is the only true gate, and the second gets `watchlist_full`.
- **Draft queue confusion.** Players may expect "Save" during a draft to add to the queue.
  The draft screen's copy must distinguish "Queue" from "Save"; that is a board question.

## Done means

- [ ] `docs/PRODUCT_RULES.md` carries "Trading window" and "Search and save any time".
- [ ] Open question 1 answered by Giorgio and recorded; the board's "Your call" for
      question 2 decided and recorded.
- [ ] Migration applied (Giorgio, from the deploy checkout); `schema_migrations` shows it;
      `proacl`/RLS verified by query: owner-only, no `anon`; PGlite effect test PASS
      (owner reads own rows only; another user reads none; anon refused; 51st insert
      refused).
- [ ] Search works with the market closed on the simulator (no gate), and Save/Saved works
      open and closed.
- [ ] The watchlist screen: price and day change match the Portfolio's figures for the same
      symbol; a NULL price shows "—"; an inactive symbol shows the tag and no Buy; a full
      list refuses in place with the copy above.
- [ ] Tapping a row opens the stock sheet; closed-market sheet shows the opens label and no
      dead Buy.
- [ ] `node scripts/gen-architecture.mjs --check` clean; `db-snapshot.json` re-captured.
- [ ] UX gate passed: `ux-reviewer` findings answered; rules 5, 8, 9, 10 checked on the new
      surfaces.
- [ ] Giorgio's check by hand, market closed: search "apple", save it, see it on the
      watchlist with a price, open it, read "Market's closed. Opens Mon 9:30 ET.", remove it.

## Suggested workstreams

The Orchestrator decides the final split.

| # | Workstream | Depends on | Who |
|---|---|---|---|
| W0 | Push this branch, open the docs PR | — | Orchestrator |
| W1 | Mockup brief (Planner) → "Your call" board section (Design Lead) → Giorgio decides → rules recorded | Open Q1 answered | Planner, Design Lead |
| W2 | Migration + RLS + cap, PGlite effect test; HUMAN ACTION `db push` handoff | Q1 | `supabase-migration-writer`, `supabase-reviewer`, `security-reviewer`; Giorgio applies |
| W3 | Client: Save/Saved, watchlist screen, refusals, Deno tests | W1, W2 applied, **3e merged** | mobile worker |
| W4 | Architecture map regen; db-snapshot re-capture | W2, W3 | worker (map), Giorgio (snapshot) |
| W5 | UX gate (Design Lead + `ux-reviewer`), Giorgio's hand check, release in 1.2.x/1.3 | W3 | Design Lead, Giorgio |

## Models

Per Giorgio's standing rule (plan on Opus, build on the cheapest tier that fits, the
Orchestrator reviews as backstop):

| Role / workstream | Model | Why |
|---|---|---|
| Planner | Fable 5.1 | This plan; the W1 brief |
| Orchestrator | Opus 5.5 (its own) | Reviews and verifies every branch |
| W1 board mockups | Design Lead: brief/recommendation on Opus, board JSX on Sonnet | Judgement vs well-specified JSX |
| W2 migration | `supabase-migration-writer` (Sonnet), reviewed by `supabase-reviewer` + `security-reviewer` (Sonnet); **Opus** for the Orchestrator's own RLS/grant review before handoff | RLS and grants are security work (CLAUDE.md) |
| W3 mobile | Worker turn 1 on Opus (read + plan + WAIT), then Sonnet | Well-specified UI on the 3e primitives |
| W4 map regen | Haiku | Mechanical |
| W5 gate | Design Lead on Opus; `ux-reviewer` on Sonnet | Judgement; checklist |
| Recon anywhere | Haiku (`explorer`) | Read-only |
