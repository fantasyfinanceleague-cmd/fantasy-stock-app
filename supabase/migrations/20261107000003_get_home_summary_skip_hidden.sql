-- ============================================================================
-- Leave league (4/5): get_home_summary skips leagues the caller has hidden
-- ============================================================================
-- Leaving a FINISHED league hides it for that user (league_members.hidden_at,
-- 20261107000000). Home (the single-league Home, driven by this function's
-- list) must stop showing it; the history stays readable through every other
-- reader (is_member() is unchanged, and get_home_league takes an explicit
-- league id, so "Past leagues" can still open it).
--
-- The function below is 20261011000001's body VERBATIM except ONE predicate in
-- my_leagues: `and m.hidden_at is null`. CREATE OR REPLACE keeps the existing
-- privileges and the return type is unchanged; the revoke/grant block is
-- re-stated verbatim so proacl reads the same either way. The PGlite test
-- asserts proacl / prosecdef / proconfig are byte-identical before and after.
--
-- CONFLICT NOTE (PR #94, Run it back, unmerged as of this file): its
-- 20261105000005 also re-creates get_home_summary. Whichever lands SECOND must
-- carry the other's change: if #94 merges first, rebase this file onto #94's
-- body and keep this one predicate.
--
-- PROVISIONAL TIMESTAMP: see 20261107000000's header.
--
-- POST-PUSH EFFECT CHECK:
--   SELECT proacl, prosecdef, proconfig FROM pg_proc WHERE proname = 'get_home_summary';
--   -- unchanged: {postgres=X/postgres,authenticated=X/postgres}, t, {"search_path=public, pg_temp"}
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
                         and m.hidden_at is null   -- 20261107000003: a hidden finished league leaves Home
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
