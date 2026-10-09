# Trading window and watchlist

Status: Draft (awaiting Giorgio's approval; placement decided on the board during W1)
Planner session: "Planner" (Fable 5.1), 2026-10-08 · Orchestrator hand-off: —

## Goal

Keep trading tied to market hours (what's live today) and give players something to do when
the market is closed: search any stock, and **save it to that league's watchlist** so it's
one tap away when the market opens. The watchlist is a league feature in the fantasy-football
sense (each league has its own waiver wire), not a brokerage list: the same stock can be
available in one league, held by a rival in another, and a bad fit in a third, and each row
says so. This closes the real gap in the current rule, which is that a player who finds a
stock on Tuesday night has nowhere to put it. A later plan ("C", queued orders that fill at
the next open, the waiver-claim analogue) is parked, not built.

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
- Per league, correcting the Planner's per-player proposal: "by league. if im in multiple
  fantasy football leagues, each one has its own waiver wire. if i want to buy apple in one
  league, i may not be able to in another if another player has it, i already have it, or it
  doesnt fit my team by one of the league rules." Having it by player "makes no sense".
- The standing instruction that came with it: "i need you to research fantasy football so
  that this doesnt come up." Answered by `docs/design/FANTASY_CONVENTIONS.md` and the
  "League features follow fantasy football" rule.

All are recorded in `docs/PRODUCT_RULES.md` under Trading ("Trading window", "Search and
save any time", "The watchlist is per league", "League features follow fantasy football").

## Decisions

| # | Question | Decision | Board section / date |
|---|---|---|---|
| 1 | Trading window | **A**: buy/sell only while the market is open (unchanged; `record-trade` enforces it from `market_calendar`, live since #89). B (fantasy-style lock) rejected | Planner chat, 2026-10-08 |
| 2 | Queued after-hours orders (C) | Parked as a future plan after 1.2.0; nothing in this plan precludes it | Planner chat, 2026-10-08 |
| 3 | Search while closed | Always allowed; never gated on market hours (already true in `TradeModal` and the 3e `StockSearchScreen`; this makes it a rule) | Planner chat, 2026-10-08 |
| 4 | A watchlist exists | Yes: save a stock from search or the stock sheet, any time; see it with price, day change and its availability in this league; one tap to the Buy sheet | Planner chat, 2026-10-08 |
| 5 | Player or league? | **Per league**, like a fantasy-football watch list / waiver wire. The Planner's per-player proposal was wrong and is withdrawn | Planner chat, 2026-10-08 |
| 6 | Reference pattern for league features | Fantasy football (ESPN / Sleeper / Yahoo), never a brokerage; UX rule 1 reworded; `FANTASY_CONVENTIONS.md` written | Planner chat, 2026-10-08 |
| 7 | Where the watchlist shows and what a row says | To Giorgio as "Your call" mockups: A (Portfolio section, recommended) / B (search tab) / C (both); brief below, re-sent per league | pending, brief re-sent 2026-10-08 |

## Open questions

None blocking.

1. **Design (resolved on the board):** where the watchlist lives (a section on the Portfolio
   tab, a tab inside the stock search screen, or both), what a row shows (price, day change,
   availability in this league), and whether Home gets a rule-10 hook when the market is
   closed ("Opens Mon 9:30 · 3 on your watchlist"). The Planner wrote the brief; the Design
   Lead draws A/B/C; Giorgio picks.
2. **Cap (default proposed):** 50 symbols per manager per league, the same cap as the draft
   queue (`draft_queue.position between 1 and 50`). Beyond that, a save is refused in place
   with "Your watchlist is full (50)".
3. **Saving from a league-less context.** Search is only reachable inside a league today
   (the Portfolio tab and the draft), so every save has a league. If a league-less search
   ever appears (e.g. a global stock lookup), Save there must ask "which league?", never
   save to all. Not needed now; noted so it is not forgotten.

## Scope

**In:**
- The product rules above.
- A per-league `watchlist` table with owner-only access, and its migration.
- Mobile: Save / Saved on the stock sheet and in search results; a watchlist list with price,
  day change and availability in this league, and a tap-through to the stock sheet (Buy
  pre-selected); the closed-market state of that list says when the market opens (rule 9)
  and never offers a dead Buy.
- `docs/design/FANTASY_CONVENTIONS.md` (the fantasy-football mapping) and the reworded UX
  rule 1.
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

1. Inside a league, any time, open or closed, search a stock by name or ticker (unchanged).
   Each result has a **Save** control (the ESPN flag); saved ones read **Saved**. Tapping
   toggles it for *this league*; the change shows at once and is confirmed by the server
   (rule 9: optimistic here is safe, it is not money).
2. On the stock sheet, the same Save / Saved control sits in the header, next to the name.
3. The league's **Watchlist** (location per the board decision) lists saved stocks with the
   last price, the day's change, and **availability in this league** on every row, the way a
   fantasy add-player list does: "Available" · "Held by Maya" · "Yours" · "No free $100–$200
   slot". A row tap opens the stock sheet. While the market is open, the sheet offers Buy as
   today (and the normal refusals still apply; the list never reserves anything). While it is
   closed, the sheet says "Market's closed. Opens Mon 9:30 ET." (via the S-11 standard time
   formatter) and the Save control still works.
4. Swipe or tap to remove. Removing a stock you hold does nothing to the position. Switching
   leagues with the league pill shows that league's own list; nothing carries across.
5. A stock that stops being tradable (delisted, or `symbols.active = false`) stays on the
   list with a "No longer tradable" tag and no Buy, so a player sees why it vanished from
   search rather than wondering (rule 8). Removing it is the only action.
6. If the list is full (50), Save is refused in place: "Your watchlist is full (50). Remove
   one to add another."

### The system's side

**Data.** A new table, following `draft_queue`'s shape
(`supabase/migrations/20261010000000_draft_pick_clock_and_queue.sql`):

- `watchlist(league_id uuid not null references leagues(id) on delete cascade, user_id text
  not null check (user_id !~ '^bot-'), symbol text not null check (symbol = upper(symbol)
  and length(symbol) between 1 and 12), created_at timestamptz not null default now(),
  primary key (league_id, user_id, symbol))`: the same key shape as `draft_queue`, because
  it is the same kind of thing (a manager's private list inside one league).
- `user_id` is the `text` manager id used by `drafts`/`draft_queue` (so the row ties to the
  league membership, and the ownership join uses one id type); bots are excluded by the
  check, as in `draft_queue`.
- The 50 cap is per manager per league, enforced server-side (a BEFORE INSERT trigger
  counting the owner's rows in that league, or the write RPC), never only in the client.
- Access: RLS on; owner-only `SELECT`, `INSERT`, `DELETE` for `authenticated` with
  `user_id = auth.uid()::text` **and** `is_member(league_id)` (the existing helper); no
  `UPDATE`; **no `anon` access** (explicit `REVOKE ... FROM anon` on any helper function,
  verified by the `proacl` query, per CLAUDE.md). `service_role` never needs this table.
  Whether writes go through RLS directly or through a small `SECURITY DEFINER` RPC
  (`set_watchlist(league_id, symbol, saved boolean)`, modelled on `set_draft_queue`) is the
  migration writer's call; the RPC is preferred if the cap trigger gets awkward.
- Leaving a league before the draft deletes the member's rows (cascade through the
  membership, or in `leave_league`); after a season the list stays with the league's history
  and is hidden with it (`league_members.hidden_at`).
- A saved symbol must exist in `symbols` (FK or a check in the RPC). `symbols` is signed-in
  only since `20261114000000` (#177); the watchlist reads join it as the user, which is
  allowed.

**Reads.** The watchlist screen reads the league's `watchlist` rows joined to `symbols`
(`name`, `last_price`, `active`, `is_draftable`) in one PostgREST call, then computes each
row's availability **in this league** with the same pure helper the search results already
use (`lib/money/stockSearchOwnership.ts`: owned by another manager / yours / free) plus the
slot-fit check the stock sheet uses, so search, sheet and list never disagree about whether a
stock can be bought here. The day change comes from the same price source the Portfolio uses
(`lib/money/prevClose.ts` / `priceReads.ts`), so the two screens never disagree on a number. `symbols.last_price` is refreshed by
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

### Mockup brief for the board (W1): "Your call: where the watchlist lives"

Sent to the Orchestrator for the Design Lead on 2026-10-08, and **re-sent the same day with
the per-league correction**. The Design Lead draws it on the key-screens board as a "Your
call" section with a recommendation; Giorgio picks.

- **The model to draw to:** a fantasy-football watch list (ESPN's flag; Sleeper's star),
  **per league**, inside the league's own screens. It reserves nothing. Every row answers
  "can I get this one *here*?" the way an add-player list does. Not a brokerage list.
- **Options to draw, side by side (Light and Dark):**
  - **A (recommended):** a "Watching" section on the league's Portfolio tab below Holdings,
    5 rows max, "See all (N)" to a full list.
  - **B:** a "Watchlist" tab inside the stock search screen (Search · Watchlist).
  - **C:** both A and B.
- **Sample data** (from `docs/design/screens/data.js`, the one canonical dataset): a player
  in a $100–$200 price-tier league with 3 holdings and 5 watched stocks, one per availability
  state: **Available** (fits a free slot); **Held by Maya** (another manager in this league);
  **Yours** (already held); **No free $100–$200 slot** (doesn't fit this league's rules); and
  **No longer tradable** (delisted). One of them with a NULL price ("—"). Two frames per
  option: **market open** and **market closed** (Friday 5 pm ET). One extra frame: the same
  player switches leagues with the pill and sees a *different* list.
- **What each frame must show**, by UX rule (`docs/design/UX_RULES.md`):
  - Rule 1: the reference is the fantasy add-player list, not Robinhood's watchlist.
  - Rule 6: the team-value hero stays the one emphasised element; the section is secondary.
  - Rule 5: the watchlist row is the same row primitive as a holding (name, price, change).
  - Rule 7: Holdings before Watching; the "Buy a stock" row stays where it is; the player's
    own name, where it appears, is bold and the row carries the light-blue tint; no "(you)"
    (Giorgio's S-10 final ruling, #179/#180).
  - Rule 4: 5 rows then "See all"; each row carries its availability tag (above); a NULL
    price renders "—".
  - Rule 9: closed frames show the last close with an "at close" label; no "live" dot.
  - Rule 10: closed frame, non-empty list: the "Buy a stock" row reads "Market opens Mon
    9:30 · 3 on your watchlist".
  - Rule 8: a delisted row keeps its place with the tag and no Buy; a full list (50) refuses
    in place: "Your watchlist is full (50). Remove one to add another."
  - Rule 11: the Save → Saved flip on the stock sheet and in search results is the ending
    (the control flips, the row settles into the section); no toast.
  - Rule 3: Save / Saved is a ≥44 pt control in the stock sheet header and on each search
    result, never adjacent to Buy.
- **Also draw:** the Save / Saved control on a search result row and in the stock sheet
  header (one frame each, open market), and the draft screen's search with the queue control
  and the Save control both visible, labelled "Queue" and "Save", so the two lists cannot be
  confused.

### Parked: C, queued after-hours orders (not in this plan)

Recorded so the Orchestrator does not build it by accident and the next Planner session
starts from here. C would add: an `orders` table (user, league, symbol, side, placed_at,
status); a fill sweep at the market open that prices each order at the open print and runs
it through the same `record_trade_atomic` path as a live trade; cancel-before-open; the
whole-position and proceeds rules applied to a queued sell-then-buy pair; a partial-state
story for a sweep that fills some orders and not others (CLAUDE.md's all-or-nothing family);
and the UX for "placed, fills at 9:30". It is additive on A and changes nothing here. In
fantasy-football terms it is the **waiver claim** (place now, processed at a set time,
cancellable until then), and should be planned from `FANTASY_CONVENTIONS.md`.

## Risks and edge cases

- **3e is merged** (#172, 2026-10-07; its ledger migration `20261113000000` is applied), so
  the watchlist branches off `main` and builds on the merged `StockSearchScreen`,
  `StockSheetBody` and `refusals.ts`. Migration ranges in flight: `20261114` (applied),
  `20261115` (Run it back, #94), `20261116` (security hardening); **the watchlist migration
  takes `20261117000000+`.**
- **Time formats.** The pre-1.2.0 sweep item S-11 standardises draft/market time formats;
  "Market opens Mon 9:30" must reuse that formatter, not `marketOpensLabel` as-is, so the
  watchlist never shows a time in a different shape from Home.
- **Manager names.** Wherever a name appears ("Held by Maya"), the own-row rule applies: your
  own name in bold and your row tinted light blue, no "(you)" (Giorgio, 2026-10-08, S-10
  final ruling, recorded on main via #179/#180). Also new (2026-10-08): players see ONLY their
  leaguemates' name and avatar, nothing about anyone outside their leagues; "Owned by Maya"
  fits because Maya is a leaguemate. Profile-visibility migration is `20261118`; the
  watchlist keeps `20261117`.
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
- **Cross-league leakage.** The RLS must gate on `is_member(league_id)` as well as the owner,
  and the client must key its cache by league: a stale list from League A showing under
  League B's pill is the exact bug Giorgio's ruling exists to prevent. The PGlite test covers
  a member of two leagues reading each list separately.
- **The wrong reference pattern.** The Planner first proposed this per player, from a
  brokerage habit. The correction is now a product rule and `FANTASY_CONVENTIONS.md`; any
  future league feature is planned against that page first.

## Done means

- [ ] `docs/PRODUCT_RULES.md` carries "Trading window", "Search and save any time", "The
      watchlist is per league" and "League features follow fantasy football";
      `docs/design/FANTASY_CONVENTIONS.md` is on `main`; UX rule 1 is reworded.
- [ ] The board's "Your call" (placement) decided by Giorgio and recorded.
- [ ] Migration applied (Giorgio, from the deploy checkout); `schema_migrations` shows it;
      `proacl`/RLS verified by query: owner-and-member only, no `anon`; PGlite effect test
      PASS (owner reads own rows in own league only; the same user in two leagues sees two
      separate lists; another member reads none; a non-member refused; anon refused; 51st
      insert in one league refused while the other league's list is unaffected).
- [ ] Search works with the market closed on the simulator (no gate), and Save/Saved works
      open and closed.
- [ ] The watchlist screen: price and day change match the Portfolio's figures for the same
      symbol; every row's availability tag matches what search and the stock sheet say for
      the same stock in the same league; switching leagues with the pill shows a different
      list; a NULL price shows "—"; an inactive symbol shows the tag and no Buy; a full list
      refuses in place with the copy above.
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
| W1 | Mockup brief (Planner, sent) → "Your call" board section (Design Lead) → Giorgio decides → rules recorded | — | Planner, Design Lead |
| W2 | Migration (`20261117000000+`) + RLS (owner ∧ member) + cap, PGlite effect test; HUMAN ACTION `db push` handoff | — | `supabase-migration-writer`, `supabase-reviewer`, `security-reviewer`; Giorgio applies |
| W3 | Client: Save/Saved, watchlist screen, refusals, Deno tests (off `main`; 3e is merged, #172) | W1, W2 applied, S-11 formatter on main | mobile worker |
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
