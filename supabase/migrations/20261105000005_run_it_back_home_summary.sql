-- ============================================================================
-- Run it back (6/6): get_home_summary gains the renewal links
-- ============================================================================
-- Design: docs/migrations/RUN_IT_BACK_DESIGN.md (rev 3.1), §2.1 and §2.8.
-- 20261011000001's body, verbatim, plus two output columns:
--   previous_league_id   the season this league renews (NULL = a first season)
--   successor_league_id  the season that renews this one (NULL = none yet)
-- The client shows "Run it back?" on a finished league with no successor, and a
-- "Season N" link on one that has a successor.
--
-- RETURNS TABLE changes shape, so the function is DROPPED and re-created.
-- DROP + CREATE resets privileges, so the grants are re-applied below (the
-- opposite trap to CLAUDE.md's CREATE OR REPLACE note).
--
-- PROVISIONAL TIMESTAMP: re-stamp before release (see 20261027000000's header).
--
-- POST-PUSH EFFECT CHECKS:
--   SELECT proacl FROM pg_proc WHERE proname = 'get_home_summary';
--   -- expect {postgres=X/postgres,authenticated=X/postgres} exactly
-- ============================================================================

drop function if exists public.get_home_summary();

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
  team2_gain            numeric(12,2),
  previous_league_id    uuid,
  successor_league_id   uuid
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
    -- Rank source: public.league_standings_ranked (20261011000000), the one
    -- ranking every surface reads. The only change from 20261004000001.
    select
      l.id as league_id,
      r.user_id,
      r.wins, r.losses, r.ties, r.points_for,
      r.rank as rnk,
      count(*) over (partition by l.id) as standings_count
    from my_leagues l
    cross join lateral public.league_standings_ranked(l.id) r
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
    mu.team2_gain,
    l.previous_league_id,
    (select n.id from public.leagues n where n.previous_league_id = l.id)
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
