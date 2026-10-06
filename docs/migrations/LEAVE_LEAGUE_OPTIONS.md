# Leave league — plan

**Status:** BUILT on `feat/leave-league` 2026-10-05, NOT applied and NOT deployed. Q4 defaults to B (pick a successor) until Giorgio rules; the A/C deltas are in §3. The board (#call-leave, PR #122) is reconciled. **"As built" below is authoritative wherever the sections after it differ.**

## As built

- **Migrations `20261107000000`–`06`:**
  - `00`: `league_roster_reconfirm` (`departed jsonb` = `[{user_id, name, left_at}]` with the name snapshotted, `members_before`, `choice` pending|invite, `chosen_by`/`chosen_at`), `league_members.hidden_at`, and the 7-kind notice CHECK.
  - `01`: `leave_league` and `unhide_league` (the latter not exposed).
  - `02`: `confirm_league_roster(league, user, p_choice 'move_forward'|'invite', p_playoff_teams)`.
  - `03`: `get_home_summary` skips hidden leagues. Only that function: `get_home_league` takes an explicit id, so a hidden league can still be opened.
  - `04`: DROP `[I5]`.
  - `05`: `join_league_by_code` clears an `invite` reconfirmation on a human join (only if P ≤ members afterwards), then sets the order if T−1h has passed.
  - `06`: the order WAITS. `_draft_order_sync`, `finalize_due_draft_orders` and `draft_order_notify_due` skip a league whose reconfirmation is owed, and it is set the moment the row clears. `draft_order_notify_due` also ignores `member_left`, which leave-league delivers, never the cron. And `trg_leagues_roster_reconfirm_gate` refuses the draft start for EVERY role while a reconfirmation is owed: it closes the raw `[I2a]` flip and draft-control's read-then-flip window.
- **Edge:**
  - `leave-league` exposes only `leave` and delivers the `member_left` push once.
  - There is no second notice when the same person leaves again while the same confirmation is owed.
  - A NEW departure resets `choice` to pending.
  - draft-control `confirm_roster` takes `{choice, playoff_teams?}`, and the `roster_reconfirm_required` blocker carries `choice`.
- **Deploy order:** push `00`–`06`, then draft-control, then leave-league. The new draft-control fails closed without the table.
**Branch:** `feat/leave-league`. Migration range `20261107000000`–`04` (of the provisional `00`–`09`).
**Retires:** `[I5]` (`league_members_delete_self`, `20260712000002:34-37`).

## Decisions

Giorgio's words are quoted verbatim; the Orchestrator's reading follows each.

| Q | Ruling |
|---|---|
| **Leave window** | *"you cant leave a league once a draft starts. you can only leave before a season starts (the hour before the draft) or after it is over"*. Leaving is allowed until the order is set at `draft_date` − 1h, blocked from then through the whole season (`locked_in`), and allowed again once the season is over. |
| **After the draft** (was Q2) | *"a player cannot leave a league after a draft, they are locked in for that season."* There is no soft leave, no autopilot team, no forfeit. Q3 and Q5 are moot. |
| **Pre-draft leave** (Q1) | He picked "Reopen the order". On the commissioner's side: *"commissioner either needs to reconfirm the number of players in the league. if they want to move forward with 1 less they can or they invite someone new to replace"*. That becomes a **roster reconfirmation** gate: the draft can't start until the commissioner confirms. |
| **Post-season leave** (Q6) | History must stay for everyone, so it is Q6-A: **hide**. The row and history are kept, and Home skips the league. |
| **The commissioner leaving pre-draft** (Q4) | **Pending.** The plan defaults to B: pick a successor, nothing preselected. A sole human is refused. |

**The post-draft lock is permanent.** `trg_league_members_freeze_leave` (PR #123) refuses user-session membership deletes once `draft_status <> 'not_started'`, and this plan never relaxes it. #123 adds no INSERT guard on `league_members` (Orchestrator, 2026-10-05).

---

## 0. Facts that constrain the design

1. **`[I5]` is a live, unguarded leave.** Before #123, any member can DELETE their own row at any time. After #123 the post-draft half is closed. The pre-draft half stays open until this work drops `[I5]`. The paused web app calls it (`apps/web/src/hooks/useLeagues.js:244`).
2. **Nothing has a foreign key to `league_members`.** A DELETE cascades nothing. Pre-draft that's harmless: no drafts, matchups, standings or snapshots exist yet.
3. **Post-draft `[I5]` leaves that already happened left zombies.** If a zombie holds a top-P seed, `start_league_playoffs` refuses with `bracket_non_member` (`20261012000001:171-174`) every run. (Standings rows survive the DELETE, so it's not `standings_rank_refused`.) Late draft calls also 500 `draft_order_invalid` (`checkStoredOrder`, `draft-validation.ts:151`). See the zombie repair and pre-check at the end.
4. **The draft-order trigger already does the pre-draft order bookkeeping** (`sync_draft_order_on_member_change`, `20261013000000:663-760`).
   - On DELETE: with no meta row (random mode before the reveal) there's nothing to do; `open`/`finalized` → it removes the leaver and closes the gap; `locked` + `in_progress` → it raises.
   - Order state only runs forward (open → finalized → locked), for every role. So "reopen the order" CANNOT mean moving the state backwards. It becomes a separate reconfirmation gate (below).
5. **"Order is set" is time-based:** `_draft_order_is_due(draft_date)` = `draft_date IS NOT NULL AND now() >= draft_date − 1h` (`20261013000000:215-222`). Every order write path reads it, not only `state`.
6. **Commissioner power is `leagues.commissioner_id`, not membership.** `is_commissioner()` never checks membership, and there is no transfer code. #123 freezes `commissioner_id` for user sessions post-draft only.
7. **The freeze triggers treat any `auth.uid() IS NOT NULL` caller as a user session,** SECURITY DEFINER included. That's why all writes here run on the service role.
8. **draft-control start doesn't need a full league.** Its blockers are state, stake mode, date reached, members ≥ 4, a valid P, and P ≤ members, plus feasibility (`draft-control/rules.ts:56-103`). "Move forward with 1 less" therefore needs no `num_participants` change. Fewer members only makes slot feasibility easier.

---

## 1. The leave window, exactly

The leave RPC evaluates this under the league row lock:

| League state | Result |
|---|---|
| `draft_status = 'not_started'` AND NOT `_draft_order_is_due(draft_date)` AND order meta state ∉ (`finalized`, `locked`) | **Leave** (§2) |
| `draft_status = 'not_started'`, but due OR finalized | **refused `locked_in`** (the order is set) |
| `draft_status <> 'not_started'` AND `season_status <> 'completed'` | **refused `locked_in`** |
| `season_status = 'completed'` | **Hide** (§4) |

- **Why two finalize checks.** `draft_date` can be moved later after the order was finalized. The `state` check catches that case, and the time check catches the window before the finalize cron has flipped `state`. Completeness is the conjunction of both (CLAUDE.md: never trust one half of a partial state).
- **A TBD draft date** (`draft_date IS NULL`) → leaving is allowed.
- **Locked-in copy** (the Design Lead owns the final wording): *"You're locked in for this season. You can leave once it ends."* In the T−1h window before the draft: *"The draft order is set. You can leave once the season ends."* Mobile can show the button disabled with the line, since `draft_status`, `draft_date` and `season_status` are on the league row the screen already reads.

## 2. Pre-draft leave, and the commissioner's roster reconfirmation

**The leave itself:** the RPC deletes the row. The trigger removes the leaver from the order and closes the gap (fact 4), and the spot reopens for invites. The leaver can rejoin with the invite code.

**The reconfirmation gate (the shape for Giorgio's "reconfirm the number of players"):**

- **New table `league_roster_reconfirm`:**
  - Columns: `league_id uuid PK → leagues ON DELETE CASCADE`, `departed jsonb NOT NULL` (see As built), `members_before int NOT NULL` (the count at the first unconfirmed leave), `created_at`, `updated_at`.
  - **RLS:** enabled, SELECT for members (`is_member(league_id)`), no client write policy. INSERT/UPDATE/DELETE are revoked from `anon` and `authenticated`, so only the service-role RPCs write it.
  - **Every pre-draft leave upserts it.** A second leave before confirmation appends to `departed` and keeps `members_before`, so the banner can say *"2 managers left: 8 → 6"*.
- **Why a table, not a `leagues` column:**
  - `leagues` carries the whole-row commissioner UPDATE (`[I2a]`) plus #123's freeze triggers. A flag there would be clearable over raw PostgREST, skipping the confirm step.
  - The banner needs *who* left, which a boolean can't carry.
  - It adds nothing to the busiest row in the schema.
  - The row is per league (PK), so "row exists" IS the exact per-league predicate here, not an any-row-over-a-set read.
- **Clearing it.** A new draft-control action `confirm_roster` (commissioner only) with body `{league_id, playoff_teams?}`. It calls the service-role RPC `confirm_league_roster(p_league_id, p_user_id, p_playoff_teams int default null)`, which works under the league row lock:
  1. It checks that the caller is the commissioner and `draft_status = 'not_started'`, and that a reconfirm row exists (otherwise `nothing_to_confirm`, which is idempotent and harmless).
  2. **The `playoff_teams` vs members check.** If `p_playoff_teams` is given, it must be 2 ≤ P ≤ current members (matchup leagues), and it is written. Then, for matchup leagues, if `playoff_teams > current members`, it refuses `playoff_teams_exceeds_members {playoff_teams, members}`. So the commissioner can't confirm a roster the draft would refuse to start, and lowering P happens in the same atomic call. The UI shows a P stepper capped at the member count whenever the current P is too high.
  3. It deletes the reconfirm row.
- **"Invite a replacement".** The commissioner invites as normal (joins are allowed pre-draft, and after T−1h a late joiner is appended to the finalized order). Then they confirm. **Confirmation is always explicit, even when the count is back to `members_before`.** That is Giorgio's "reconfirm the number of players", taken literally. Auto-clearing on a join would also let any member clear it by adding a bot through `[I6]` until `[I6]` is dropped.
- **Start gate.** `computeStartBlockers` gains `{ code: 'roster_reconfirm_required', departed: string[], membersBefore, members }`, ordered right after the state blocker. index.ts reads the table for both `start` and `check_setup`/`status`, so the commissioner's setup screen shows it before draft time. This is a pure rule, tested hermetically in `rules.test.ts`.
- **Race.** Leave vs start is disjoint by time. A leave needs `now < draft_date − 1h`, while start needs `now ≥ draft_date` (the `draft_date_not_reached` blocker) and a commissioner action. Moving `draft_date` needs the same league row the leave locks. No DB trigger on `leagues` is needed.
  - **Residual (accepted, the same class as the documented `[I2a]` limit):** a commissioner can flip `draft_status` over raw PostgREST and skip draft-control's blockers entirely, reconfirmation included. It's self-inflicted and limited to that league, and it closes when `[I2a]` retires.

## 3. The commissioner leaving pre-draft (Q4, default B until Giorgio answers)

- **Successor required.** `leave_league`'s `p_new_commissioner` is required when the caller is commissioner and another human member remains (`successor_required`). The successor must be a current non-bot member (`successor_invalid`).
- **One transaction:** set `leagues.commissioner_id` (writable pre-draft; the service role is exempt from #123 regardless), set the successor's `league_members.role = 'commissioner'`, delete the leaver, and upsert the reconfirm row. **The new commissioner is the one who confirms the roster.**
- **Sole human** (only bots remain): refused `sole_manager` — *"You're the only manager. Delete the league instead."* (delete-league is still client-side `[I3]`.)
- **If Giorgio picks A** (block until transferred): split out `transfer_commissioner(p_league_id, p_user_id, p_new_commissioner)` and make the leave refuse `transfer_first`.
- **If he picks C** (auto-transfer): the successor is the oldest `joined_at` human, then `user_id`. Same transaction.

## 4. Post-season leave = hide

- **`league_members.hidden_at timestamptz`.** It's only set when `season_status = 'completed'`, and the row and all history stay. `is_member()` is unchanged, so the user keeps read access to history.
- **`get_home_summary` skips hidden leagues for that user** (as built; `get_home_league` is unchanged). It is re-created with byte-identical `proacl`/`prosecdef`/`proconfig`, checked in the test the way `league_standings_ranked.pglite.test.ts` does it.
- **Client league lists** that read `league_members` directly filter on `hidden_at` (3c worker). The SELECT policy already returns the column.
- **Unhide:** the same edge function, action `unhide`. The RPC clears `hidden_at` (from a "Past leagues" list).
- `league_members` has no UPDATE policy, so only the service role writes `hidden_at`.

---

## Backend

**Shape:** a service-role edge function → service-role-only RPCs, the same pattern as `record-trade` → `"record_trade_atomic"` and `join-league` → `join_league_by_code`.
- **Why the service role:** a definer RPC called with the user's JWT counts as a user session to #123 (fact 7), and a client-callable RPC taking `p_user_id` would be forgeable.
- **Rejected:** a transaction-local GUC that the freeze triggers recognise. It puts a permanent bypass in every freeze trigger.

**Every RPC below:**
- SECURITY DEFINER with `search_path` pinned.
- EXECUTE revoked from `public`, `anon` AND `authenticated` and granted to `service_role` only, verified by the `proacl` query. The explicit `authenticated` revoke is what closes the `join_league_by_code` class.
- Takes the league row `FOR UPDATE` first.
- Returns `{status, reason, ...}`, the same convention as `start_league_playoffs`. Every refusal writes nothing.

| File | Contents |
|---|---|
| `20261107000000` | `league_roster_reconfirm` table + RLS + grants; `league_members.hidden_at` |
| `20261107000001` | `leave_league(p_league_id uuid, p_user_id text, p_new_commissioner text default null)`. Branches per §1–§4. Refusals: `not_member`, `locked_in`, `successor_required`, `successor_invalid`, `sole_manager`, `already_hidden`. Statuses: `left` / `hidden`. Plus `unhide_league(p_league_id, p_user_id)`. |
| `20261107000002` | `confirm_league_roster(p_league_id uuid, p_user_id text, p_playoff_teams int default null)` per §2 |
| `20261107000003` | `get_home_summary` re-created with the `hidden_at` filter (ACL byte-identical) |
| `20261107000004` | DROP POLICY `league_members_delete_self` (`[I5]`). No client deletes a membership after this; #123's trigger stays as the second layer. |

**Edge:**
- **New `leave-league`** (`verify_jwt=true`): actions `leave` and `unhide`. It calls `getUser()`, validates `league_id` and the optional `new_commissioner_id`, and calls the RPC. It checks `{ error }` on the rpc call (CLAUDE.md success-signal #5), maps refusals to a 200 game-flow refusal (draft-control's convention) and errors to 500.
- **draft-control:** a new `confirm_roster` action, and the `roster_reconfirm_required` blocker in `rules.ts` + index.ts (`start`, `check_setup`, `status`).
- **Web:** `useLeagues.js` `leaveLeague` moves to `functions.invoke('leave-league')` and stops swallowing errors. Web is paused.
- **Mobile:** goes to the 3c worker. The worker gets:
  - the leave sheet with a successor picker;
  - the locked-in disabled state;
  - the commissioner's reconfirm banner with the P stepper;
  - Hide / Past leagues.
- **Commissioner push (added at the Orchestrator's request):** the `member_left` kind (CHECK extended), delivered by leave-league. See As built.
- **After merge:** run `node scripts/gen-architecture.mjs` (new functions and RPCs) and refresh `db-snapshot.json` after the push (a new RLS table and grants).

**Tests:**
- **PGlite**, with the migrations loaded verbatim on top of the real `20261013000000` draft-order chain:
  - every window row in §1, including a finalized order with `draft_date` moved later;
  - the gap closing in no-meta, open and finalized states;
  - the reconfirm upsert across two leaves;
  - confirm with P above, at and below members, the P write, and `nothing_to_confirm`;
  - the commissioner transfer (both `commissioner_id` and role) and the successor refusals;
  - `sole_manager`;
  - hide/unhide and the Home filters, with ACL byte-identical;
  - leave → rejoin via `join_league_by_code`;
  - every refusal writing nothing;
  - `proacl` on all three RPCs;
  - `[I5]` gone.
- **Hermetic:** `rules.test.ts` (the new blocker and its ordering) and `migration_cli_split.test.ts`.
- **Prod effect check:** ONE DO block ending in `RAISE NOTICE 'PASS'` / `RAISE EXCEPTION 'FAIL'`, asserting:
  - the RPCs' `proacl` holds `service_role` only;
  - `[I5]` is absent from `pg_policies`;
  - `league_roster_reconfirm` has no write grants for `anon`/`authenticated`;
  - the `hidden_at` column exists.

---

## Superseded options (kept for the record)

Before Giorgio's rulings, the doc also compared:
- a post-draft soft leave (`left_at`, the team plays on as buy-and-hold);
- a forfeit (auto-losses plus liquidation);
- playoff seeding with departed teams;
- an earlier "reopen a finalized order" (impossible: order state is forward-only).

All are dropped. A finding from them still holds as a fact about the codebase: bots can't trade (`trades.user_id` is a uuid FK to `auth.users`), so "bot takeover" and "frozen portfolio" are the same mechanics.

---

## Zombie repair (existing post-draft `[I5]` leaves)

Under "locked in", a zombie is a member who should never have been able to leave, and the right repair is to **re-insert their `league_members` row**. They are still in matchups, standings and drafts, so re-inserting makes them a normal locked-in member again. It clears `bracket_non_member` and `draft_order_invalid`.

**Snag:** the draft-order trigger raises `draft_order_locked` on any INSERT into a league whose order is locked, for every role (`20261013000000:687-690`). So the repair cannot be a plain INSERT. The options, decided only if the pre-check returns rows:
- **(a) ★ A one-off service-role SQL that disables `trg_league_members_draft_order` for its own INSERT only.** `ALTER TABLE ... DISABLE TRIGGER` / `ENABLE TRIGGER` inside one transaction (it takes an ACCESS EXCLUSIVE lock on `league_members` for that instant). The zombie is already in the locked order (the locked + completed branch keeps the order as history), so the order stays an exact permutation once the row is back. For a legacy league with no order meta, the trigger returns before the locked check, but it first calls `_draft_order_sync`. Confirm on a PGlite replica that the call writes nothing for a completed-draft league before relying on a plain INSERT. (#123 adds no INSERT guard on `league_members`, confirmed by the Orchestrator 2026-10-05.)
- **(b)** A narrowly-scoped `repair_zombie_member` RPC that the trigger recognises.

(a) leaves no permanent bypass. **If the pre-check returns zero rows, none of this is needed.**

---

## Prod pre-check: existing zombies (READ-ONLY, run before the leave-league migrations)

**What it finds.** A "zombie" is a user id that a league still references but that has no `league_members` row. The query looks in four places: matchups (team1/team2), `league_standings`, the stored draft order, and `leagues.commissioner_id`. Every route to one goes through `[I5]` (a self-delete) or a hand edit. The query returns one row per (league, user).

**Run it** in the Supabase SQL editor, which runs as `postgres` (needed for the cross-table read and the `league_standings_ranked` call). It writes nothing. **Zero rows = clean,** and no zombie repair is needed.

**How to read a row:**
- **`blocks_playoff_start = true`**: this zombie holds a top-P seed in an active season, so `start_league_playoffs` will refuse with `bracket_non_member` at season end. This is the urgent case. The fix is the zombie repair above (re-insert the member).
- **`unscored_matchups > 0`**: the team is still being scored every week on frozen holdings. Harmless for scoring, but they show up as a manager no one can see in the member list.
- **`is_commissioner = true`**: the commissioner left. `commissioner_id` still carries every power (fact 5). Re-inserting them as a member restores a consistent state. Post-draft, the commissioner is locked in like everyone else. If the row shows `in_draft_order = false` and `draft_status = 'not_started'`, they left pre-draft: re-insert them, or hand the league to a remaining human (a manual decision).
- **`draft_rows` / `trade_rows`**: holdings that keep the leaver's symbols owned.
- **`in_draft_order = true` with `draft_status <> 'completed'`**: late draft calls 500 with `draft_order_invalid` (fact 3).

```sql
-- leave-league zombie pre-check (read-only). One row per (league, user) that
-- the league references but league_members does not contain.
with refs as (
  select league_id, team1_user_id as user_id, 'matchup' as src from public.matchups where team1_user_id is not null
  union all
  select league_id, team2_user_id, 'matchup' from public.matchups where team2_user_id is not null
  union all
  select league_id, user_id, 'standings' from public.league_standings
  union all
  select league_id, user_id, 'draft_order' from public.league_draft_order
  union all
  select id, commissioner_id, 'commissioner' from public.leagues where commissioner_id is not null
),
zombies as (
  select r.league_id, r.user_id,
         count(*) filter (where r.src = 'matchup')  as matchup_slots,
         bool_or(r.src = 'standings')               as has_standings_row,
         bool_or(r.src = 'draft_order')             as in_draft_order,
         bool_or(r.src = 'commissioner')            as is_commissioner
  from refs r
  where not exists (select 1 from public.league_members m
                    where m.league_id = r.league_id and m.user_id = r.user_id)
  group by r.league_id, r.user_id
)
select l.id as league_id, l.name, l.draft_status, l.season_status,
       l.current_week, l.num_weeks, l.playoff_teams,
       (select count(*) from public.league_members m where m.league_id = l.id) as member_count,
       z.user_id, z.user_id like 'bot-%' as is_bot,
       z.is_commissioner, z.in_draft_order, z.has_standings_row, z.matchup_slots,
       (select count(*) from public.matchups mu
         where mu.league_id = z.league_id and mu.team1_gain is null
           and z.user_id in (mu.team1_user_id, mu.team2_user_id)) as unscored_matchups,
       rk.rank as standings_rank,
       coalesce(l.season_status = 'active' and rk.rank <= l.playoff_teams, false) as blocks_playoff_start,
       (select count(*) from public.drafts d
         where d.league_id = z.league_id and d.user_id = z.user_id) as draft_rows,
       (select count(*) from public.trades t
         where t.league_id = z.league_id and t.user_id::text = z.user_id) as trade_rows
from zombies z
join public.leagues l on l.id = z.league_id
left join lateral (
  select x.rank from public.league_standings_ranked(z.league_id) x where x.user_id = z.user_id
) rk on z.has_standings_row
order by blocks_playoff_start desc, l.season_status, l.id, z.user_id;
```

Validated on PGlite against the verbatim `league_standings_ranked` migration (`20261011000000`), with a fixture of one clean league and one league with a seeded zombie, a ranked-out zombie and a departed commissioner. Exactly the three zombies came back, with the expected flags.
