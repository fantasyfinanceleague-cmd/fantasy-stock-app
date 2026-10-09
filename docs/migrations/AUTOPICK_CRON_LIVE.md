# Auto-pick cron: go live

Branch `ops/autopick-cron-live`. Server-side draft auto-pick, so no draft turn (bot or timed-out human) depends on a client being open.

**What this ships (3 migrations, one `db push`, after a live test):**

| File | What |
|---|---|
| `20261106000000_schedule_draft_autopick_sweep.sql` | The cron: every 10 s, posts to `draft-autopick-sweep` only when a turn is worth a call. Was `deferred/20261010000001`. Adds a stall throttle (D1) and an explicit `timeout_milliseconds := 180000`. |
| `20261106000001_purge_cron_run_details.sql` | Daily purge of pg_cron's own run log older than 7 days (D2). Plain SQL, no HTTP. |
| `20261106000002_drafts_refuse_new_skip.sql` | BEFORE INSERT/UPDATE-OF-symbol trigger refusing a new `SKIP` row (D3). Was `deferred/20261101000002`, body unchanged. |

**Rule of this runbook:** every SQL step is read-only except the steps marked **WRITES**: the §1b opt-out, the test league's `pick_seconds` (§2.4), **the manual sweep (§4, which is NOT scoped to the test league: it picks and finalizes every overdue clocked league, exactly like the cron)**, the §7 abort lever, the §8 `db push`, and the §10 rollback. Never paste a key anywhere. The sweep step reads the key from the vault inside the statement.

---

## 0. Why the order matters (read once)

- **There is no client auto_pick in prod.** The mobile "ask the server to auto-pick when my clock hits 0" code (0–3 s jitter) is only on the unmerged `ui/mobile-game` branch. 1.1.0 only fires `bot_pick`, and only while the draft room is open; web is paused. So today the cron is the **only** thing that fills a timed-out *human* turn, and during the test "no client open" simply means "don't open the draft room".
- **The moment the cron lands it touches every league that is `in_progress` with `pick_clock_enabled = true` and an overdue turn**, finishing it and creating its matchups and season. Any draft started and abandoned since 2026-09-29 qualifies. So §1 (F2) is mandatory and comes first, and the live test (§2–§6) runs **before** the merge, against the function that is already deployed and byte-verified (`b5499bb`), so the cron is proven before anything is applied.
- `supabase db push` applies every pending file. Nothing here is held back: the three files go together.

---

## 1. Preflight (read-only, SQL editor)

### 1a. Versions and current state

```sql
select
  (select extversion from pg_extension where extname = 'pg_cron')  as pg_cron,   -- expect 1.6 (>= 1.5 for '10 seconds')
  (select extversion from pg_extension where extname = 'pg_net')   as pg_net,
  (select count(*) from cron.job where jobname in ('draft_autopick_sweep', 'purge_cron_run_details')) as already_scheduled, -- expect 0
  (select count(*) from public.overdue_draft_turns())              as overdue_turns_now;
```

### 1b. F2: every clocked draft the cron would touch (read-only)

```sql
select l.id, left(regexp_replace(coalesce(l.name, ''), '[[:cntrl:]]', ' ', 'g'), 40) as name,
       l.commissioner_id, l.pick_seconds, l.draft_started_at,
       (select count(*) from league_members m where m.league_id = l.id)                          as members,
       (select count(*) from league_members m where m.league_id = l.id and m.user_id like 'bot-%') as bots,
       (select count(*) from drafts d where d.league_id = l.id)                                  as picks_so_far,
       l.num_rounds * (select count(*) from league_members m where m.league_id = l.id)           as total_picks,
       c.deadline_at,
       (c.deadline_at <= now())                                                                  as overdue_now
  from leagues l
  left join lateral public.get_draft_clock(l.id) c on true
 where l.draft_status = 'in_progress' and l.pick_clock_enabled
 order by l.draft_started_at;
```

**Giorgio decides each row before anything else.** Default recommendation: **opt it out**, so the cron never touches it. Keep a row only if it is a draft people are really playing.

```sql
-- WRITES (one league per run; the SQL editor has auth.uid() NULL, so the trigger allows it)
update leagues set pick_clock_enabled = false where id = '<LEAGUE ID>' returning id, name, pick_clock_enabled;
```

(Re-enabling later is fine: the trigger starts a *fresh* clock at that moment, `draft_started_at := now()`.)

### 1c. Confirm

Re-run 1b: every remaining row is one you chose to keep. Then:

```sql
select * from public.overdue_draft_turns();   -- expect 0 rows now (nothing is overdue that you did not choose)
```

**Re-run this exact query immediately before the first manual sweep (§4) and again immediately before `db push` (§8).** A real or TestFlight user can start a clocked draft and abandon it at any time in between, and both the manual sweep and the cron treat it like any other. The only row allowed is the test league. If any other `league_id` appears: **stop and opt it out first** (§1b).

---

## 2. Create the test league (on the phone, app 1.1.0)

Sign in as the account in `DRAFT_BOTS_ALLOWED_EMAILS` (the test account; bots are gated to it).

1. Create a league named `autopick-test-<MMDD>`. Set **4 participants**, any stake mode, any playoff setting (a matchup league is fine), and a **draft date of now** (Start is refused until the draft date has been reached).
2. In the app, tap **Add bots** (fills to 4 members: you plus 3 bots). Do **not** start yet.
3. Find the league id in the SQL editor (read-only):

```sql
select id, left(regexp_replace(coalesce(name, ''), '[[:cntrl:]]', ' ', 'g'), 40) as name, commissioner_id,
       draft_status, pick_seconds, pick_clock_enabled, num_participants
  from leagues where name like 'autopick-test-%' order by created_at desc limit 3;
-- The league you made is the one whose commissioner_id is YOUR user id. Any user may name a league the same way.
```

4. **WRITES** (the test league only; `pick_seconds` is changeable only while `not_started`, which is why this is before Start):

```sql
update leagues set pick_seconds = 30
 where id = '<TEST LEAGUE ID>' and draft_status = 'not_started'
returning id, name, pick_seconds, draft_status;     -- must return 1 row with pick_seconds = 30
```

> **The "freeze slot edits" migration (20261104) does not interfere:** it exempts `auth.uid() IS NULL` callers (the SQL editor), and neither `pick_seconds` nor `pick_clock_enabled` is a frozen column. The existing `enforce_leagues_pick_clock` trigger allows both of these updates here (`pick_seconds` while `not_started`; `pick_clock_enabled` for a server-side caller).

## 3. Start it, then close every app

1. In the app tap **Start draft**.
2. **Immediately force-quit the app** and keep it closed until §6 is done. If the draft room stays open, 1.1.0 fires `bot_pick` for bot turns itself, and then a `bot` pick no longer proves the sweep.
3. Note the clock (read-only):

```sql
select * from public.get_draft_clock('<TEST LEAGUE ID>');   -- clock_running = true, deadline_at = draft_started_at + 30 s
```

## 4. Let a turn expire, trigger ONE sweep by hand (**WRITES**, and NOT scoped to the test league)

The sweep picks and finalizes **every** overdue clocked league (up to 20), may create matchups and seasons, and may push commissioners. It is safe here only because §1c showed no other overdue league. **Re-run §1c now; proceed only if the test league is the sole row.**

First confirm the gateway is passing our function through (no credential, so this carries no key):

```bash
curl -s -X POST https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/draft-autopick-sweep -w '  HTTP %{http_code}\n'
```

It must print exactly `{"error":"Unauthorized"}  HTTP 401` (the function's own 401). A different body means the gateway is answering instead of our code (the `verify_jwt` flip did not take): stop and tell the Orchestrator.

Wait until `now() > deadline_at` (about 35 s after Start). Then, in the SQL editor:

```sql
-- NEVER paste a key. The statement reads it from the vault; do not select decrypted_secret by itself.
select net.http_post(
  url     := 'https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/draft-autopick-sweep',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_apikey' limit 1)
  ),
  body    := '{}'::jsonb,
  timeout_milliseconds := 180000
) as request_id;
```

It returns a `request_id`. Wait ~10 s, then (informational only, the **data** in §5 is the proof):

```sql
select id, status_code, timed_out, error_msg, left(content::text, 700) as content
  from net._http_response where id = <request_id>;
```

Expected `status_code` 200 and content like
`{"ok":true,"examined":1,"overdue_total":1,"results":[{"league_id":"…","pick_number":1,"outcome":"picked","pick_source":"bot"}],"errors":[]}`.

| You see | Meaning |
|---|---|
| `401` | The apikey did not match `SB_SECRET_KEY_CRON` (the pre-check above proved the 401 is ours): vault key vs function secret drifted, or the vault row is missing (the post then carries a null apikey). Stop and tell the Orchestrator. |
| `500` with `server_config_error` | `ALPACA_API_KEY` / `ALPACA_API_SECRET` is unset on the function. Stop. |
| `200`, `examined: 0` | Nothing overdue yet (clock not expired), or this league's `pick_clock_enabled` is false. Re-check `get_draft_clock`, then re-run. |
| `outcome: "stalled"` / `"price_unavailable"` | Real signals (no legal stock / Alpaca). Read the function logs and stop. |
| `outcome: "pick_conflict"` | Someone else wrote the turn first. A success; re-run. |
| `status_code` NULL, `timed_out` true | pg_net gave up waiting; the function may still have run. Go by the data in §5. |

## 5. Verify by DATA (not by the response)

```sql
select pick_number, user_id, symbol, entry_price, quantity, pick_source, recorded_at
  from drafts where league_id = '<TEST LEAGUE ID>' order by pick_number;
```

You want `pick_source = 'bot'` on a bot's turn and `'auto_queue'` / `'auto_best'` on yours. **Repeat §4 about every 35 s** (the sweep makes at most one pick per league per run, and each pick starts the next turn's 30 s clock) until you have seen **at least one bot pick and one pick of your own**. With 4 managers that is within the first ~5 picks.

## 6. The proof (read-only, one block)

Open [`docs/security/autopick-live-test-proof.sql`](../security/autopick-live-test-proof.sql), replace `<TEST_LEAGUE_ID>` (find-and-replace is fine), run it. Output arrives as the editor's error text, headed `AUTO-PICK LIVE TEST PROOF (read-only): PASS` or `FAIL`. It checks, on the test league:

| Line | Proves |
|---|---|
| P1 | at least one human `auto_*` pick and one `bot` pick exist |
| P2 | `pick_source` matches the manager kind (no bot row with a human source, and vice versa) |
| P3 | zero SKIP rows |
| P4 | pick numbers are 1..N, no gap, no duplicate |
| P5 | price and quantity > 0 on every pick; no symbol drafted twice |
| P6 | every pick is in one of **this league's** slots, and no manager is over a slot's `slot_count` (the same slot rules a manual pick passes) |
| P7 | every auto/bot pick came at least `pick_seconds` after its clock anchor |
| P8 | no open `draft_stalls` row |

**Any FAIL: stop, do not promote, send the output to the Orchestrator.** This script is itself tested: `supabase/tests/autopick_runbook_sql.pglite.test.ts` runs it verbatim on real Postgres and checks that each defect flips exactly its own line.

## 7. Clean up the test league (nothing to delete)

**Preferred: leave the draft running.** It is now a clocked, in-progress draft the live cron will finish by itself with no app open. That *is* the post-promotion data check (§9c). When it completes it becomes an inert finished test league like `test_0925`.

**Abort lever (WRITES; only the test league):** if anything looks wrong, take it out of the sweep's reach instantly. It drops out of `overdue_draft_turns()` on the next read and nothing else is touched:

```sql
update leagues set pick_clock_enabled = false where id = '<TEST LEAGUE ID>' returning id, pick_clock_enabled;
```

There is deliberately **no `DELETE`**: no delete-league path exists, several legacy foreign keys to `leagues` predate the repo's migrations and cannot be verified from here, and an unfinished clock-disabled draft is inert.

---

## 8. Promotion (HUMAN ACTION, after §6 passed and §1 is settled)

1. Review and merge the PR (Giorgio's; merge = Vercel prod deploy, but this PR touches no web code).
2. Refresh the deploy checkout and confirm it is linked:

```bash
git -C /Users/giorgio/fantasy-stock-deploy fetch origin && git -C /Users/giorgio/fantasy-stock-deploy checkout --detach origin/main
cat /Users/giorgio/fantasy-stock-deploy/supabase/.temp/project-ref   # must print haiaaifjcclsvmkfqgmd
```

3. **Re-run §1c** one more time (the only overdue row allowed is the test league, or none), then preview and apply (both from `/Users/giorgio/fantasy-stock-deploy`):

```bash
supabase db push --dry-run   # must list EXACTLY: 20261106000000, 20261106000001, 20261106000002 (and nothing else; 20261104/05 are other workstreams' and may appear if they merged first, which is fine)
supabase db push
```

If the dry run lists anything unexpected, **stop** (`db push` applies every pending file).

> **Ordering with other workstreams:** these files are stamped `20261106…`, later than the reserved `20261104` (freeze slot edits) and `20261105` (Run it back) ranges. If this push lands **first** and one of those merges afterwards, plain `supabase db push` will refuse the older-stamped file ("local migration before last remote") and would need `--include-all`, which we do not use. So whoever pushes second must **re-stamp their file later than `20261106000002`** first.

## 9. Verify the promotion (read-only)

**a. Migrations applied and jobs scheduled**

```sql
select version from supabase_migrations.schema_migrations where version in ('20261106000000','20261106000001','20261106000002') order by 1;  -- 3 rows
select jobname, schedule, active, command from cron.job where jobname in ('draft_autopick_sweep', 'purge_cron_run_details') order by 1;
```

`draft_autopick_sweep`: schedule `10 seconds`, `active`, the command contains `timeout_milliseconds := 180000`, `overdue_draft_turns()` and the `draft_stalls` throttle, and **no key literal** (only `vault.decrypted_secrets`). `purge_cron_run_details`: `17 4 * * *`.

**b. The jobs run without a SQL error** (this proves only "no SQL error", never the outcome; `succeeded` is logged on enqueue):

```sql
select j.jobname, d.status, count(*) as runs, max(d.start_time) as last_run
  from cron.job_run_details d join cron.job j using (jobid)
 where j.jobname = 'draft_autopick_sweep' and d.start_time > now() - interval '5 minutes'
 group by 1, 2;   -- expect ~30 'succeeded', 0 'failed'. 'failed' = a SQL error in the command (a dropped function, a missing vault row)
```

**c. The effect, by data** (the real post-promotion check). With **no app open**, the test league (if you left it running) keeps advancing and finishes: re-run §6 as the draft goes, until

```sql
select l.draft_status, (select count(*) from drafts d where d.league_id = l.id) as picks,
       (select count(*) from matchups m where m.league_id = l.id) as n_matchups
  from leagues l where l.id = '<TEST LEAGUE ID>';   -- draft_status = 'completed', n_matchups > 0 (a matchup league)
```

and the §6 proof (P7: every gap ≥ 30 s) still reads PASS. At 30 s per pick, the remaining picks take about `picks_left x 30 s`. If you aborted instead (§7), run any later real overdue turn through the same checks.

**d. The SKIP trigger** (read-only; **nothing persists**): open [`docs/security/refuse-new-skip-effect-test.sql`](../security/refuse-new-skip-effect-test.sql), replace `<TEST_LEAGUE_ID>` (any league with a human member), run it. Expect `REFUSE-NEW-SKIP EFFECT TEST (all rolled back): PASS`: the trigger exists (T0), is not executable by anon/authenticated (T1), refuses an INSERT of `SKIP` and `skip` with `23514` check_violation (T2, T3), refuses an UPDATE *to* `SKIP` (T4), and the existing legacy SKIP rows are still readable (T5). Also run, as a plain read:

```sql
select count(*) as legacy_skip_rows_still_readable from drafts where upper(symbol) = 'SKIP';
```

**e. The purge job ran without an error** (check after the first 04:17 UTC run; the oldest-row check in §12 alone would not expose a permission failure):

```sql
select d.status, d.return_message, d.start_time
  from cron.job_run_details d join cron.job j using (jobid)
 where j.jobname = 'purge_cron_run_details' order by d.start_time desc limit 3;   -- status 'succeeded', return_message like 'DELETE <n>'
```

**f. Refresh the architecture snapshot** (CLAUDE.md: after any grant, RLS or cron change). Run `docs/architecture/db-snapshot.sql` against prod, save the single output cell as `docs/architecture/db-snapshot.json`, then `node scripts/gen-architecture.mjs` and commit. Until then the map's drift panel carries one **expected** high row, `refuse_new_skip_rows()` "ABSENT from prod snapshot" (it only means the snapshot predates the push); it clears after this step. Then update `docs/STATUS.md` (cron table, migrations-applied line, items 5/19) and record the apply date in `supabase/migrations/deferred/README.md` History.

## 10. Rollback (HUMAN ACTION, if needed)

Each piece is independent and instant. These are hand-run statements against prod:

```sql
select cron.unschedule('draft_autopick_sweep');            -- the sweep stops; clients/bot_pick still work; stalled-turn recovery reverts to "needs a client"
select cron.unschedule('purge_cron_run_details');          -- the log just grows again
drop trigger drafts_refuse_new_skip on public.drafts;      -- SKIP rows become insertable again (nothing writes them)
```

---

## 11. Load and safety

**Idempotent with every other pick writer.** Bot picks (`bot_pick`), a client `auto_pick` (when 3c ships), the sweep, and any number of overlapping sweeps all insert through `insertGatedPick`. The unique `(league_id, pick_number)` index is the arbiter: the loser gets `23505` → `pick_conflict`, writes nothing, and the sweep counts it as a success. Each sweep also re-reads `get_draft_clock` per league before picking, and a just-recorded pick re-anchors the next turn's clock, so a second sweep finds the next turn not yet overdue: no double pick, no burst through consecutive turns. The mobile D3 client backstop (random 0–3 s delay, only on `ui/mobile-game` today) is therefore safe alongside it by construction.

**Two sweeps at once.** pg_cron will not overlap one job's *runs*, but the HTTP posts are asynchronous and can overlap (a sweep pricing through Alpaca while the next tick fires). That is safe by the above. The cost is duplicate Alpaca lookups, and at most a duplicate commissioner push at outage escalation (at-least-once by design: `escalated_at` is set only after a sent push).

**The timeout (`180000` ms).** It does **not** control overlap: pg_net's timeout only bounds how long pg_net waits before it records a response, the edge function runs to completion regardless (CLAUDE.md success signals #8). It is above Supabase's 150 s gateway idle timeout, so `net._http_response` always holds a *real* status (a hung sweep ends in the gateway's 5xx, never a NULL "Timeout of N ms reached" row). Worst case, every sweep hangs to that cut and about 15 are in flight; in practice a sweep (max 20 leagues, concurrency 4) takes seconds.

**The stall throttle (D1).** A turn with no legal stock stalls and stays overdue, so without a guard the cron would post every 10 s (~8,640/day) per stalled league. The cron's `NOT EXISTS` skips a turn whose `draft_stalls` row is a **non-`vendor_outage`** stall refreshed in the last 60 s, mirroring `recentStall` and `STALL_COOLDOWN_MS` (60 s) exactly; a test pins the two numbers together. A stalled league is then retried about once a minute. A healthy overdue turn has no stall row and posts within 10 s. It only ever *narrows* the post.

**Vendor outage (#105).** A price outage is per-league and per-symbol (5 min `auto_pick_price_failures` cooldown). After 5 min `draft_turn_outages` escalates once to a `vendor_outage` stall row plus one commissioner push (`escalated_at` is set only after a sent push). With the cron live, an outage now retries unattended every tick. `vendor_outage` is deliberately **not** throttled (the function retries it every tick too, so a draft recovers within seconds of the vendor coming back); the 5 min price cooldown already keeps that cheap.

**Bounded work, and one known limit.** 20 leagues per run, concurrency 4, and anything over is picked up next tick. The function takes `overdue_draft_turns()` ordered by `deadline_at` and keeps the **first 20**, and it does not apply the stall throttle. A stalled league keeps its old anchor and so sorts first forever: with **20 or more** stalled/`vendor_outage` leagues at once, a healthy overdue league behind them would never be examined (the cron would still post, because the healthy turn passes the SQL predicate). Not reachable at today's scale (one test league), and fixing it means changing and redeploying `draft-autopick-sweep` (skip recently-stalled non-outage turns *before* slicing, or order healthy turns first). **Follow-up, not in this PR;** the stalled-count alarm in §12 is the tripwire until then.

**`cron.job_run_details` growth (F4).** Every 10 s tick is logged even when the command posts nothing (~8,640 rows/day). The purge job keeps 7 days.

## 12. Monitoring: how we'll know it keeps working

**Standing check (run any time; expect 0 rows, or only `STALLED` / `VENDOR OUTAGE` rows that already have a commissioner notice):**

```sql
select o.league_id, left(regexp_replace(coalesce(l.name, ''), '[[:cntrl:]]', ' ', 'g'), 40) as name, o.pick_number, o.deadline_at, now() - o.deadline_at as overdue_by,
       case
         when s.league_id is not null then 'STALLED (' || s.reason || ', attempts ' || s.attempts || '): commissioner notified, needs a human'
         when t.league_id is not null then 'VENDOR OUTAGE, retrying every tick; escalates to a stall at 5 min'
         else 'SWEEP FAILING: no stall or outage row. Read the draft-autopick-sweep logs (errors[]) and the recent net._http_response codes'
       end as diagnosis
  from public.overdue_draft_turns() o
  join leagues l on l.id = o.league_id
  left join draft_stalls s on s.league_id = o.league_id and s.pick_number = o.pick_number
  left join draft_turn_outages t on t.league_id = o.league_id and t.pick_number = o.pick_number
 where o.deadline_at < now() - interval '2 minutes'
 order by o.deadline_at;
```

A `SWEEP FAILING` row means that league's sweep has been failing for 2+ minutes: that is the alarm. A stalled league also shows in `draft_stalls` (`select * from draft_stalls order by last_seen_at desc;`), which the commissioner sees in-app.

**Stall tripwire** (how the 20-league limit in §11 would show up; expect a handful at most, and none old):

```sql
select count(*) as open_stalls, min(first_seen_at) as oldest, count(*) filter (where reason = 'vendor_outage') as outage_rows from draft_stalls;
```

**The cron is posting and being accepted** (statuses, last hour, all jobs; since the timeout is 180 s these are real statuses; a run of `401`s means the key drifted or the vault row is missing (the post then carries a null apikey and the cron still logs `succeeded`), `5xx` means the function is failing; `net._http_response` keeps about 6 h):

```sql
select status_code, count(*) from net._http_response where created > now() - interval '1 hour' group by 1 order by 2 desc;
```

**Picks by source, last 24 h** (proof that picks keep being written by the server):

```sql
select pick_source, count(*) as picks, max(recorded_at) as latest
  from drafts where recorded_at > now() - interval '24 hours' group by 1 order by 2 desc;
```

**The purge is working** (after the first 04:17 UTC run, `oldest` should sit at about 7 days and stay there):

```sql
select count(*) as rows, min(start_time) as oldest from cron.job_run_details;
```

Remember (CLAUDE.md success signals): `cron.job_run_details` says `succeeded` on enqueue and `net._http_response` is only as truthful as its timeout; **the standing check above and the `drafts` data are the ground truth.**

## 13. What is and is not tested here

- **Cannot run in PGlite:** the cron itself (`pg_cron`, `pg_net` and `vault` do not exist there). Covered instead by (a) the live test in §2–§6, (b) `supabase/tests/autopick_cron_wiring.test.ts` (schedule, vault key, no key literal, explicit 180000 ms timeout, throttle window equals `STALL_COOLDOWN_MS`, vendor_outage not throttled, purge is plain SQL, stamps in order, nothing left in `deferred/`), and (c) `supabase/tests/autopick_cron_predicate.pglite.test.ts`, which slices the cron's actual `where exists (...)` out of the migration and **executes it** on real Postgres against a stubbed `overdue_draft_turns()` and `draft_stalls` (11 cases, including the 59 s / 61 s window edges).
- `supabase/tests/refuse_new_skip.pglite.test.ts`: the trigger on real Postgres with legacy SKIP rows already in the table (including a padded `' SKIP'` and a no-op `symbol = symbol` UPDATE on a legacy row).
- `supabase/tests/autopick_runbook_sql.pglite.test.ts`: both runbook scripts, verbatim, good fixture plus 10 mutations.
- `supabase/tests/migration_cli_split.test.ts`: every migration (including the three new ones) splits cleanly under the CLI's splitter.

## HUMAN ACTION, in order

1. §1: run 1a/1b; decide each clocked league (default: opt out); 1c shows 0 overdue rows.
2. §2–§3: create `autopick-test-<MMDD>` on the phone, set `pick_seconds = 30`, Add bots, Start, force-quit the app.
3. §4–§5: run the manual sweep about every 35 s until a bot pick and a pick of yours exist.
4. §6: run the proof script; it must say PASS. **Stop on any FAIL.**
5. Merge the PR (Giorgio only).
6. §8: refresh the deploy checkout, `db push --dry-run` (exactly the three files), `db push`.
7. §9a–§9d: schema_migrations, `cron.job`, the data check (test league finishes with no app open), the SKIP effect script.
8. §9e–§9f: the purge ran clean; refresh `db-snapshot.json`, regenerate the map, update STATUS and the deferred README History.
9. Add the §12 standing check to your routine.
