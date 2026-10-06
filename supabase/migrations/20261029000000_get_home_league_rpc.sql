-- ============================================================================
-- get_home_league: everything Home (3b-2) needs for ONE league in ONE call
-- ============================================================================
-- Filename: 20261029000000 (was 20261018000000, then 20261024000000). Re-stamped
-- at release (2026-10-05) to sort after prod's latest applied migration
-- (20261028000002): `supabase db push` refuses an unapplied file older than
-- the latest applied one.
-- Phase 3b-2 (mobile Home). Folds five reads into one RPC so Home's live
-- state stays inside the spec's 5-request budget (summary [already
-- fetched by LeagueContext] + get_home_league + quote + matchups-lazy-
-- bars... in practice: summary + this + quote + bars = 4):
--   get_home_league(p_league_id uuid) returns jsonb
--
-- VISIBILITY -- no wider than the existing member RLS already grants.
-- Every dataset this function returns is something the caller could
-- already SELECT directly, scoped exactly as their own policy scopes it:
--
--   dataset                    | already-granted prod SELECT policy
--   ----------------------------|----------------------------------------
--   my_ledger.drafts (mine)    | "Users can view picks in their leagues"
--                              |   (drafts, PUBLIC role, is a member)
--   my_ledger.trades (mine)    | "Users can view trades in their leagues"
--                              |   (trades, PUBLIC role, is a member)
--   current_week.snapshots     | "week_snapshots_select_members"
--     (mine + opponent's)      |   (week_snapshots, authenticated, is_member)
--   current_week.trades        | "Users can view trades in their leagues"
--     (opponent's, THIS WEEK   |   (same policy as my_ledger.trades --
--     only)                    |   ANY member can already read ANY
--                              |   member's trades in this league; this
--                              |   function narrows it to the current
--                              |   week only, tighter than the direct
--                              |   grant, never wider)
--   matchups (mine, all weeks) | "matchups_select_members" (is_member) --
--                              |   a member can already read every
--                              |   matchup row in the league, not just
--                              |   their own; this function returns only
--                              |   the caller's own rows, again tighter.
--   standings                  | public.league_standings_ranked(uuid),
--                              |   already SECURITY INVOKER + granted to
--                              |   authenticated (20261011000000)
--   display names / is_bot     | public.get_league_display_names(uuid),
--                              |   already SECURITY DEFINER + granted to
--                              |   authenticated (20261004000000)
--
-- So this function is a CONSOLIDATION for request-count, not a widening:
-- everything in it, a member could already reach with more round trips.
-- The one deliberate NARROWING is the opponent's trades/snapshots, which
-- this function limits to `league.current_week` only -- a member's direct
-- RLS grant on `trades` has no such limit, but Home never needs the
-- opponent's full history, so it is never given it (PGlite test: the
-- opponent's PREVIOUS week's trades are absent from the result).
--
-- SECURITY -- SECURITY DEFINER (so it can call get_league_display_names,
-- itself definer-only) + explicit is_member gate, same shape as
-- get_season_result (20261014000000 -- Phase 3 backend ask #11, on
-- origin/feat/season-result-summary @ dceeb40 as of this migration's
-- authoring; not yet on this branch, so its exact SQL isn't cross-checked
-- here -- only its documented convention, from the 3b-2 plan, is followed):
--   auth.uid() NULL          -> raise 42501 (not authenticated)
--   not a member of p_league_id -> NULL (no existence oracle; matches
--                                  get_season_result's 0-rows convention,
--                                  adapted to a single-row jsonb return)
--
-- GRANTS -- Supabase's default privileges put anon/authenticated/
-- service_role EXECUTE on every new function, and REVOKE FROM PUBLIC does
-- not clear them (CLAUDE.md). Explicit revoke from all four, then grant
-- to authenticated only.
--
-- ---------------------------------------------------------------------------
-- POST-PUSH EFFECT CHECKS (run each separately, from the deploy checkout):
--   -- 1. grants: expect {postgres=X/postgres,authenticated=X/postgres} only.
--   SELECT proname, proacl, prosecdef, proconfig FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND proname = 'get_home_league';
--   -- 2. effect, as a real member of a real league (replace both ids):
--   BEGIN; SET LOCAL ROLE authenticated;
--   SELECT set_config('request.jwt.claim.sub', '<member-uuid>', true);
--   SELECT public.get_home_league('<league-uuid>');
--   ROLLBACK;
--   -- 3. anon: expect ERROR 42501 permission denied for function
--   BEGIN; SET LOCAL ROLE anon;
--   SELECT public.get_home_league('<league-uuid>');
--   ROLLBACK;
-- ============================================================================

create or replace function public.get_home_league(p_league_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller text := auth.uid()::text;
  v_league record;
  -- Typed row variable, NOT plain `record` (security review, 2026-09-29):
  -- an untyped `record` that a 0-row `SELECT ... INTO` never assigns has
  -- "no substructure", and any later `.field` access on it raises "record
  -- ... is not assigned yet" -- an ERROR, not the "bye -> empty
  -- current_week arrays" behavior this function's header promises. A
  -- typed `matchups%rowtype` variable has a fixed substructure up front,
  -- so a 0-row SELECT INTO leaves every field NULL instead, and
  -- `v_matchup.week_start`/`week_end` below degrade to NULL comparisons
  -- (the intended, tested "no matchup this week -> empty" behavior) for
  -- every caller with no current-week row: a bye, a playoff bye, an
  -- eliminated team, or a league whose schedule hasn't been generated yet.
  v_matchup matchups%rowtype;
  v_opponent text;
  v_result jsonb;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if not public.is_member(p_league_id) then
    return null;
  end if;

  select id, current_week into v_league from leagues where id = p_league_id;
  if not found then
    return null;
  end if;

  -- The caller's current-week matchup (if any), to find the opponent.
  select mu.* into v_matchup
  from matchups mu
  where mu.league_id = p_league_id
    and mu.week_number = v_league.current_week
    and (mu.team1_user_id = v_caller or mu.team2_user_id = v_caller)
  order by coalesce(mu.is_playoff, false) desc, mu.id
  limit 1;

  v_opponent := case
    when v_matchup is null then null
    when v_matchup.team1_user_id = v_caller then v_matchup.team2_user_id
    else v_matchup.team1_user_id
  end;

  select jsonb_build_object(
    'my_ledger', jsonb_build_object(
      'drafts', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'symbol', d.symbol, 'entry_price', d.entry_price, 'quantity', d.quantity,
          'created_at', d.created_at
        ) order by d.created_at), '[]'::jsonb)
        from drafts d
        where d.league_id = p_league_id and d.user_id = v_caller
      ),
      'trades', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'symbol', t.symbol, 'action', t.action, 'quantity', t.quantity, 'price', t.price,
          'created_at', t.created_at
        ) order by t.created_at), '[]'::jsonb)
        from trades t
        where t.league_id = p_league_id and t.user_id::text = v_caller
      )
    ),
    'current_week', jsonb_build_object(
      'week_number', v_league.current_week,
      'my_snapshots', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'symbol', s.symbol, 'quantity', s.quantity, 'week_start_price', s.week_start_price,
          'entered_mid_week', s.entered_mid_week
        ) order by s.symbol), '[]'::jsonb)
        from week_snapshots s
        where s.league_id = p_league_id and s.week_number = v_league.current_week and s.user_id::text = v_caller
      ),
      -- Both bounds, mirroring opponent_trades below: a lower bound alone
      -- would let a trade dated after v_matchup.week_end (e.g. once
      -- current_week has rolled over) into a field documented as "this
      -- week only" (security review, 2026-09-29). When v_matchup IS NULL
      -- (no matchup this week: a bye or a playoff gap), both bounds are
      -- NULL and the comparison is NULL for every row, so this correctly
      -- returns empty -- there is no "this week" to scope to without a
      -- matchup row's own week_start/week_end.
      'my_trades', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'symbol', t.symbol, 'action', t.action, 'quantity', t.quantity, 'price', t.price,
          'created_at', t.created_at
        ) order by t.created_at), '[]'::jsonb)
        from trades t
        where t.league_id = p_league_id and t.user_id::text = v_caller
          and t.created_at >= v_matchup.week_start and t.created_at <= v_matchup.week_end
      ),
      -- Opponent's data, THIS WEEK ONLY -- see the header's "one
      -- deliberate NARROWING" note. NULL opponent -> empty arrays, never
      -- another member's row leaking through a NULL comparison.
      'opponent_snapshots', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'symbol', s.symbol, 'quantity', s.quantity, 'week_start_price', s.week_start_price,
          'entered_mid_week', s.entered_mid_week
        ) order by s.symbol), '[]'::jsonb)
        from week_snapshots s
        where s.league_id = p_league_id and s.week_number = v_league.current_week
          and v_opponent is not null and s.user_id::text = v_opponent
      ),
      'opponent_trades', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'symbol', t.symbol, 'action', t.action, 'quantity', t.quantity, 'price', t.price,
          'created_at', t.created_at
        ) order by t.created_at), '[]'::jsonb)
        from trades t
        where t.league_id = p_league_id and v_opponent is not null and t.user_id::text = v_opponent
          and t.created_at >= v_matchup.week_start and t.created_at <= v_matchup.week_end
      )
    ),
    'matchups', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'week_number', mu.week_number, 'week_start', mu.week_start, 'week_end', mu.week_end,
        'is_playoff', mu.is_playoff,
        'team1_user_id', mu.team1_user_id, 'team2_user_id', mu.team2_user_id,
        'team1_gain', mu.team1_gain, 'team2_gain', mu.team2_gain
      ) order by mu.week_number), '[]'::jsonb)
      from matchups mu
      where mu.league_id = p_league_id
        and (mu.team1_user_id = v_caller or mu.team2_user_id = v_caller)
    ),
    'standings', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', r.user_id, 'rank', r.rank, 'wins', r.wins, 'losses', r.losses, 'ties', r.ties,
        'points_for', r.points_for,
        'display_name', dn.display_name, 'is_bot', dn.is_bot
      ) order by r.rank), '[]'::jsonb)
      from public.league_standings_ranked(p_league_id) r
      left join public.get_league_display_names(p_league_id) dn on dn.user_id = r.user_id
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_home_league(uuid) from public;
revoke all on function public.get_home_league(uuid) from anon;
revoke all on function public.get_home_league(uuid) from authenticated;
revoke all on function public.get_home_league(uuid) from service_role;
grant execute on function public.get_home_league(uuid) to authenticated;
