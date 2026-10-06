-- ============================================================================
-- Draft auto-start (Giorgio, 2026-10-06): "the draft is not something that is
-- started manually. It should be something that starts at the minute that is
-- selected by the commissioner." Plan: docs/migrations/DRAFT_AUTO_START_PLAN.md.
--
-- PROVISIONAL TIMESTAMP (20261109000000-09 range): re-stamp at release if
-- anything later is applied first. MUST apply after 20261106000000 (the
-- auto-pick cron), see 20261109000002.
--
-- WHAT THIS ADDS (all service_role only; the cron runs as postgres):
--   draft_start_grace()          the policy's one number: how long after
--                                draft_date a blocked draft may still
--                                auto-start (15 min, ★A). Mirrored by
--                                START_GRACE_SECONDS in
--                                supabase/functions/_shared/draft-start-policy.ts;
--                                supabase/tests/draft_auto_start.pglite.test.ts
--                                pins the two equal.
--   draft_start_blocks           one row per league whose last start attempt
--                                was blocked, keyed to the draft_date it was
--                                judged against. Drives the 60 s back-off and
--                                (later) the "delayed" lobby/notice.
--   note_draft_start_blocked()   upsert of that row.
--   due_draft_starts()           the leagues to try this tick: the cron's post
--                                guard and the sweep's start list.
--   start_league_draft()         THE flip: row lock + window + floor + CAS.
--
-- WHY THE FLIP IS A FUNCTION (it used to be draft-control's conditional
-- UPDATE): the blocker evaluation (TS: computeStartBlockers + feasibility over
-- cached prices) and the UPDATE were two statements, so a playoff_teams edit, a
-- slot edit or a join could land between them and start a draft on rules nobody
-- checked. Here the TS passes every input it judged (p_expect); under the
-- league row lock the function rebuilds the same object and compares with jsonb
-- `=`. Equal => the TS verdict still holds (the inputs are identical; only the
-- clock and cached prices can move, and the window is re-judged on now()).
-- Different => 'changed', nothing written, the next tick re-evaluates.
--
-- CONCURRENCY: SELECT ... FOR UPDATE on the league row conflicts with the
-- FOR NO KEY UPDATE that every membership writer takes on the same row
-- (trg_league_members_draft_order, 20261013000000; trg_league_members_freeze_leave,
-- 20261104000000; #126's leave), so a join/leave and a start serialize. Two
-- starters (two sweep invocations, the sweep vs. a commissioner's Start, a
-- client kick) serialize on the lock too: the second re-reads draft_status
-- after the first commits (READ COMMITTED re-fetch of the locked row) and
-- returns 'already_started'. PGlite has one connection, so this is argued here
-- and pinned structurally (the lock clause) in the test, not raced.
-- The record-trade advisory key ('record-trade:' || league_id) is not taken:
-- trades are refused before the draft, so they never contend with a start.
--
-- GATES: the UPDATE fires every existing start trigger (order lock
-- trg_leagues_order_start, pick-clock anchor trg_leagues_pick_clock, #123's
-- freeze; service_role is exempt from the user-session guards). Gates that
-- refuse a start FOR EVERY ROLE with errcode 22023 — #126's
-- trg_leagues_roster_reconfirm_gate ('roster_reconfirm_required') and #94's
-- trg_leagues_renewal_gate ('renewal_replies_pending'), neither on main at
-- authoring time — are caught by name and returned as 'blocked', so this file
-- needs no reference to their tables. Any OTHER error re-raises (an operator
-- problem, e.g. draft_order_locked_mismatch, must stay loud).
--
-- RESULT (jsonb; game-flow outcomes are values, never raises, so .rpc()'s
-- { error } stays reserved for real failures — CLAUDE.md success signals #5):
--   {status:'started'}                         flipped; the block row is cleared
--   {status:'already_started', draft_status}   not not_started any more
--   {status:'not_due'}                         TBD date or before draft_date
--   {status:'missed'}                          past draft_date + grace
--   {status:'blocked', reason}                 the floor or a gate refused
--   {status:'changed', actual}                 CAS mismatch: nothing written
--   {status:'refused', reason:'league_not_found'}
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The policy's one number
-- ---------------------------------------------------------------------------
create or replace function public.draft_start_grace()
returns interval
language sql
immutable
set search_path = public, pg_temp
as $$ select interval '15 minutes' $$;

comment on function public.draft_start_grace() is
  'Draft auto-start policy: how long after draft_date a blocked draft may still start automatically (★A). Mirrors START_GRACE_SECONDS in supabase/functions/_shared/draft-start-policy.ts; a test pins them equal. Policy B = shrink to a cron-lag allowance in both places.';

revoke all on function public.draft_start_grace() from public;
revoke all on function public.draft_start_grace() from anon, authenticated;
grant execute on function public.draft_start_grace() to service_role;

-- ---------------------------------------------------------------------------
-- 2. draft_start_blocks
-- ---------------------------------------------------------------------------
create table if not exists public.draft_start_blocks (
  league_id        uuid primary key references public.leagues(id) on delete cascade,
  -- The draft_date this block was judged against. A new draft_date makes the
  -- row stale for the back-off (due_draft_starts compares it), with no trigger
  -- on leagues needed; the next attempt rewrites it.
  draft_date       timestamptz not null,
  first_blocked_at timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  attempts         integer not null default 1,
  reason           text not null,
  blockers         jsonb not null default '[]'::jsonb
);

comment on table public.draft_start_blocks is
  'One row per league whose last automatic start attempt was blocked (draft auto-start, 20261109000000). Written only by note_draft_start_blocked (service role); deleted by start_league_draft on a successful start. Its presence for the CURRENT draft_date is the explicit "delayed" state: never derive it from draft_date < now().';

alter table public.draft_start_blocks enable row level security;
-- No policies: no client reads or writes it yet (draft-control status exposes
-- the live blocker set to members). Supabase's default grants are revoked so
-- RLS is not the only thing standing between anon and the table.
-- service_role reads only: every write goes through the DEFINER functions
-- (note_draft_start_blocked, start_league_draft), which run as the owner.
revoke all on table public.draft_start_blocks from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.draft_start_blocks from service_role;
grant select on table public.draft_start_blocks to service_role;

-- ---------------------------------------------------------------------------
-- 3. note_draft_start_blocked
-- ---------------------------------------------------------------------------
create or replace function public.note_draft_start_blocked(
  p_league_id uuid,
  p_reason    text,
  p_blockers  jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_date timestamptz;
begin
  -- FOR SHARE: waits out a start_league_draft holding FOR UPDATE, then re-reads,
  -- so a start that commits first never leaves a stale block on a started league.
  select draft_date into v_date from public.leagues
   where id = p_league_id and draft_status = 'not_started'
   for share;
  if v_date is null then
    return;   -- gone, started, or TBD: nothing to back off from
  end if;

  insert into public.draft_start_blocks as b (league_id, draft_date, reason, blockers)
  values (p_league_id, v_date, coalesce(p_reason, 'blocked'), coalesce(p_blockers, '[]'::jsonb))
  on conflict (league_id) do update set
    -- A block against an OLD draft_date is a different episode: restart it.
    first_blocked_at = case when b.draft_date is distinct from excluded.draft_date then now() else b.first_blocked_at end,
    attempts         = case when b.draft_date is distinct from excluded.draft_date then 1 else b.attempts + 1 end,
    draft_date       = excluded.draft_date,
    last_seen_at     = now(),
    reason           = excluded.reason,
    blockers         = excluded.blockers;
end;
$$;

revoke all on function public.note_draft_start_blocked(uuid, text, jsonb) from public;
revoke all on function public.note_draft_start_blocked(uuid, text, jsonb) from anon, authenticated;
grant execute on function public.note_draft_start_blocked(uuid, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 4. due_draft_starts — who to try this tick
-- ---------------------------------------------------------------------------
-- The window is [draft_date, draft_date + grace): the same half-open interval
-- start_league_draft and draft-start-policy.ts use. A league whose last attempt
-- (for its CURRENT draft_date) was blocked under 60 s ago is skipped, so a
-- blocked league costs one edge call + pool read a minute, not six. Leagues
-- past the grace (including every legacy not_started league with an old date)
-- are never listed: they are missed, never auto-started.
-- Lists leagues across tenants, so service_role (and the cron's postgres
-- owner) only, like overdue_draft_turns.
create or replace function public.due_draft_starts()
returns table (league_id uuid, draft_date timestamptz)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select l.id, l.draft_date
    from public.leagues l
   where l.draft_status = 'not_started'
     and l.draft_date is not null
     and l.draft_date <= now()
     and l.draft_date > now() - public.draft_start_grace()
     and not exists (
       select 1
         from public.draft_start_blocks b
        where b.league_id = l.id
          and b.draft_date = l.draft_date
          and b.last_seen_at > now() - interval '60 seconds'
     )
   order by l.draft_date, l.id;
$$;

revoke all on function public.due_draft_starts() from public;
revoke all on function public.due_draft_starts() from anon, authenticated;
grant execute on function public.due_draft_starts() to service_role;

-- ---------------------------------------------------------------------------
-- 5. start_league_draft — THE flip
-- ---------------------------------------------------------------------------
create or replace function public.start_league_draft(p_league_id uuid, p_expect jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_l       public.leagues%rowtype;
  v_members integer;
  v_actual  jsonb;
  v_gate    text;
begin
  -- Serializes with joins/leaves (FOR NO KEY UPDATE) and with other starters.
  select * into v_l from public.leagues where id = p_league_id for update;
  if not found then
    return jsonb_build_object('status', 'refused', 'reason', 'league_not_found');
  end if;
  if v_l.draft_status <> 'not_started' then
    return jsonb_build_object('status', 'already_started', 'draft_status', v_l.draft_status);
  end if;

  -- The window, on the DB clock (the caller's clock may differ).
  if v_l.draft_date is null or v_l.draft_date > now() then
    return jsonb_build_object('status', 'not_due');
  end if;
  if now() >= v_l.draft_date + public.draft_start_grace() then
    return jsonb_build_object('status', 'missed');
  end if;

  select count(*)::int into v_members from public.league_members m where m.league_id = p_league_id;

  -- FLOOR (defense in depth; the rule source is computeStartBlockers in
  -- draft-control/rules.ts, and the CAS below already guarantees its inputs):
  -- never start an undersized league, one with no stake mode, or one whose
  -- playoff spots exceed its managers (it could never be seeded).
  if v_l.stake_mode is null then
    return jsonb_build_object('status', 'blocked', 'reason', 'no_stake_mode');
  end if;
  if v_members < 4 then
    return jsonb_build_object('status', 'blocked', 'reason', 'not_enough_members');
  end if;
  if v_l.league_type = 'matchup' and (v_l.playoff_teams is null or v_l.playoff_teams < 2) then
    return jsonb_build_object('status', 'blocked', 'reason', 'invalid_playoff_teams');
  end if;
  if v_l.league_type = 'matchup' and v_l.playoff_teams > v_members then
    return jsonb_build_object('status', 'blocked', 'reason', 'playoff_teams_exceeds_members');
  end if;

  -- CAS: exactly the shape buildStartExpect (supabase/functions/_shared/draft-start.ts) sends.
  v_actual := jsonb_build_object(
    'members',           v_members,
    'stake_mode',        v_l.stake_mode,
    'budget_amount',     v_l.budget_amount,
    'num_rounds',        v_l.num_rounds,
    'allow_undraftable', v_l.allow_undraftable,
    'league_type',       v_l.league_type,
    'playoff_teams',     v_l.playoff_teams,
    'slots', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',          s.id::text,
               'slot_index',  s.slot_index,
               'slot_count',  s.slot_count,
               'price_min',   s.price_min,
               'price_max',   s.price_max,
               'category_id', s.category_id::text)
             order by s.slot_index, s.id)
        from public.league_draft_slots s
       where s.league_id = p_league_id), '[]'::jsonb)
  );
  if p_expect is null or v_actual is distinct from p_expect then
    return jsonb_build_object('status', 'changed', 'actual', v_actual);
  end if;

  begin
    update public.leagues set draft_status = 'in_progress' where id = p_league_id;
  exception when sqlstate '22023' then
    v_gate := split_part(sqlerrm, ':', 1);
    if v_gate in ('roster_reconfirm_required', 'renewal_replies_pending') then
      return jsonb_build_object('status', 'blocked', 'reason', v_gate);
    end if;
    raise;
  end;

  delete from public.draft_start_blocks where league_id = p_league_id;
  return jsonb_build_object('status', 'started');
end;
$$;

comment on function public.start_league_draft(uuid, jsonb) is
  'Draft auto-start: THE flip from not_started to in_progress (20261109000000). Row lock, start window on now(), a rules floor, and a compare-and-swap against the inputs the caller judged. Service role only; called by supabase/functions/_shared/draft-start.ts.';

revoke all on function public.start_league_draft(uuid, jsonb) from public;
revoke all on function public.start_league_draft(uuid, jsonb) from anon, authenticated;
grant execute on function public.start_league_draft(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- POST-PUSH CHECKS (HUMAN ACTION; the effect block is
-- docs/security/draft-auto-start-effect-test.sql):
--   SELECT proname, proacl, prosecdef, proconfig FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND proname IN ('draft_start_grace','note_draft_start_blocked','due_draft_starts','start_league_draft');
--   -- every proacl: postgres + service_role only (no anon=, no authenticated=, no =X)
--   SELECT relrowsecurity, relacl FROM pg_class WHERE oid = 'public.draft_start_blocks'::regclass;
-- ---------------------------------------------------------------------------
