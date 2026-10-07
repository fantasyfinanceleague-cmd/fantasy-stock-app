# Draft pick clock + server auto-pick

Branch `feat/draft-pick-clock-autopick`. Product rules: Giorgio, 2026-09-29.

**The rules.**
- Every turn has a clock. The default is **60 s**. The commissioner can set **30 / 45 / 60 / 75 / 90 s** when creating the league, and can change it until the draft starts.
- When the clock runs out, **the server picks**. It tries the manager's **queue** first, in the manager's order, taking the first symbol that is still legal. Then it tries **best available**. It never picks at random.
- A turn is skipped only when **nothing** is legal.

## How it works (one paragraph)

- **One deadline.** It has a single definition, `public.get_draft_clock`: the later of the draft start and the latest pick's `recorded_at`, plus `pick_seconds`, on the **database clock**.
  - Clients use it to show the countdown.
  - The server's auto-pick gate and the cron's overdue check read the same function.
- **Two triggers fire an auto-pick.**
  - A connected client calls `auto_pick` when its countdown reaches zero.
  - A cron sweep (`draft-autopick-sweep`) runs every ~10 s, but only when some turn is overdue.
- **One tie-breaker.** The `drafts (league_id, pick_number)` unique index lets exactly one row win each pick. A manual pick at 59.9 s and an auto-pick at 60 s produce one pick: whichever commits first. The other caller gets `pick_conflict`.
- **No bursts.** Each auto-pick's own row starts the next turn's full clock, so several absent managers in a row are picked one full clock apart.

## API for clients

Keep these names stable. The Design Lead's UI depends on them.

### Read the clock: `rpc('get_draft_clock', { p_league_id })`

Members only; RLS returns zero rows to anyone else. The call returns one row:

| field | meaning |
|---|---|
| `draft_status` | `not_started` / `in_progress` / `completed` |
| `clock_running` | `true` iff the draft is in progress **and** clocked. When it's `false`, show no countdown. |
| `pick_seconds` | 30–90 |
| `picks_made` | rows in `drafts`, so the turn on the clock is `picks_made + 1` |
| `turn_started_at` | when the current turn's clock started (`null` if not running) |
| `deadline_at` | when it runs out (`null` if not running) |
| `server_now` | the DB clock at read time |

**Countdown:**

```
remaining = deadline_at − (server_now + (Date.now() − fetchedAtLocal))
```

This corrects for a device clock that's wrong. Re-read the clock on every realtime `drafts` INSERT.

### When the countdown hits 0: `functions.invoke('validate-and-record-pick', { body })`

Send `{ league_id, action: 'auto_pick', pick_number }`, where `pick_number` is the turn that expired (`picks_made + 1`). Fire it after a random 0–1.5 s delay, then wait for the realtime INSERT. Any member may send it, and the server decides whose turn it is.

| response | meaning / client action |
|---|---|
| `{ok:true, pick, pick_source, price_source, draft_complete, status_update_error}` | auto-picked; show it |
| `{ok:true, already_recorded:true, pick_number}` | someone else got there first; do nothing |
| `{ok:false, reason:'not_overdue', deadline_at, server_now}` | the device clock is off; resync and wait |
| `{ok:false, reason:'pick_conflict'}` | the race was lost; refetch picks |
| `{ok:false, reason:'price_unavailable'}` | market-data outage; the turn stays open and the sweep retries |
| `{ok:false, reason:'draft_complete', status_update_error}` | every pick is made and the finalize is being retried; show "finalizing" |
| `{ok:false, reason:'stale_pick_number' \| 'clock_not_running' \| 'draft_not_in_progress'}` | refetch state |

**Existing actions:** `pick`, `skip`, `bot_pick` and `finalize` keep their shapes. Successful rows and responses now also carry `pick_source`.

### "Auto-picked" label: `drafts.pick_source`

| value | UI |
|---|---|
| `manual` | normal pick |
| `bot` | bot pick (bots are always auto; no label needed) |
| `skip` | skipped (voluntary, or a bot with nothing legal) |
| `auto_queue` | **Auto-picked from queue** |
| `auto_best` | **Auto-picked: best available** |
| `auto_skip` | **Auto-skipped: nothing legal** |

"Auto-picked" means `pick_source LIKE 'auto_%'`. Select `pick_source` with the other `drafts` columns.

### The queue

- **Read:** `.from('draft_queue').select('symbol, position').eq('league_id', id).order('position')`. Owner-only; nobody else can see it.
- **Write:** `rpc('set_draft_queue', { p_league_id, p_symbols: string[] })` **replaces the whole list**. Add, remove and reorder all mean "send the new list".
  - The server uppercases, trims and de-duplicates the list.
  - Max 50 symbols.
  - Refusals, returned as `{ok:false, reason}`:
    - `not_authenticated`
    - `not_a_member`
    - `draft_completed`
    - `too_many`
    - `unknown_symbols` (includes a `symbols` list; it reveals nothing, because `symbols` is world-readable)
  - Success returns `{ok:true, symbols}`.
- Symbols that are picked or owned stay in the queue. Grey them out; the auto-pick skips them.

### Setting the clock

`leagues.pick_seconds` is written with the league on insert (omit it for the default of 60), or updated by the commissioner while `draft_status = 'not_started'`. After that the DB refuses changes (`pick_seconds_locked`, 22023). A CHECK allows only 30/45/60/75/90.

## Auto-draft never breaks a league's rules (the acceptance criterion)

Giorgio's hard requirement: **auto-draft must never give someone a stock their league's criteria forbid.** That covers price brackets, category slots, `budget_cap`, the draftable universe (`allow_undraftable = false`), league-owned symbols, and any rule added later. It's enforced by structure, not by care:

- **One authority.** Every candidate, from the queue or best available, human or bot, is judged by `_shared/pick-gate.ts` `gatePick`. That is the same `validatePick` a manual pick passes, fed the **live** Alpaca fill price, the symbol's category eligibility (the same three-layer rule), and the catalog's `is_draftable`.
- **The writer takes a decision, not a symbol.** `gatePick` is the only producer of a `GatedPick`, and a module-private brand makes an object literal fail to compile. `_shared/draft-write.ts` `insertGatedPick(admin, GatedPick, pickSource)` is the only code that inserts a non-SKIP `drafts` row, and it accepts nothing else. The manual pick path uses it too, so a rule added to `validatePick` applies to every pick the day it's added.
- **Guarded by a structural test.** `supabase/tests/draft_insert_sites.test.ts` fails if any other `drafts` insert, upsert, update or delete, or any `as GatedPick` cast, appears in the functions.

## Best available (decided: the largest company that fits)

Giorgio: like fantasy football's best available. Walk the market by size and take the next stock that fits the league's criteria.

- **The search.** `public.auto_pick_search_candidates` runs once per **open slot**. It returns the largest stocks, by market cap, that fit that slot:
  - the slot's price bracket on the cached price, with the top clamped to the remaining budget in `budget_cap`;
  - the slot's category (overrides replace the industry rule, mirrored from `effectiveCategoryIds` and proven equal in PGlite);
  - `is_draftable` unless the league allows the full universe;
  - `active`, and not Alpaca-unsupported;
  - not owned in the league and not already tried.

  A stock far outside any "top N" is found when it's the only fit.
- **Paging.** Rounds repeat, excluding what was tried, until a candidate passes the live gate or the search comes back empty.
- **Ranking.** The pluggable `BEST_AVAILABLE_STRATEGY` in `_shared/auto-pick.ts` (default `market_cap_desc`) orders each round. A different basis is a new strategy object; the timer and the gate don't change.
- **Bounds (documented):** at most **5** live-priced queue candidates and **15** live-priced best-available candidates, so at most 20 Alpaca calls per auto-pick.
- **`auto_skip` is recorded only when:**
  - the search returns nothing for every open slot (nothing legal on the catalog's prices: roster, budget or category exhausted), or
  - all 15 best-available candidates were refused by the live gate (the catalog's cached prices disagreed with live prices 15 times in a row).

  It is never recorded when **no** candidate could be priced: during an Alpaca outage a human's turn stays open and the sweep retries.
- **Queue items** are tried in the manager's order. A queued stock that has since become illegal (owned, off-bracket, not draftable) is skipped, never forced. One whose live price has left its bracket is refused by the gate and skipped the same way.

## Drafts already running when this ships (Q2, pending Giorgio)

- The migration sets `pick_clock_enabled = false` on every league already `in_progress`, so **the sweep never touches them**. The hold covers **only that running draft**: the trigger forces the clock back on at that league's next draft start (a new season, or a re-draft), whoever starts it.
  - Clients can't change that flag.
  - Such a draft keeps working the old way: manual picks plus client-fired bot picks, with no clock.
- Giorgio picks one of these per league, as a separate explicit step (SQL editor):
  - **Opt in** (the clock starts fresh from that moment; the sweep will finish the draft and finalize the season):
    ```sql
    UPDATE public.leagues SET pick_clock_enabled = true WHERE id = '<id>';
    ```
  - **Abandon it by hand** (Giorgio's call how, e.g. delete the test league).
- To list them:
  ```sql
  SELECT id, name FROM leagues WHERE draft_status = 'in_progress' AND NOT pick_clock_enabled;
  ```

## HUMAN ACTIONs (in order)

- **H0 (read-only).** `SELECT extversion FROM pg_extension WHERE extname = 'pg_cron';` must be ≥ 1.5 for the `'10 seconds'` schedule. Otherwise edit the deferred file to `'* * * * *'` (see its header). `drafts.created_at` is no longer needed; the clock uses the new `recorded_at`.
- **H1.** `db push` of `20261010000000`, from the deploy checkout only (CLAUDE.md). Then run the proacl queries at the bottom of the migration, then `docs/security/draft-pick-clock-effect-test.sql` in the SQL editor. Every line must PASS.
- **H2.** Deploy `validate-and-record-pick` and `draft-autopick-sweep` with `--project-ref haiaaifjcclsvmkfqgmd`. Check that the upload list includes `_shared/auto-pick.ts`, `_shared/draft-write.ts` and `_shared/cron-auth.ts`, then `supabase functions download` each and diff against the commit. A no-credential POST to the sweep must return the function's own `401 {"error":"Unauthorized"}`.
- **H3.** Confirm the `SB_SECRET_KEY_CRON` function secret and the vault `cron_apikey` exist. Both are already used by the other crons; nothing new is needed.
- **H4.** Promoted as `20261106000000_schedule_draft_autopick_sweep.sql` (with the cron-log purge and the SKIP trigger). The live test, the `db push` and every verification query are in `docs/migrations/AUTOPICK_CRON_LIVE.md`; follow that runbook, not this line.
- **H5.** Refresh `db-snapshot.json` (new grants, RLS and cron), then `node scripts/gen-architecture.mjs`. The four "ABSENT from prod snapshot" drift rows should clear.

Old mobile builds keep working. Once H4 is live the server auto-picks for their users too, but the countdown and queue UI arrive only with a new build.

## Monitoring: the stuck-draft check (verify by effect)

The sweep's `ok:true` only means "the sweep ran". Per-league failures (`errors[]`: `unhandled`, `price_unavailable`, `pick_conflict` loops) reach only the function logs, and `cron.job_run_details` / `net._http_response` prove nothing (CLAUDE.md "success signals").

**The effect-based check.** Once H4 is live, every overdue turn is picked within one tick plus pricing time. A turn still overdue minutes later means that league is stuck:

```sql
-- Run as postgres/service role (overdue_draft_turns is service-only).
SELECT o.league_id, l.name, o.pick_number, o.deadline_at, now() - o.deadline_at AS overdue_by
  FROM public.overdue_draft_turns() o
  JOIN public.leagues l ON l.id = o.league_id
 WHERE o.deadline_at < now() - interval '2 minutes';
-- Expect ZERO rows. A row = that league's sweep is failing every tick: read
-- the draft-autopick-sweep logs for its errors[] entry.
```

**Superseded by a richer version** (2026-10-06): `docs/migrations/AUTOPICK_CRON_LIVE.md` §12 splits each overdue row into `SWEEP FAILING` (the alarm), `STALLED` (`draft_stalls` row, the commissioner is notified) and `VENDOR OUTAGE`, and adds the picks-by-source and purge checks. Use that one.

One query is enough: a draft that advances always has a recent `deadline_at`, so an old deadline can only mean nothing has been written for that turn.

- **Before H4** (no cron), a draft where nobody has the app open legitimately shows up here.
- A draft whose picks are all made but whose finalize is failing shows up too. The sweep retries its finalize every tick; the logs carry `finalize_failed:<code>`.

## Tests

- `deno test supabase/functions/_shared/auto-pick.test.ts` (hermetic, 29 tests). The acceptance criterion, **brute-forced**: `chooseAutoPick` runs against an in-memory market whose search mirrors the SQL, and every result is checked against the real `validatePick` over the whole market. It covers:
  - **Sweep 1**, 400 generated rule configurations (brackets, category slots, `budget_cap` near exhaustion, `fixed_notional`, `allow_undraftable` on and off, slots filled, SKIPs, queues, bots) with exact prices: every pick is legal, and every skip happens only when brute force finds **no** legal stock.
  - **Sweep 2**, 400 configurations with stale and unpriceable live prices: never an illegal pick, never more than 20 price calls, never the same symbol priced twice.
  - **Sweep 3**, 400 configurations against a **hostile** search that ignores every rule: the gate alone still never lets an illegal pick through.
  - Targeted cases:
    - the only legal stock ranks below #150 by market cap, behind 300 same-price decoys in the wrong category, and is found on the first attempt;
    - the queue skips a stock that became illegal;
    - budget near exhaustion;
    - undraftable giants;
    - one open slot;
    - stale prices paged past;
    - the 15-refusal bound;
    - outage vs skip;
    - the conflict guard;
    - a `GatedPick` can't be forged (compile-time).
  - Mutation-checked: feeding the gate the cached price, a category-blind search, forcing `isDraftable = true`, and forcing category eligibility **each** fail a test.
- `deno test --allow-read --allow-env supabase/tests/draft_pick_clock.pglite.test.ts`: the migration on real Postgres, loaded verbatim alongside PR #9's leagues guard (18 steps). It covers:
  - grants;
  - the hold and the re-draft case;
  - the CHECK;
  - the trigger;
  - the lock;
  - deadline math;
  - the overdue list;
  - `set_draft_queue`;
  - queue RLS;
  - the 23505 race;
  - **`auto_pick_search_candidates` equal to its TS mirror** across 34 filter combinations (mutation-checked on the override layer).

  It also runs the prod effect test file itself (26/26 PASS, rolled back).
- `deno test --allow-read supabase/tests/draft_insert_sites.test.ts`: the one-writer structural guard (mutation-checked with an extra insert, an upsert, and a forged cast).
- The pg_cron, pg_net and vault SQL in the deferred file can't run in PGlite. It is statically reviewed, and H4's data check is its first real run.
