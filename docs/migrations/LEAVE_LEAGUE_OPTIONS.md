# Leave league — options for decision

**Status:** OPTIONS, awaiting Giorgio's decisions (STATUS §4 item 11). Nothing is built yet.
**Branch:** `feat/leave-league`. Provisional migration range `20261107000000`–`09`.
**Retires:** `[I5]` (`league_members_delete_self`, `20260712000002:34-37`).

Each question below gives 2–3 options with their consequences and backend shape. A recommendation is marked ★. It is only a recommendation: the board mockups and Giorgio decide.

---

## 0. What exists today (the facts that constrain every option)

1. **An unguarded leave already exists at the API layer.** `[I5]` lets any member DELETE their own `league_members` row at any time, commissioner included. The paused web app calls it with no confirmation (`apps/web/src/hooks/useLeagues.js:244`). Mobile has no path.
2. **Nothing has a foreign key to `league_members`.** A DELETE cascades nothing. The leaver's `drafts`, `trades`, `matchups`, `week_snapshots`, `league_standings`, `league_seasons` and `league_draft_order` rows all stay.
3. **After the draft, almost nothing reads `league_members`.**
   - Scoring, snapshots, standings and season completion take their participants from `matchups` plus `drafts`/`trades` (process-week-results `index.ts:562-566`; `_shared/snapshot-holdings.ts:63-72`).
   - So a post-draft DELETE leaves a **zombie team**: still snapshotted and scored on frozen holdings, unable to trade, its symbols owned for the rest of the season (ownership is computed from drafts+trades, `_shared/draft-validation.ts:189-223`).
4. **The real playoff failure is not quite what item 11 says.**
   - A DELETE does not remove the leaver's `league_standings` row, so `standings_rank_refused` (`season-transition.ts:80`) does not fire.
   - What fires is **`bracket_non_member`** (`start_league_playoffs`, `20261012000001:171-174`). Any seeded team without a `league_members` row refuses the bracket, every run, forever.
   - `standings_rank_refused` fires only if standings rows are deleted. **Rule for every option: never delete a `league_standings` row after the draft starts.**
5. **A post-draft DELETE also breaks the draft code.** `checkStoredOrder` (`draft-validation.ts:151`) requires the locked order to be an exact permutation of members, so any late draft call (`auto_pick` / `finalize` / the sweep) returns 500 `draft_order_invalid`.
6. **The DB already refuses a leave mid-draft.** `sync_draft_order_on_member_change` (`20261013000000:735-741`) raises `draft_in_progress` for every role. Before the draft, the same trigger removes the leaver from the order and closes the gap.
7. **Commissioner power is `leagues.commissioner_id`, not membership.** `is_commissioner()` (`20260712000000:47-58`) never checks membership, so a commissioner who leaves today keeps every power. There is no transfer code anywhere.
8. **Bots are buy-and-hold teams.** `trades.user_id` is a uuid FK to `auth.users`, so a `bot-*` id can never trade. Bots are snapshotted and scored exactly like humans, and the S1–S9 hardened scoring path already covers them.

**Fact 8 is the key one for Q2.** In this codebase a "bot takeover" and a "frozen portfolio" are **the same mechanics**. A bot never trades, so its team is a frozen portfolio that keeps scoring. The only differences are the label and what the playoffs do with it.

---

## Q1. Leaving BEFORE the draft (`draft_status = 'not_started'`)

| | **A ★ Remove the membership** | **B Remove + reopen the order** |
|---|---|---|
| What happens | The row is deleted. The existing trigger takes the leaver out of the draft order and closes the gap. The spot reopens for invites. | Same delete, but a `finalized` manual order flips back to `open`, so the commissioner must re-confirm it. |
| Opponents see | One fewer manager. The order shifts up by one. | Same, plus a "re-confirm draft order" prompt for the commissioner. |
| Rejoin | Yes, with the invite code (`join_league_by_code` allows it: the row is gone and the draft hasn't started). | Same. |
| Risk | Low: the trigger path is live and tested. | Low, plus one extra state transition in the order meta. |

- **Who can leave:** any non-commissioner. The commissioner case is Q4.
- **Mid-draft (`in_progress`):** blocked ("You can leave once the draft finishes"). The DB already enforces this, so the RPC just returns a clean reason ahead of the trigger. Allowing it would take an auto-pick takeover of the remaining turns, which is not recommended.
- **Interaction with `playoff_teams`:** a pre-draft leave can leave P > members. draft-control's start already refuses with `playoff_teams_exceeds_members`, and the commissioner can still lower P pre-draft. Sub-option: the leave RPC clamps P to the new member count automatically. The trade-off is a silent rule change versus a refusal at start.

## Q2. Leaving AFTER the draft (mid-season)

| | **A ★ Auto-managed team ("soft leave")** | **B Forfeit** | **C No mid-season leave** |
|---|---|---|---|
| Mechanic | The membership row is KEPT with `left_at` set. The human id stays everywhere, and the team plays out the season as buy-and-hold, exactly like a bot. | The team scores an automatic loss every remaining week. Its holdings are liquidated, which frees its symbols. | The leave button is disabled until the season completes. Afterwards, leaving just removes the league from your app (and from Run it back). |
| Opponents see | "Sam (left) · auto-managed". The matchup still has a real score. | "Sam (forfeited)". A free W each week. | Nothing changes. |
| Leaver's positions / symbols | Frozen and kept to season end. The symbols stay owned. | Sold, so the symbols return to the pool. | Unchanged. |
| Scoring risk | **None.** It uses the existing path: the leaver is already in matchups/drafts/snapshots, and only trading is closed. | **High.** It needs a new `forfeit` scorer branch in process-week-results, which bypasses the S1–S9 hardened scorer. Liquidation must write sell trades at a live price (edge function, freshness guard) or the ledger and the snapshots disagree, and the matchup becomes `unscoreable` (the `decideUserScorer` rules). | None. |
| Competitive fairness | Good: the opponent still has to beat a real portfolio. | Skewed: whoever faces the leaver late gets free wins. | Best, but users are trapped in a league they want out of. |
| App Store / user trust | OK: they can leave any time. | OK. | Weak: "you can't leave" is a support ticket. |

**Backend shape for A:**
- `league_members.left_at timestamptz` (NULL = active).
- `leave_league` sets it under the league lock.
- Trading closes via a BEFORE INSERT trigger on `trades` that refuses a departed user. A trigger, NOT an edit to `"record_trade_atomic"`, because it leaves the #113/#115 race fix untouched.
- record-trade's edge pre-check gets the same `left_at IS NULL` test for a clean error.
- Scoring, snapshots and standings need NO change.

**Backend shape for B:**
- A process-week-results scorer change (new `forfeit` outcome).
- Seeding excludes forfeits.
- A liquidation edge path that writes sells.
- A P clamp, see Q3.
- Roughly 3× the surface of A, all of it in the scoring pipeline.

## Q3. Playoffs, when a departed team is in the league

The live guards are `bracket_non_member` (seeded team must be a member) and `standings_rank_refused` (ranked rows < P).

| | **A ★ Departed teams stay eligible** | **B Skip departed teams in seeding; P shrinks if needed** |
|---|---|---|
| Rule | Seeding is unchanged. A departed team that earns a top-P spot plays the bracket on autopilot. | Seed only active teams. The next team moves up. If active ranked teams < P, P drops to that count (minimum 2). Below 2, there are no playoffs and the season completes on regular-season standings. |
| Stall today's bug | Fixed structurally: the row is kept, so `bracket_non_member` passes and the standings rows are untouched. | Fixed, by a rewrite of the seeding guard. |
| Consequences | An autopilot team can knock out a human or win the title. The champion page would read "Sam (left)". | Changes the frozen-after-draft P invariant (the service role is exempt from the freeze trigger, so it is possible). A late leave can move bracket seeds (and byes) before the playoffs start. |
| Backend | No change to `start_league_playoffs` or `season-transition.ts`. | Edit `start_league_playoffs` (SECURITY DEFINER; ACL must be re-verified by proacl), `season-transition.ts` (`rankForPlayoffs`), and `league_standings_ranked` consumers. Needs PGlite tests for every P and bye shape (2..16). |

Q3 only matters under Q2-A. Under Q2-B, forfeits must be skipped, which forces Q3-B. Under Q2-C, the question disappears.

## Q4. The commissioner leaving

`commissioner_id` carries all the powers, so a commissioner who departs without a transfer keeps them (fact 7). Every option transfers or blocks.

| | **A Block until transferred** | **B ★ Pick a successor in the leave sheet** | **C Auto-transfer** |
|---|---|---|---|
| Flow | Leave is disabled. First do "Make X commissioner" (a separate action), then leave as a member. | The leave sheet asks "Who takes over?" (human members only) and does it in one atomic call. | The longest-tenured human member (`joined_at`, then `user_id`) becomes commissioner automatically. |
| Pros | Two simple actions. Transfer is also useful on its own. | One step, explicit, atomic. | Zero friction. |
| Cons | Two round trips. | The sheet needs a picker. | The new commissioner didn't ask for it. Needs a notification. |

- **Backend for B:** `leave_league(p_league_id, p_new_commissioner text default null)`. The new commissioner is required when the caller is commissioner and another active human exists. A standalone `transfer_commissioner` RPC can share the same internals.
- **Sole human (everyone else is a bot):**
  - Before the draft, leave is refused with "delete the league instead". Note: delete-league is still client-side `[I3]`.
  - After the draft, two choices:
    - (i) refuse;
    - (ii) allow it: the league becomes all-autopilot and finishes on its own, with `commissioner_id` left on the departed user.
  - Recommend (i) for launch: it's simpler and leaves no orphan leagues.

## Q5. Rejoin and history

| | **A ★ No rejoin this season; history kept** | **B "Reclaim my team" before season end** |
|---|---|---|
| Post-draft leaver | Can't come back this season. `join_league_by_code` already refuses (`draft_started`, and the kept row reads `already_member`). | The same user can undo: `left_at` is cleared and trading reopens. Allowed only while `season_status <> 'completed'`. |
| Pre-draft leaver | Rejoins with the invite code (Q1). | Same. |
| History | Matchups, standings, `league_seasons` and display names all keep the human id. `get_league_display_names` already resolves leavers. | Same. |
| Risk | None. | Low (a flag flip under the league lock), but it's another state to explain ("left" then "back"). |

**What the leaver still sees** (applies to A or B): with the row kept, `is_member()` stays true, so the leaver keeps **read-only** access to the league's history.
- Not recommended: changing `is_member()` to hide it. Every league RLS policy goes through it, so the blast radius is large.
- What does change: `get_home_summary` / `get_home_league` skip departed leagues, so the league leaves the single-league Home and lives under "past leagues".

**Run it back (#94, unmerged):** `renew_league` invites only active human members, so a departed user is not asked to renew. The `league_renewal_responses` expected-set logic already freezes against `[I5]`-style shrinkage. Dropping `[I5]` makes that defense redundant but harmless.

---

## Recommended package and its backend

★ = Q1-A, Q2-A, Q3-A, Q4-B, Q5-A. Under this package **scoring, snapshots, playoffs and the trade RPC body need no change.** That is the main reason for it.

**Migrations (`20261107000000`–`03`):**

- **`00` — `league_members.left_at timestamptz`.** Plus `left_role text`, so history shows "left as commissioner". Plus a partial index for active members.
- **`01` — `leave_league(p_league_id uuid, p_user_id text, p_new_commissioner text default null) returns jsonb`.** SECURITY DEFINER, `search_path` pinned.
  - **Caller: a service-role edge function, not the client** (the constraint is explained below). A new `leave-league` edge function (`verify_jwt=true`) gets the user from `auth.getUser()` and calls the RPC with that id. This is the same pattern as `record-trade` → `"record_trade_atomic"` and `join-league` → `join_league_by_code`.
  - **Grants:** EXECUTE revoked from `public`, `anon` AND `authenticated`, and granted to `service_role` only. Verified by proacl. `p_user_id` would be forgeable if a client could call the RPC, so the service_role-only grant is the whole identity boundary. Explicitly revoking `authenticated` is what closes the `join_league_by_code` class.
  - **Locks:** takes the league row `FOR UPDATE` and the same league-wide advisory lock that `"record_trade_atomic"` takes. A leave and an in-flight trade therefore serialize.
  - **Branches:**
    - `not_started` → DELETE the row (the trigger fixes the order);
    - `in_progress` → refused `draft_in_progress`;
    - `completed` → set `left_at`, plus the commissioner transfer when the caller is commissioner.
  - **Refusals:** `not_member`, `already_left`, `successor_required`, `successor_invalid` (not an active human member), `sole_manager`.
  - It returns `{status, reason}` like `start_league_playoffs`.
- **`02` — `trades` BEFORE INSERT guard.** Refuses a row whose `(league_id, user_id::text)` is departed. Plus the `get_home_summary` / `get_home_league` filters. Both functions are recreated with byte-identical ACL, verified by proacl.
- **`03` — DROP POLICY `league_members_delete_self` (`[I5]`).** After this, no client can DELETE a membership. The web `leaveLeague` moves to `functions.invoke('leave-league')` in the same PR (web is paused, so this is not a prod behavior change).

**Constraint from the "freeze slot edits" release (Orchestrator, 2026-10-05).** That release adds three things:
- `commissioner_id`, `season_status` and `current_week` become immutable to **user sessions** once the draft has started;
- a BEFORE DELETE guard on `league_members` refuses user-session deletes post-draft (42501 `league_membership_locked`);
- "user session" is defined as `auth.uid() IS NOT NULL`.

A SECURITY DEFINER function called with the user's JWT still sees `auth.uid()`, so it is NOT exempt. A client-called `leave_league` would therefore be refused on the post-draft commissioner transfer (Q4). That is why the RPC above runs on the service role, where `auth.uid()` is NULL.

| | **Service-role edge function ★** | **Freeze triggers recognise a scoped definer context** |
|---|---|---|
| Shape | `leave-league` edge function → service_role-only RPC with `p_user_id` | The client calls the definer RPC, which sets a transaction-local flag (`set_config('app.leave_league', 'on', true)`). The freeze triggers skip when the flag is set. |
| Pros | It matches `record-trade` / `join-league`. The freeze triggers need no exception, and the edge layer gives a natural place for the league notification. | One fewer moving part (no edge function). |
| Cons | One more deployed function. | Every freeze trigger grows a bypass. Its safety rests on no client-reachable path being able to set that GUC, which is a standing invariant to re-verify each time a function is added. |

Recommend the edge function: no trigger exceptions, and it follows an existing pattern. Under it, the pre-draft branch's DELETE also runs on the service role. That is fine: the pre-draft delete was allowed either way, and the draft-order trigger behaves identically.

**Edge changes:**
- **New `leave-league` function** (`verify_jwt=true`). Steps: `getUser()`, then validate the body (`league_id`, optional `new_commissioner_id`), then call the `leave_league` RPC with the user's id, destructuring and checking `{ error }` (CLAUDE.md success-signal #5). It maps refusals to 4xx and returns the RPC's `{status, reason}` verbatim. Writing `league_notifications` rows for the remaining members (and the new commissioner) happens in the RPC, so it is in the same transaction.
- `record-trade` pre-check adds `left_at IS NULL` (clean `left_league` error).
- `get_league_display_names` gains a `departed` flag for the "(left)" label. This changes the return type, so it is a DROP + CREATE with re-granted ACL.

**Tests (PGlite, under Deno):**
- Each branch of `leave_league`.
- Concurrency: the trade/leave lock order.
- The trigger interaction on pre-draft delete.
- `bracket_non_member` still passing with a departed seed.
- Each refusal.
- The `migration_cli_split` test.
- An effect-check DO block (RAISE PASS/FAIL) for the prod gate: departed user can't trade, standings row count unchanged, proacl.

**Risks to call out:**
- **Existing prod rows.** Any league where `[I5]` was already used post-draft has a zombie: rows in matchups, but no member row. Pre-check query: matchup/standings user ids with no `league_members` row, per league, bots excluded. If any exist, re-insert them as departed (`left_at = now()`) in `00` so their playoffs can start.
- **`num_participants` / capacity.** Departed rows still count toward `league_full`. That matters only pre-draft, where leaves are hard deletes, so it has no effect.
- **`draft-control` `memberCount` and `checkStoredOrder`** are only reached pre-draft or mid-draft, so keeping the row post-draft keeps them valid. That is the opposite of today's `[I5]` path, which breaks them.

## Mockup hints for the Design Lead (A vs B boards)

- **Q2:** the opponent's matchup card. A shows "Sam (left) · auto-managed" with a live score. B shows "Sam (forfeited)" with "W" pre-filled. The leave sheet copy differs by option.
- **Q3:** the playoff bracket with a departed seed. A shows the departed team in the bracket. B shows it greyed out of the standings cut line, with seeds shifted.
- **Q4:** the commissioner leave sheet. A: a disabled button plus a "Transfer first" link. B: an inline successor picker. C: an "X will become commissioner" notice.
- **Q5:** the leaver's League tab after leaving: a read-only "You left this league" banner and the league under "Past leagues".

---

## Prod pre-check: existing zombies (READ-ONLY, run before the leave-league migrations)

**What it finds.** A "zombie" is a user id that a league still references but that has no `league_members` row. The query looks in four places: matchups (team1/team2), `league_standings`, the stored draft order, and `leagues.commissioner_id`. Every route to one goes through `[I5]` (a self-delete) or a hand edit. The query returns one row per (league, user).

**Run it** in the Supabase SQL editor, which runs as `postgres` (needed for the cross-table read and the `league_standings_ranked` call). It writes nothing. **Zero rows = clean,** and migration `00` needs no backfill.

**How to read a row:**
- **`blocks_playoff_start = true`**: this zombie holds a top-P seed in an active season, so `start_league_playoffs` will refuse with `bracket_non_member` at season end. This is the urgent case. The fix is re-inserting the user as departed in `00`.
- **`unscored_matchups > 0`**: the team is still being scored every week on frozen holdings. Harmless for scoring, but they show up as a manager no one can see in the member list.
- **`is_commissioner = true`**: the commissioner left. `commissioner_id` still carries every power (fact 7). The decided Q4 flow needs a transfer target for this league.
- **`draft_rows` / `trade_rows`**: holdings that keep the leaver's symbols owned.
- **`in_draft_order = true` with `draft_status <> 'completed'`**: late draft calls 500 with `draft_order_invalid` (fact 5).

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
