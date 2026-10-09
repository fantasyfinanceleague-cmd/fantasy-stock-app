# Trading window, watchlist and claims (the waiver wire)

Status: Draft (awaiting Giorgio's approval; placement and claim UI decided on the board during W1)
Planner session: "Planner" (Fable 5.1), 2026-10-08/09 · Orchestrator hand-off: —

## Goal

Keep trading tied to market hours (live today) and add the two things fantasy football has
between games: a **watchlist** (save a stock to keep an eye on; many managers can save the
same one; it reserves nothing) and a **waiver wire** (after the close, **claim** a stock to
add at the next open; if nobody else claimed it you get it; if several did, a league order
decides). Both are per league. A player who finds a stock on Tuesday night now has a place to
put it *and* a way to act on it before Wednesday's bell, without anyone winning by being the
fastest tapper at 9:30.

## Giorgio's rules

All 2026-10-08, in the Planner session; recorded verbatim in `docs/PRODUCT_RULES.md` under
Trading ("Trading window", "Search and save any time", "The watchlist is per league", "The
watchlist is not a queue", "The waiver wire: daily claims", "League features follow fantasy
football").

- Trading window: "im leaning keeping it like a real portfolio where i cant buy/sell after
  hours" → "I agree with your recommendation. Immediate A with C as the long term plan." (C,
  queued orders, was then pulled forward the same day: see the waiver wire below.)
- Search and save: "a user should still be able to search a stock when they arent allowed to
  buy. they should still be able to search and add stocks to a watchlist or something to save
  for later."
- Per league: "by league. if im in multiple fantasy football leagues, each one has its own
  waiver wire. if i want to buy apple in one league, i may not be able to in another if
  another player has it, i already have it, or it doesnt fit my team by one of the league
  rules." Per player "makes no sense". "i need you to research fantasy football so that this
  doesnt come up."
- Not a queue: "multiple players can save the same stock, its like a player on the waiver
  wire. i can want to add them but so can someone else. we will need to make the waiver wire
  logic to decide who gets first dibs at stocks that are saved and queud by multiple users.
  but ultimately there should be a way to save stocks to keep an eye on them, and a way to
  queue them to add the next day that works like the waiver wire. you cannot see who else is
  holding a stock" (clarified: claims are blind; holdings stay visible).
- Daily, not a weekly lineup lock: "a user should be able to trade daily. this is based on
  fantasy football, doesnt need every same rule. an investor should be able to make moves
  mid week. so our 'waiver wire' will be a daily thing. you can claim stocks after the close
  of each day. if no one else claims that day, you get it. if two or more people claim, then
  we have the order decide. the order works like fantasy football, starts as reverse draft
  order. then shifts based on wins/loss and claims made."
- Pinned by question (AskUserQuestion, 2026-10-08): claims blind, holdings visible; processed
  at the next open 9:30 ET at the opening price; a claim is "Buy X, funded by selling Y"; any
  successful claim (contested or not) moves you to the back; weekly reset to reverse
  standings after Friday's scoring; claims can be placed only while the market is closed.

## Decisions

| # | Question | Decision | Board section / date |
|---|---|---|---|
| 1 | Trading window | **A**: live buy/sell only while the market is open (unchanged; `record-trade` enforces it). B (fantasy-style weekly lock) rejected twice: as the trading model, and again as a "weekly lineup" (Model 1) on 2026-10-08 | Planner chat, 2026-10-08 |
| 2 | Search while closed | Always allowed, never gated on market hours | Planner chat, 2026-10-08 |
| 3 | Watchlist | Per league; a Save flag (star) on search results and the stock sheet; many managers can save the same stock; reserves nothing | Planner chat, 2026-10-08 |
| 4 | Reference pattern | Fantasy football (ESPN / Sleeper / Yahoo) for league features; Robinhood only for money surfaces; `FANTASY_CONVENTIONS.md`; UX rule 1 reworded | Planner chat, 2026-10-08 |
| 5 | Waiver wire exists now | Yes ("C" pulled forward): daily claims, processed at the next open, before live trading opens for the day | Planner chat, 2026-10-08 |
| 6 | Claim composition | "Buy X, funded by selling Y" (cash in budget-cap leagues); if the claim loses, Y is not sold; whole positions | AskUserQuestion, 2026-10-08 |
| 7 | Visibility | Claims blind (no one sees who/how many claimed until the run); holdings visible as shipped ("Owned by …"); you only ever see leaguemates | AskUserQuestion, 2026-10-08; Orchestrator confirmed no 1.2.0 copy change |
| 8 | When to claim | Only while the market is closed; Claim is Buy's closed-market twin, same spot | AskUserQuestion, 2026-10-08 |
| 9 | First dibs | Per-league **waiver order**: starts as reverse draft order; any successful claim moves you to the back; resets to reverse standings after each week is scored (standings tiebreaks apply) | AskUserQuestion, 2026-10-08 |
| 10 | Naming | "Save"/"Saved" (star) for the watchlist; **"Claim"/"Claims"** for the waiver wire; never "Queue" (the draft's word) or "Order" (brokerage) | Planner ↔ Design Lead, 2026-10-08 |
| 11 | Lose ending | Names the winner and one short reason clause ("Gianluigi B. claimed AAPL · lower in the standings") | Design Lead ruling, flagged on the board |
| 12 | Where the watchlist and claims live; row states; composer | To Giorgio as "Your call" mockups (A / B / C placement; the Design Lead will recommend **C**, since fantasy apps put the watch list inside the player pool) | pending, revised brief 2026-10-09 |

## Open questions

None blocking. Resolved on the board during W1: placement (decision 12); the claim composer's
look; whether Home shows a rule-10 hook ("Market opens Mon 9:30 AM ET · 2 claims pending").
Defaults proposed, change on the board if wanted:

1. Cap: 50 saved symbols per manager per league; **one claim per stock per manager**, and at
   most **5 pending claims** per manager per run (fantasy apps allow a ranked handful; five
   keeps the run bounded and the UI honest).
2. A claim that cannot fill at the open (see "What can go wrong at the open") fails with a
   named reason and is cleared; it is never carried to the next day silently.
3. Weekend and holiday claims all go into the next trading day's run (Friday close → Monday
   open is one window, per `market_calendar`).

## Scope

**In:**
- Product rules (recorded), `docs/design/FANTASY_CONVENTIONS.md`, UX rule 1 reworded.
- `watchlist` table (per league) + migration; Save/Saved in search and the stock sheet; the
  watchlist with availability per league.
- `claims` + `waiver_order` tables + migration; the claim composer (closed market only); the
  Claims list (yours only); the **claims run** at each market open (a cron + edge function,
  on the `draft-autopick-sweep` pattern); the win/lose endings and pushes; the weekly order
  reset; the live-trade hold until the run completes.
- Tests: PGlite effect tests (RLS, grants, cap, order mechanics, run idempotency); Deno unit
  tests for the pure resolver (who wins what) and the client helpers; the UX gate.
- Architecture map regen; `db-snapshot.json` re-capture.

**Out (and why):**
- Price alerts on watched stocks (different feature). Web app (3d not started). Sharing a
  watchlist. Claims with ranked fallbacks ("try X, else Z"): later if asked. A commissioner
  setting for the waiver mode (reverse standings vs rolling vs FAAB): one rule for everyone
  now; FAAB is ruled out (a second currency inside a money game). A "weekly lineup" league
  type: noted as a possible later setting, not planned.
- Changing the draft queue: it stays what it is (the server auto-picks from it); the watchlist
  and claims are different lists and never read it.

## How it works

### The player's side

**Saving.** Inside a league, any time, search a stock by name or ticker. Each result and the
stock sheet header carry a star: **Save / Saved**, toggled for *this league*; it shows at once
and the server confirms (rule 9: optimistic is safe, it is not money). The league's
**Watchlist** lists saved stocks with price, day change and **availability here**, one status
line per row: "Available · fits your $100–$200 slot" · "Owned by Gianluigi B." · "You own
this" · "No free $200–$400 slot" · "No longer tradable"; a NULL price reads "—". Switch
leagues with the pill and you see that league's own list. Remove by swipe; removing a stock
you hold does nothing to the position. A full list (50) refuses in place: "Your watchlist is
full (50). Remove one to add another."

**Claiming (market closed).** Where Buy sits when the market is open, the same spot reads
**Claim** when it is closed (rule 3: same place, same size; Save never adjacent to either).
The composer is the 3e trade review, re-labelled: it asks what funds the buy (a position to
sell, via the existing sale picker, or cash in a budget-cap league), shows the league fit as
of the last close, and ends with "Claim · fills Mon 9:30 AM ET". The row's status line becomes
"Claimed · fills Mon 9:30 AM ET"; the star is unchanged. Your **Claims** list shows your
pending claims (and only yours: claims are blind) with cancel until the run starts. You can
claim a stock whether or not it is on your watchlist.

**The run (9:30 ET).** The league's claims are resolved in waiver order; then live trading
opens for the day. Each claimant gets an ending:
- **Won:** the position lands, funded by the named sale, both at the opening price. "AAPL is
  yours · $187.20 at the open · paid by selling JPM." You move to the back of the waiver order.
- **Lost:** "Gianluigi B. claimed AAPL · lower in the standings." Your sale did not happen.
- **Failed:** a named reason ("No free $100–$200 slot at the open: AAPL opened at $203.10";
  "AAPL is no longer tradable"); nothing happened.
Each is a push and a row in the league's activity. The waiver order is visible to everyone
in the league (it is the standings' cousin, not a secret); claims are not.

**During market hours.** As today: Buy and Sell live. A stock nobody claimed, or that a claim
failed on, is simply available to buy (the "free agent" after the run).

### The system's side

**Watchlist (data).** `watchlist(league_id uuid references leagues on delete cascade, user_id
text check (user_id !~ '^bot-'), symbol text check (symbol = upper(symbol) and length between
1 and 12), created_at timestamptz default now(), primary key (league_id, user_id, symbol))`.
RLS on; `authenticated` may SELECT/INSERT/DELETE only rows where `user_id = auth.uid()::text`
**and** `is_member(league_id)`; no UPDATE; no `anon` (explicit `REVOKE … FROM anon` on any
helper, verified by the `proacl` query). The 50 cap is a BEFORE INSERT trigger or the write
RPC (`set_watchlist(league_id, symbol, saved boolean)`, the migration writer's call). A saved
symbol must exist in `symbols` (signed-in only since `20261114000000`). Rows go with the
membership (cascade on leave before the draft; hidden with the league after the season).

**Watchlist (reads).** One PostgREST call joins the league's rows to `symbols` (`name`,
`last_price`, `active`, `is_draftable`); availability per row is computed client-side with
the same pure helpers search and the sheet already use (`lib/money/stockSearchOwnership.ts`
and the sheet's slot-fit), so search, sheet and list never disagree; the day change uses the
Portfolio's price source (`lib/money/prevClose.ts`, `priceReads.ts`).

**Waiver order (data).** `waiver_order(league_id uuid, user_id text, position smallint,
updated_at timestamptz, primary key (league_id, user_id), unique (league_id, position))`.
Readable by members (`is_member`), written only by service role.
- **Initialised** when the draft completes, in `finalize_league_draft`
  (`20260926000000`): reverse of the locked draft order
  (`league_draft_order_meta` + the order rows from `20261013000000`): the last pick is
  position 1.
- **Shifted** by the claims run: a manager whose claim fills moves to the last position; the
  rest close up. Contested or not (Giorgio's ruling).
- **Reset** after each week is scored: `process-week-results` already computes the week's
  ranking only through `league_standings_ranked(p_league_id)` (`index.ts:173`); the reset
  writes positions = reverse of that ranking (last place → 1) in the same job, after the
  standings write (`index.ts:1097–1121`), through `runJob` so the reset's outcome is part of
  the job's terminal status.

**Claims (data).** `claims(id uuid, league_id uuid, user_id text, symbol text, funded_by text
check (funded_by in ('sale','cash')), sell_symbol text null, slot_id uuid null, placed_at
timestamptz, run_date date null, status text check (status in ('pending','won','lost',
'failed','cancelled')), outcome jsonb null, resolved_at timestamptz null, primary key (id),
unique (league_id, user_id, symbol) where status = 'pending')`. RLS: a manager SELECTs only
their own rows in leagues they belong to (blind to others); INSERT/cancel through a
`place_claim` / `cancel_claim` RPC that enforces: market closed now (`market_session_status()`
≠ open), member, draft completed, symbol tradable, not already held by the claimant, ≤ 5
pending, the funding sale is a position the claimant holds; writes only by service role
otherwise. **No `anon`.** Lesson: the pending-uniqueness is a *partial* unique index, so a
re-claim after a loss is allowed (the all-or-nothing trap is a plain unique).

**The claims run (edge function `claims-run` + cron `claims_run`).** Modelled on
`draft-autopick-sweep` (`20261106000000`): `verify_jwt=false`, the `_shared/cron-auth.ts`
constant-time apikey guard with the key from `vault.decrypted_secrets('cron_apikey')`,
`timeout_milliseconds := 180000`, and the body bracketed by `_shared/run-job.ts` so every exit
writes a terminal `cron_job_status` (lesson #6). Schedule: every minute from 9:30 ET on
trading days until the day's run is recorded (the function no-ops with `success` "already ran
today" after that), driven by `market_calendar` (`session_open_at`), never a hard-coded
clock, so holidays and DST are the calendar's problem, not ours.

Per league with pending claims, inside one Postgres function (`resolve_claims(league_id,
run_date)`, SECURITY DEFINER, service role only, league advisory lock like
`record_trade_atomic`):
1. Read the opening prices for every claimed and funding symbol (the quote source
   `record-trade` uses; a missing open → that claim `failed: no_price`, the others proceed:
   per-claim, never per-league, the partial-state rule).
2. Order claims by the claimant's `waiver_order.position`; walk symbols: for each contested
   symbol the lowest position wins, the others `lost` with the winner's name and the reason
   clause. Uncontested claims win by default.
3. For each winner, **run the trade through `record_trade_atomic`** (the 13-arg function from
   `20261103000000`), sale first then buy, at the opening prices, with `funded_by_trade_id`
   and `slot_id` exactly as a live trade would set them. A refusal from it (`no_eligible_slot`
   at the open price, `symbol_owned` because someone bought it live before the hold, …)
   becomes that claim's `failed` reason; the sale is **not** committed without its buy (one
   transaction per claim).
4. Winners whose trades committed move to the back of `waiver_order` in the order they won.
5. Write each claim's outcome and queue the notifications (`league_notifications`, new kinds
   `claim_won`, `claim_lost`, `claim_failed`, added to the CHECK in `20261111000000`'s style;
   delivered by the existing push path, `_shared/push.ts` `sendExpoPush`).
6. Record the run (`claims_runs(league_id, run_date, started_at, finished_at, claims
   processed/won/lost/failed)`) so a retry is idempotent: a league with a row for today is
   skipped; a crash mid-league leaves no partial row because the function is one transaction.

**The hold on live trading.** `record-trade`'s market-hours gate (`index.ts:~283`, before
any league lookup) gains one clause: if the market is open but today's `claims_runs` row for
the league is missing (and there are pending claims for the league), refuse with a new
reason `claims_processing` (200, retryable, like `trade_conflict`), copy: "Claims are being
processed. Try again in a minute." This closes the race between a live buyer at 9:30:01 and
the run; it is a per-league check, not a global one, so a league with no claims is never
held. Bounded by the run's own completion; if the run is more than 10 minutes late the gate
lifts (`claims_runs` absent + run deadline passed → allow) and the run, when it comes, fails
any claim the live trades invalidated. The late case is logged as a job `failed` so it is
visible, not silent.

**Client.** Save/Saved and the watchlist as above. The claim composer reuses
`TradeReviewPanel` + `SalePicker` + `reviewMachine` from 3e with a `mode: 'claim'`; the
`refusals.ts` map gains `claims_processing`, `claim_limit`, `claim_market_open` (tried to
claim while open), `watchlist_full`, `symbol_inactive`. Pure helpers in `lib/money/`:
`watchlist.ts`, `claims.ts` (status lines, endings, the order display), tested in
`apps/mobile/tests-deno/`.

**Interaction with live features.**
- `record_trade_atomic` is the only writer of trades for claims too, so every trade rule
  (whole positions, proceeds, slots, tiers at `tierPrice()` cents) holds without a second
  implementation. The draft queue is untouched.
- The weekly reset lives in the job that already owns the standings write, so there is one
  ranking source (`league_standings_ranked`) and one writer.
- After `supabase/functions/` and migration changes: `node scripts/gen-architecture.mjs`;
  re-capture `db-snapshot.json` after the grant/RLS/cron changes.

### What can go wrong at the open (named, so the gate can check them)

| Case | Outcome |
|---|---|
| Two claims on one stock | Lowest waiver position wins; the other is `lost` with the winner and reason |
| The claimed stock opens outside every free tier slot | `failed: no_eligible_slot` with the open price in the copy |
| The funding sale's stock was sold live yesterday after the claim (impossible: claims are placed only when closed; a sale after 9:30 happens after the run) | n/a by construction; the composer re-validates at placement |
| No opening price for the stock (vendor gap) | `failed: no_price`; retry is not automatic (the player re-claims tonight); logged |
| The run crashes mid-league | No `claims_runs` row, transaction rolled back, next minute retries; other leagues unaffected |
| The run is late / never runs | Live-trade hold lifts after 10 min; job status `failed`; claims resolve when the run comes, failing any invalidated by live trades |
| A winner holds 0 funding (cash league, budget shrank) | `failed: over_budget` from `record_trade_atomic` |
| Manager left the league before the run (only possible pre-draft) | Claims require `draft_completed`; the pre-draft leave window never overlaps |
| Week scored and order reset while claims are pending (Friday 21:15Z, claims placed after 16:00 ET) | Reset first (Friday), then Monday's run uses the reset order: the intended fantasy behaviour |

## Risks and edge cases

- **Scope grew in one day** (watchlist → watchlist + waiver wire). The split in workstreams
  keeps the watchlist shippable alone (W2/W3) if the claims (W4–W6) slip.
- **Not a 1.2.0 blocker.** The UX final sweep (#176) has 1.2.0 on BLOCK for S-1..S-6; this
  plan must not delay the cut. Ships in 1.2.x/1.3.
- **Security.** Three new tables with RLS; `anon` revoked explicitly; `resolve_claims`,
  `place_claim`, `cancel_claim` ACL `{postgres, service_role}` / `{authenticated}` as designed
  and **verified with `proacl`** (CLAUDE.md: `REVOKE FROM PUBLIC` is not a lockdown). Claims
  blind by RLS, not by UI.
- **Partial state.** The run resolves per claim, in one transaction per league, with an
  idempotency row; the resolver never concludes anything league-wide from a subset (lesson 5);
  `cron_job_status` is written through `runJob` (lesson 6); `net.http_post` has the explicit
  timeout (lesson 8); the client renders the server's outcome, never its hope (rule 9).
- **Migration hygiene.** No bare `atomic` in identifiers (`migration_cli_split.test.ts`);
  applied files are never rewritten; `deferred/` for anything held. Ranges below.

### Build constraints (agreed with the Orchestrator, 2026-10-09)

1. **Migration ranges (provisional; re-stamped at release after prod's latest):** watchlist
   `20261117000000`–`09`; profile visibility `20261118` (not this plan); claims
   `20261119000000`–`09` onward.
2. **Re-created objects must be a SUPERSET of `main`'s latest at build time.** The claims
   work re-creates things other branches also touch: `record_trade_atomic` (13-arg; #94's
   `20261115000006` re-creates it too), `finalize_league_draft` (#94's `20261115000000`),
   `process-week-results`, and `league_notifications_kind_check` (new kinds `claim_won`,
   `claim_lost`, `claim_failed`). Each re-creation starts from `main`'s current body at the
   moment the branch is cut and adds; it never restores an older version (the #94 near-miss).
   The kind CHECK is guarded by `supabase/tests/notification_kinds_monotonic.test.ts`; the
   two functions get the same kind of guard: a PGlite test that the re-created body still
   passes `main`'s existing effect tests for them.
3. **The `claims_processing` hold is on the live trade path, so it is treated as a prod
   change to trading:** (a) a PGlite/Deno effect test that a live buy during a league's
   unfinished run is refused with `claims_processing` and succeeds the moment `claims_runs`
   has the row; (b) a byte-verified deploy of `record-trade` from the deploy checkout
   (download + diff); (c) **fail-open, explicitly:** the hold is per league and lifts by
   itself 10 minutes after the session open (`market_calendar.session_open_at + 10 min`),
   whether or not the run happened, so a dead cron can never strand a league's trading
   closed. A late or missing run is surfaced, not hidden: the `claims-run` job writes
   `failed` with the reason, and any claim the live trades invalidated fails with the
   normal `record_trade_atomic` reason when the run finally executes. No silent carry-over.
4. **The `claims_run` cron is verified by DATA, never by its enqueue status:** `claims_runs`
   has a row per league-day with pending claims; `claims.status` is terminal for every claim
   with `run_date = today`; `trades` holds the winners' two rows at the open price. Every
   exit of the function writes a terminal `cron_job_status` through `runJob` (including
   "already ran today" as `success` with that message, and "no pending claims anywhere" as
   `success` with that message, so the row's NULL-ness is never a discriminator).
   `supabase/tests/cron_status_handlers.test.ts` drives the real handler through every exit;
   `cron_timeouts.pglite.test.ts` enforces `timeout_milliseconds = 180000`.
- **Time formats.** "Mon 9:30 AM ET" via the S-11 standard formatter.
- **Names.** Own name bold on the light-blue tint, no "(you)" (S-10 final, #179/#180); only
  leaguemates' name and avatar are ever shown (profile visibility, `20261118`).
- **Cross-league leakage.** RLS gates on `is_member`; the client caches per league; the
  PGlite test reads two leagues for one user.
- **Reference pattern.** The Planner first proposed per-player and placement A from a
  brokerage habit; both corrected. `FANTASY_CONVENTIONS.md` is read first for any league
  feature.

## Done means

- [ ] `PRODUCT_RULES.md` carries all six Trading rules above; `FANTASY_CONVENTIONS.md` on
      `main`; UX rule 1 reworded.
- [ ] Board "Your call" decided by Giorgio: placement; the row states; the composer; the
      endings; Home's hook. Recorded.
- [ ] Migrations applied by Giorgio from the deploy checkout; `schema_migrations` shows them;
      `proacl`/RLS verified by query for `watchlist`, `claims`, `waiver_order`, `claims_runs`
      and the three RPCs; PGlite effect tests PASS: owner-and-member reads only; two leagues,
      two lists; a non-member and `anon` refused; 51st save refused; 6th pending claim
      refused; claim while open refused; contested claim resolves to the lower position;
      winner moves to the back; weekly reset equals reverse `league_standings_ranked`; a
      second `resolve_claims` call for the same league-day is a no-op.
- [ ] Cron `claims_run` present with `timeout_milliseconds = 180000`; `cron_timeouts`
      test passes; `cron_job_status` shows a terminal row per run (verify by data, not by
      the enqueue status).
- [ ] Live test in a test league (Giorgio + bots are test-only, so with two real test
      accounts): two claims on one stock placed after the close; next open: one `won` with
      both trades in `trades` at the open price, one `lost` with the winner named; the order
      shifted; both pushes received; a live buy at 9:30:00 got `claims_processing` and then
      succeeded.
- [ ] Search works with the market closed; Save/Saved works open and closed; the watchlist's
      availability tags match search and the sheet for the same stock in the same league.
- [ ] `node scripts/gen-architecture.mjs --check` clean; `db-snapshot.json` re-captured.
- [ ] UX gate passed: `ux-reviewer` findings answered; rules 3, 5, 8, 9, 10, 11 on the new
      surfaces; the rule-8 table includes every new refusal reason with its copy.
- [ ] Giorgio's check by hand, market closed: search "apple", save it, see it on the
      watchlist with availability; claim it funded by selling a holding; see "Claimed · fills
      Mon 9:30 AM ET"; cancel; claim again; next morning read the ending.

## Suggested workstreams

The Orchestrator decides the final split. W2/W3 (watchlist) can ship without W4–W6.

| # | Workstream | Depends on | Who |
|---|---|---|---|
| W0 | Push this branch, open the docs PR | — | Orchestrator |
| W1 | Revised mockup brief (sent) → "Your call" board sections (placement, row states, composer, endings, Home hook) → Giorgio decides → rules recorded | — | Design Lead, Planner |
| W2 | Watchlist migration (`20261117000000`–`09`): table, RLS, cap; PGlite test; HUMAN ACTION `db push` | — | `supabase-migration-writer`, `supabase-reviewer`, `security-reviewer`; Giorgio applies |
| W3 | Watchlist client: Save/Saved, the list, refusals, Deno tests | W1, W2 applied | mobile worker |
| W4 | Claims backend (`20261119000000`–`09`): `claims`, `waiver_order`, `claims_runs`, `place_claim`/`cancel_claim`/`resolve_claims`, init in `finalize_league_draft`, weekly reset in `process-week-results`, notification kinds; each re-created object a SUPERSET of main's latest (constraint 2); PGlite + Deno tests; HUMAN ACTION `db push` | W2 | migration writer + backend worker; reviewers; Giorgio applies |
| W5 | `claims-run` edge function + `claims_run` cron (verified by data, constraint 4) + the `claims_processing` hold in `record-trade` (effect test, fail-open after 10 min, byte-verified deploy: constraint 3); `cron_status_handlers` test; deploy from the deploy checkout | W4 | backend worker; Giorgio deploys |
| W6 | Claims client: Claim as Buy's closed twin, composer (`mode: 'claim'`), Claims list, endings, pushes, refusals, Deno tests | W1, W4 applied | mobile worker |
| W7 | Architecture map regen; db-snapshot re-capture; the live test above | W5, W6 | worker (map), Giorgio (snapshot, live test) |
| W8 | UX gate; Giorgio's hand check; release in 1.2.x/1.3 | W7 | Design Lead + `ux-reviewer`, Giorgio |

## Models

Per Giorgio's standing rule (plan on Opus, build on the cheapest tier that fits, the
Orchestrator reviews as backstop):

| Role / workstream | Model | Why |
|---|---|---|
| Planner | Fable 5.1 | This plan; the briefs |
| Orchestrator | Opus 5.5 (its own) | Reviews and verifies every branch |
| W1 board | Design Lead: brief/recommendation on Opus, board JSX on Sonnet | Judgement vs well-specified JSX |
| W2, W4 migrations | `supabase-migration-writer` (Sonnet); `supabase-reviewer` + `security-reviewer` (Sonnet); **Opus** for the Orchestrator's own RLS/grant/partial-state review of `resolve_claims` before handoff | RLS, grants and the resolver's partial-state design are security work (CLAUDE.md) |
| W5 edge function + cron | Worker turn 1 on **Opus** (it designs the hold and the idempotent run), then Sonnet | The cron/job-status/timeout lessons are exactly where cheap models have failed here |
| W3, W6 mobile | Worker turn 1 on Opus (read + plan + WAIT), then Sonnet | Well-specified UI on the 3e primitives |
| W7 map regen | Haiku | Mechanical |
| W8 gate | Design Lead on Opus; `ux-reviewer` on Sonnet | Judgement; checklist |
| Recon anywhere | Haiku (`explorer`) | Read-only |

## Mockup brief for the board (W1), revised 2026-10-09

Sent to the Design Lead (via the Orchestrator) on 2026-10-09, superseding the 2026-10-08
briefs. Draw to `FANTASY_CONVENTIONS.md`; sample data from `docs/design/screens/data.js`
(Tier Cup, $100–$200 price-tier league, 5 holdings; Stock Scudetto for the league-switch
frame). Light and Dark; market open and closed (Fri 5 pm ET) where it matters.

1. **Placement, A / B / C** as drawn (recommend C with the reasoning on the board).
2. **Watchlist rows**: one status line per row, the five availability states, the star, Buy
   only while open, "—" for a NULL price; the league-switch frame.
3. **Claim as Buy's closed-market twin**: the stock sheet closed, same spot reads "Claim";
   the composer (the 3e trade review re-labelled): funding picker (sale or cash), league fit
   as of the last close, primary "Claim · fills Mon 9:30 AM ET", × closes without saving.
4. **Row state after claiming**: "Claimed · fills Mon 9:30 AM ET" replaces the availability
   tag; star unchanged; cancel from the row or the Claims list.
5. **Claims list** (yours only): pending claims with their funding and fill time; a "Waiver
   order" line showing your position ("You're 3rd of 8 in the waiver order") with the order
   visible on tap (names per S-10: yours bold on the tint). Never shows anyone else's claims.
6. **Endings** (rule 11), each one frame: won ("AAPL is yours · $187.20 at the open · paid by
   selling JPM"); lost ("Gianluigi B. claimed AAPL · lower in the standings"; "Your JPM was
   not sold"); failed ("No free $100–$200 slot at the open: AAPL opened at $203.10").
7. **Refusals in place** (rule 8): claim while open ("Market's open: just buy it"); 6th claim
   ("5 claims pending. Cancel one to claim another."); `claims_processing` on a 9:30 live buy
   ("Claims are being processed. Try again in a minute."); watchlist full.
8. **Home hook** (rule 10), closed market, your call: "Market opens Mon 9:30 AM ET · 2 claims
   pending · 4 on your watchlist".
9. **Draft room**: "Queue" (draft) and "Save" (watchlist) both visible and labelled; no
   "Claim" during a draft.
