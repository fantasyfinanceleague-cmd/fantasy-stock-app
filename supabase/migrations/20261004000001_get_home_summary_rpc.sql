-- ============================================================================
-- get_home_summary: one call for the Home dashboard (Phase 3 backend ask #1)
-- ============================================================================
-- PROBLEM
--   useHomeData.ts does N+1 reads per league (drafts, trades, league_seasons,
--   league_standings, matchups, then a batch profile lookup) to build the
--   Home screen. It also fabricates a rank when the caller has no standings
--   row (`userRank || standingsData.length` puts a no-record user in last
--   place) and shows the opponent as the literal 'Opponent' for any
--   non-uuid id (bots, test participants) since it has no profile row to
--   join against.
--
-- DESIGN
--   One SECURITY DEFINER call, no parameters (see SECURITY), returning one
--   row per league the caller belongs to:
--     * phase inputs passed through RAW (draft_status, league_start_date,
--       league_end_date, current_week, num_weeks, season_status) — the
--       client keeps deriving phase via getSeasonPhase (apps/mobile/lib/
--       weekStatus.ts); this function does not re-derive it.
--     * season_number, resolved from current_season_id so the client drops
--       its separate league_seasons read.
--     * rank/standings_count/wins/losses/ties/points_for from
--       league_standings. Rank is NULL — never fabricated — when the caller
--       has no standings row (duration leagues never get one; see note on
--       standings_rank below).
--     * this week's matchup (both participant ids, both display names, both
--       is_bot flags, both dollar gains), NULL end-to-end when there is
--       none (pre-draft/drafting, or no matchup this week).
--
--   Matchup gains are passed through RAW; a NULL team1_gain is the existing
--   "not scored yet" discriminator (CLAUDE.md: overloaded NULLs are type
--   tags) and this function must not COALESCE it into a fabricated value.
--
--   Display names come from participant_display_name (20261004000000),
--   the same naming rules get_league_display_names uses, so Home and the
--   League/Matchup screens never show two different names for the same id.
--
-- STANDINGS RANK — KEEP IN SYNC WITH apps/mobile/app/(tabs)/league.tsx
--   `sortedStandings`. Order: win% = (wins + 0.5*ties) / (wins+losses+ties)
--   desc, then wins desc, then points_for desc, then user_id for a
--   deterministic tie of last resort (the client has no equivalent — a
--   ROW_NUMBER() needs total order, the client array sort doesn't). If that
--   screen's ordering changes, this CTE must change with it, and vice versa
--   (flagged in DONE for 3c, which rebuilds that screen).
--
--   NOTE (also flagged for 3b-2): duration-type leagues never get a
--   league_standings row written by any job (only matchup-league scoring in
--   process-week-results writes standings) — for those leagues rank/record
--   here will normally be NULL for everyone, by design, not a bug. The
--   client must keep ranking duration leagues by live portfolio value.
--
-- SECURITY
--   SECURITY DEFINER, `SET search_path = public, pg_temp`. Takes NO
--   parameters — there is nothing for a caller to forge (contrast
--   join_league_by_code's forgeable p_user_id, CLAUDE.md). The caller is
--   read from auth.uid() only; NULL (anon, or a definer call with no JWT) is
--   refused before touching any table.
--
--   Supabase's default-privilege grants put anon/authenticated/service_role
--   EXECUTE on every new function; REVOKE FROM PUBLIC alone does not clear
--   those. Explicit REVOKE from PUBLIC, anon, authenticated AND service_role
--   below, then GRANT to authenticated only — nothing calls this via
--   service_role (edge functions read these tables directly, already
--   bypassing RLS), so the grant surface is kept to the one intended caller.
--   Verify with the proacl query, never assume.
--
-- ---------------------------------------------------------------------------
-- POST-PUSH EFFECT CHECKS (run each separately):
--   -- 1. grants: expect authenticated (+ postgres) only — no anon=, no
--   --    service_role=, no PUBLIC
--   SELECT proname, proacl FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND proname = 'get_home_summary';
--   -- 2. search_path pinned: expect {search_path=public, pg_temp}
--   SELECT proconfig FROM pg_proc WHERE proname = 'get_home_summary';
--   -- 3. call-time check: as anon, expect 42501 (not merely absent from proacl)
-- ============================================================================

create or replace function public.get_home_summary()
returns table(
  league_id             uuid,
  league_name           text,
  league_type           text,
  draft_status          text,
  league_start_date     timestamptz,
  league_end_date       timestamptz,
  current_week          int,
  num_weeks             int,
  season_status         text,
  season_number         int,
  standings_rank        int,
  standings_count       int,
  wins                  numeric(5,1),
  losses                numeric(5,1),
  ties                  numeric(5,1),
  points_for            numeric(12,2),
  matchup_id            uuid,
  matchup_week_number   int,
  matchup_is_playoff    boolean,
  matchup_week_start    timestamptz,
  matchup_week_end      timestamptz,
  team1_user_id         text,
  team1_display_name    text,
  team1_is_bot          boolean,
  team1_gain            numeric(12,2),
  team2_user_id         text,
  team2_display_name    text,
  team2_is_bot          boolean,
  team2_gain            numeric(12,2)
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller text := auth.uid()::text;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  return query
  with my_leagues as (
    select l.*
    from leagues l
    join league_members m on m.league_id = l.id and m.user_id = v_caller
  ),
  ranked_standings as (
    select
      s.league_id,
      s.user_id,
      s.wins, s.losses, s.ties, s.points_for,
      row_number() over (
        partition by s.league_id
        order by
          case when (s.wins + s.losses + s.ties) > 0
               then (s.wins + 0.5 * s.ties) / (s.wins + s.losses + s.ties)
               else 0 end desc,
          s.wins desc,
          s.points_for desc,
          s.user_id
      ) as rnk,
      count(*) over (partition by s.league_id) as standings_count
    from league_standings s
    where s.league_id in (select id from my_leagues)
  ),
  my_standing as (
    select * from ranked_standings where user_id = v_caller
  ),
  my_matchup as (
    select mu.*
    from my_leagues l
    join lateral (
      select mu.*
      from matchups mu
      where mu.league_id = l.id
        and mu.week_number = l.current_week
        and (mu.team1_user_id = v_caller or mu.team2_user_id = v_caller)
      order by coalesce(mu.is_playoff, false) desc, mu.id
      limit 1
    ) mu on true
  )
  select
    l.id, l.name, l.league_type,
    l.draft_status, l.league_start_date, l.league_end_date,
    l.current_week, l.num_weeks, l.season_status,
    (select ls.season_number from league_seasons ls where ls.id = l.current_season_id),
    ms.rnk::int, ms.standings_count::int, ms.wins, ms.losses, ms.ties, ms.points_for,
    mu.id, mu.week_number, mu.is_playoff, mu.week_start, mu.week_end,
    mu.team1_user_id,
    public.participant_display_name(mu.team1_user_id),
    -- NULL (not false) both when there's no matchup row at all AND when the
    -- matchup exists but this slot is an unfilled playoff-bracket placeholder
    -- (team1/2_user_id nullable since 20260318000000) — "not a bot" must not
    -- be conflated with "no participant here yet".
    case when mu.id is null or mu.team1_user_id is null then null
         else mu.team1_user_id ~* '^bot-[0-9]+(-[0-9]+)?$' end,
    mu.team1_gain,
    mu.team2_user_id,
    public.participant_display_name(mu.team2_user_id),
    case when mu.id is null or mu.team2_user_id is null then null
         else mu.team2_user_id ~* '^bot-[0-9]+(-[0-9]+)?$' end,
    mu.team2_gain
  from my_leagues l
  left join my_standing ms on ms.league_id = l.id
  left join my_matchup mu on mu.league_id = l.id
  order by l.created_at;
end;
$$;

revoke all on function public.get_home_summary() from public;
revoke all on function public.get_home_summary() from anon;
revoke all on function public.get_home_summary() from authenticated;
revoke all on function public.get_home_summary() from service_role;
grant execute on function public.get_home_summary() to authenticated;
