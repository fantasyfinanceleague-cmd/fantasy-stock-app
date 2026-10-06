# Leave league — options for decision

**Status:** RE-SCOPED 2026-10-05 after Giorgio's ruling on Q2. **Q1, Q4 and Q6 still need decisions.** Nothing is built yet (STATUS §4 item 11).
**Branch:** `feat/leave-league`. Provisional migration range `20261107000000`–`09`.
**Retires:** `[I5]` (`league_members_delete_self`, `20260712000002:34-37`).

## Decisions so far

| Q | Ruling |
|---|---|
| **Q2: leaving after the draft** | **C (Giorgio, 2026-10-05):** *"a player cannot leave a league after a draft, they are locked in for that season."* There is no soft leave, no `left_at` and no autopilot team. |
| Q3: playoffs with a departed team | **Moot.** Nobody departs after the draft. |
| Q5: rejoin / reclaim | **Moot** for post-draft. A pre-draft leaver rejoins with the invite code (see Q1). |
| Q1: leaving before the draft | **Pending.** |
| Q4: the commissioner leaving (before the draft) | **Pending.** |
| Q6: "leaving" a finished league | **Pending.** New question, raised by the Q2 ruling. |

**The post-draft lock is permanent:** `trg_league_members_freeze_leave` (PR #123, the freeze release) refuses user-session membership deletes once `draft_status <> 'not_started'`. This plan does not relax it. The lock is also what makes STATUS item 11's playoff stall unreachable for new leaves. Leaves that already happened through `[I5]` are handled by the zombie repair below.

Each open question gives 2–3 options with consequences and backend shape. ★ = recommendation only: the board mockups and Giorgio decide.

---

## 0. Facts that still constrain the design

1. **`[I5]` is a live, unguarded leave.** Any member can DELETE their own row, commissioner included. Until PR #123 ships, that holds at any time. The paused web app calls it (`apps/web/src/hooks/useLeagues.js:244`). After #123 the post-draft half is closed. The pre-draft half stays open until this work drops `[I5]`.
2. **Nothing has a foreign key to `league_members`.** A DELETE cascades nothing. Pre-draft that is harmless: no drafts, matchups, standings or snapshots exist yet. The draft-order trigger handles the order (fact 4).
3. **Post-draft `[I5]` leaves that already happened left zombies.** The team keeps being scored on frozen holdings. If it holds a top-P seed, `start_league_playoffs` refuses with **`bracket_non_member`** (`20261012000001:171-174`) every run. (That is the real failure, not `standings_rank_refused`, because standings rows survive a DELETE.) Late draft calls also 500 `draft_order_invalid` (`checkStoredOrder`, `draft-validation.ts:151`). See the pre-check and repair at the end.
4. **The draft-order trigger already does the pre-draft bookkeeping** (`sync_draft_order_on_member_change`, `20261013000000:663-760`). On DELETE:
   - no meta row (random mode before the reveal) → nothing to do;
   - `open` or `finalized` → it removes the leaver and closes the gap;
   - `locked` + `in_progress` → it raises `draft_in_progress`.

   Order state only runs forward (open → finalized → locked), enforced for every role. `finalized` = `draft_date` − 1h has passed: no reordering, append/remove only.
5. **Commissioner power is `leagues.commissioner_id`, not membership.** `is_commissioner()` (`20260712000000:47-58`) never checks membership, so a commissioner who deletes their row keeps every power. There is no transfer code. #123 makes `commissioner_id` immutable to user sessions post-draft only, so a pre-draft transfer is still writable.
6. **The freeze triggers treat any `auth.uid() IS NOT NULL` caller as a user session,** SECURITY DEFINER included. So leave writes run on the service role (see Backend).

---

## Q1. Leaving BEFORE the draft (`draft_status = 'not_started'`)

| | **A ★ Leave any time until the draft starts** | **B Leave until the order is finalized (`draft_date` − 1h)** |
|---|---|---|
| What happens | The row is deleted, and the trigger removes the leaver from the order and closes the gap. The spot reopens for invites. | The same, but refused in the last hour, once the order is `finalized` ("The draft order is set; leaving is closed"). |
| Other members see | One fewer manager; later picks move up one. In the last hour, an announced order changes. | The announced order never changes once members have been notified of it (`draft_order_set`). |
| Rejoin | Yes, with the invite code (`join_league_by_code`: the row is gone, the draft hasn't started, capacity is re-counted). | Same, before T−1h. |
| Risk | Low: the trigger's finalized branch already handles a leaver. | Low. The edge case: the time-based finalize must be read the same way the order functions read it ("effectively finalized is time-based", `20261013000000:39`), not from `state` alone. |

**Sub-question: playoff spots.** A leave can leave `playoff_teams` > members.
- **(i) ★ Leave it.** draft-control's start already refuses with `playoff_teams_exceeds_members` (both numbers shown), and the commissioner can still lower P pre-draft.
- **(ii) Auto-clamp.** The leave RPC lowers P to the new member count (minimum 2). This is a silent rule change by someone who isn't the commissioner.

**Below the minimum to draft.** A leave can drop a league below `MIN_DRAFT_MEMBERS` (4, `draft-control/rules.ts:20`). draft-control's start refuses; the commissioner can invite or add bots. No change is needed.

## Q4. The commissioner leaving (before the draft)

Without a transfer, a departed commissioner keeps every power (fact 5), so each option transfers or blocks.

| | **A Block until transferred** | **B ★ Pick a successor in the leave sheet** | **C Auto-transfer** |
|---|---|---|---|
| Flow | Leave is disabled. First "Make X commissioner" (its own action), then leave as a member. | The leave sheet asks "Who takes over?" (human members only). One atomic call. | The longest-tenured human member (`joined_at`, then `user_id`) becomes commissioner. |
| Pros | Two simple actions; a transfer is useful on its own. | One step, explicit, atomic. | Zero friction. |
| Cons | Two round trips. | The sheet needs a picker. | The new commissioner didn't ask for it; needs a notification. |

**Sole human (only bots remain, or nobody):**
- **(i) ★ Refuse:** "You're the only manager. Delete the league instead." Note: delete-league is still client-side `[I3]`.
- **(ii) Leaving deletes the league:** the cascade, behind a confirm. Pre-draft there's no history to lose, but it makes "leave" a destructive action.

## Q6. "Leaving" a finished league (`season_status = 'completed'`)

The member is locked in for that season. Once it's over, history must stay, and `get_league_history` / `is_member` read access depend on the row existing. The #123 delete guard refuses any user-session delete anyway.

| | **A ★ Hide it** | **B Nothing to do; Run it back handles it** |
|---|---|---|
| What happens | "Leave league" on a finished league becomes **"Hide league"**: it's removed from that user's Home/league list, the membership row and all history stay, and it can be shown again from "Past leagues". | No action. Declining the renewal (`respond_to_renewal` out, PR #94) is how you "leave". The finished league stays in your list. |
| Backend | `league_members.hidden_at timestamptz`, written by the same service-role RPC (`p_action => 'hide'/'unhide'`). `get_home_summary` / `get_home_league` skip hidden rows; both are re-created with byte-identical ACL. | None. |
| Risk | Low. Hidden is per user, and no other reader keys on it. | None, but finished leagues pile up in the list forever. |

## The post-draft refusal (decided: locked in)

During the draft or the season (`draft_status <> 'not_started'` and `season_status <> 'completed'`), the leave call returns `{status: 'refused', reason: 'locked_in'}`, and the UI shows the locked-in copy. Suggested wording, close to Giorgio's: *"You're locked in for this season. You can leave once it ends."* The UI copy itself is the Design Lead's (Giorgio's copy stays verbatim where he gave it). Mobile can show the button disabled with that line instead of letting the call fail, since `draft_status` is on the league row the screen already reads.

---

## Superseded options (kept for the record)

Before the Q2 ruling, the doc compared three things:
- Q2-A, a soft leave (`left_at`, the team plays on as buy-and-hold, like a bot);
- Q2-B, a forfeit (auto-losses plus liquidation);
- Q3, playoff seeding with departed teams.

All three were dropped with Q2 = C. The finding behind Q2-A still holds as a fact about the codebase: bots can't trade (`trades.user_id` is a uuid FK to `auth.users`), so "bot takeover" and "frozen portfolio" are the same mechanics.

---

## Backend (re-scoped: pre-draft leave plus finished-league hide)

**Shape: a service-role edge function → a service-role-only RPC**, the same as `record-trade` → `"record_trade_atomic"` and `join-league` → `join_league_by_code`. Two reasons:
- A definer RPC called with the user's JWT would be a "user session" to #123's freeze triggers (fact 6).
- A client-callable RPC taking `p_user_id` would be forgeable.

The alternative was a transaction-local GUC that the freeze triggers recognise. It was rejected: it would put a bypass in every freeze trigger, whose safety is a standing invariant that has to be re-verified each time a function is added.

**`20261107000000` — `leave_league(p_league_id uuid, p_user_id text, p_new_commissioner text default null) returns jsonb`**
- **Security:** SECURITY DEFINER, `search_path` pinned. EXECUTE revoked from `public`, `anon` AND `authenticated`, granted to `service_role` only, verified by the `proacl` query. The explicit `authenticated` revoke is what closes the `join_league_by_code` class.
- **Locking:** takes the league row `FOR UPDATE` first, so it serializes against draft-control's start (which flips `draft_status`) and against `join_league_by_code` (which locks the same row). The draft-order trigger's own `FOR NO KEY UPDATE` on the league is then a no-op re-lock in the same transaction.
- **Branches:**
  - `not_member`;
  - `not_started` → (commissioner rules per Q4) DELETE the row; the trigger closes the order gap. Per Q1-B, refuse in the finalized window.
  - `draft_status <> 'not_started'` and season not completed → `locked_in`;
  - `season_status = 'completed'` → hide or unhide per Q6-A (or `locked_in`-style "nothing to leave" under Q6-B).
- **Commissioner transfer (Q4-B):** `p_new_commissioner` is required when the caller is commissioner and another human remains (`successor_required`). It must be a current human member (`successor_invalid`). The RPC sets `leagues.commissioner_id` and the successor's `role = 'commissioner'`, then deletes the leaver. Sole human → `sole_manager` (Q4-i).
- **Returns** `{status: 'left' | 'hidden' | 'refused', reason}`, the same convention as `start_league_playoffs`.

**`20261107000001` — DROP POLICY `league_members_delete_self` (`[I5]`).** After this, no client deletes a membership directly. #123's freeze trigger stays as the second layer.

**Only if Q6 = A:** `20261107000002` adds `league_members.hidden_at` plus the `get_home_summary` / `get_home_league` filters. Both are re-created with byte-identical `proacl` / `prosecdef` / `proconfig`, checked in the test the way `league_standings_ranked.pglite.test.ts` does it.

**Edge and clients:**
- **New `leave-league` function** (`verify_jwt=true`). It calls `getUser()`, validates `league_id` and the optional `new_commissioner_id`, then calls the RPC. It checks `{ error }` from the rpc call (CLAUDE.md success-signal #5: `.rpc()` resolves, it doesn't throw), maps refusals to 4xx, and returns `{status, reason}` verbatim.
- **Web:** `useLeagues.js` `leaveLeague` moves to `functions.invoke('leave-league')` and stops swallowing the error. Web is paused, so prod behavior doesn't change.
- **Mobile:** goes to the 3c worker (League tab), not this branch.
- **Optional:** a commissioner notification on a leave. `league_notifications.kind` is CHECK'd to `'draft_order_set'` only (`20261013000000:167`), so this needs a CHECK change plus a kind. It's a product choice; leave it out unless the board asks for it.
- **Out of scope now:** all of these were needed only for the soft leave and are dropped:
  - a trade guard;
  - a `record-trade` change;
  - a `get_league_display_names` change;
  - scoring, snapshot or playoff changes.

**Tests (PGlite under Deno, migrations loaded verbatim):**
- every branch and refusal, each refusal writing nothing;
- the order gap closing in open and finalized states, and the no-meta random mode;
- the commissioner transfer, with the role and `commissioner_id` both moved;
- a successor who is a bot or a non-member being refused;
- leave → rejoin via `join_league_by_code`;
- `proacl`;
- `migration_cli_split.test.ts`.

**Prod effect check:** ONE DO block ending in `RAISE NOTICE 'PASS'` / `RAISE EXCEPTION 'FAIL'`. It asserts:
- `proacl` holds `service_role` only;
- `[I5]` is gone from `pg_policies`;
- `league_members` DELETE is denied to `authenticated` by RLS (no policy).

## Zombie repair (existing post-draft `[I5]` leaves)

Under "locked in", a zombie is a member who should never have been able to leave, and the right repair is to **re-insert their `league_members` row**. They are still in matchups, standings and drafts, so re-inserting makes them a normal locked-in member again. It clears `bracket_non_member` and `draft_order_invalid`.

**Snag:** the draft-order trigger raises `draft_order_locked` on any INSERT into a league whose order is locked, for every role (`20261013000000:687-690`). So the repair cannot be a plain INSERT. The options, decided only if the pre-check returns rows:
- **(a) ★ A one-off service-role SQL that disables `trg_league_members_draft_order` for its own INSERT only.** `ALTER TABLE ... DISABLE TRIGGER` / `ENABLE TRIGGER` inside one transaction (it takes an ACCESS EXCLUSIVE lock on `league_members` for that instant). The zombie is already in the locked order (the locked + completed branch keeps the order as history), so the order stays an exact permutation once the row is back. For a legacy league with no order meta, the trigger returns before the locked check, but it first calls `_draft_order_sync`. Confirm on a PGlite replica that the call writes nothing for a completed-draft league before relying on a plain INSERT. Also confirm #123 adds no INSERT guard on `league_members`.
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
