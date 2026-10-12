-- ============================================================================
-- Frozen leaver names (2/2): every league-scoped name read uses the
-- league-aware resolver
-- ============================================================================
-- Giorgio, 2026-10-11, board #call-leaver-names, "A with frozen names" (see
-- 20261119000000's header). That file adds league_participant_display_name;
-- this one switches every caller that has a league in context and can name a
-- hidden leaver.
--
-- EACH FUNCTION BELOW IS ITS LATEST DEFINITION, VERBATIM, WITH ONE CHANGE:
-- public.participant_display_name(<id>) becomes
-- public.league_participant_display_name(<the row's league>, <id>). Nothing
-- else differs; supabase/tests/frozen_leaver_names.pglite.test.ts asserts each
-- body equals its source with exactly that substitution.
--   get_league_display_names  superset of 20261004000000  (league: p_league_id;
--                             also feeds get_home_league + get_portfolio_ledger)
--   get_home_summary          superset of 20261115000005  (league: l.id)
--   get_season_result         superset of 20261014000000  (league: p_league_id;
--                             the podium of a season of that league)
--   get_renewal_roster        superset of 20261115000003  (league: p_league_id)
--   get_league_history        superset of 20261115000003  (league: l.id, EACH
--                             season's own league, not p_league_id: every Run
--                             it back season is its own league row)
--   get_season_matchups       superset of 20261115000003  (league: l.id, same)
-- Same signatures and return shapes, so CREATE OR REPLACE keeps each ACL; the
-- source's own revoke/grant lines are re-asserted verbatim after each body.
--
-- LEFT ON participant_display_name (they can only name someone acting NOW, or
-- someone in a league that has no hidden rows yet):
--   leave_league             names the leaver on the pre-draft DELETE path only
--                            (hidden leavers are never named there)
--   transfer_commissioner    names the outgoing commissioner, who is acting
--   renew_league, respond_to_renewal, nudge_renewal, remove_renewal_invitee
--                            name the caller, who is acting
--   draft_notice_context     names the commissioner of a league before its
--                            draft (hidden_at is only set after a season)
--
-- POST-PUSH CHECK (SQL editor):
--   SELECT proname, proacl, position('league_participant_display_name' in prosrc) > 0 AS switched
--     FROM pg_proc WHERE proname IN ('get_league_display_names','get_home_summary','get_season_result',
--       'get_renewal_roster','get_league_history','get_season_matchups') ORDER BY 1;
--   -- EXPECT switched t on all six; proacl {postgres=X/postgres,authenticated=X/postgres}.
-- ============================================================================

-- ---- get_league_display_names: superset of 20261004000000 -----------------------------
create or replace function public.get_league_display_names(p_league_id uuid)
returns table(user_id text, display_name text, is_bot boolean)
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
  -- Reuses is_member (20260712000000) rather than re-inlining the same
  -- predicate, so "what counts as a member" stays defined in exactly one
  -- place. is_member reads auth.uid() itself; v_caller is still needed below
  -- to null-check auth.uid() first (is_member alone can't distinguish
  -- "not authenticated" from "authenticated, not a member", and those get
  -- different messages here for the same 42501).
  if not public.is_member(p_league_id) then
    raise exception 'not a league member' using errcode = '42501';
  end if;

  return query
  with participant_ids as (
    select m.user_id from league_members m where m.league_id = p_league_id
    union
    select s.user_id from league_standings s where s.league_id = p_league_id
    union
    select mu.team1_user_id from matchups mu where mu.league_id = p_league_id and mu.team1_user_id is not null
    union
    select mu.team2_user_id from matchups mu where mu.league_id = p_league_id and mu.team2_user_id is not null
    union
    select d.user_id::text from drafts d where d.league_id = p_league_id
    union
    -- trades.user_id is uuid (drafts.user_id is text) — CLAUDE.md: cross-table
    -- position queries need explicit casts. In today's write paths a trades
    -- row implies an earlier drafts row for the same user (both gated by
    -- league-membership RLS, and a user can't trade before drafting/joining),
    -- so this is very likely already a subset of the drafts branch above —
    -- but "every id that has EVER participated" is this function's own
    -- stated completeness claim, and CLAUDE.md is explicit that a
    -- completeness claim must not rest on an unstated subset. Included
    -- directly rather than documented as "safe to omit".
    select t.user_id::text from trades t where t.league_id = p_league_id
  )
  select
    p.user_id,
    public.league_participant_display_name(p_league_id, p.user_id),
    p.user_id ~* '^bot-[0-9]+(-[0-9]+)?$'
  from participant_ids p
  where p.user_id is not null;
end;
$$;

revoke all on function public.get_league_display_names(uuid) from public;
revoke all on function public.get_league_display_names(uuid) from anon;
revoke all on function public.get_league_display_names(uuid) from authenticated;
revoke all on function public.get_league_display_names(uuid) from service_role;
grant execute on function public.get_league_display_names(uuid) to authenticated;

-- ---- get_home_summary: superset of 20261115000005 -----------------------------
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
    public.league_participant_display_name(l.id, mu.team1_user_id),
    -- NULL (not false) both when there's no matchup row at all AND when the
    -- matchup exists but this slot is an unfilled playoff-bracket placeholder
    -- (team1/2_user_id nullable since 20260318000000) — "not a bot" must not
    -- be conflated with "no participant here yet".
    case when mu.id is null or mu.team1_user_id is null then null
         else mu.team1_user_id ~* '^bot-[0-9]+(-[0-9]+)?$' end,
    mu.team1_gain,
    mu.team2_user_id,
    public.league_participant_display_name(l.id, mu.team2_user_id),
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

-- ---- get_season_result: superset of 20261014000000 -----------------------------
create or replace function public.get_season_result(
  p_league_id uuid,
  p_season_id uuid default null
)
returns table(
  season_id               uuid,
  season_number           int,
  status                  text,
  reason                  text,
  detail_scope            text,
  completed_at            timestamptz,
  standings_count         int,
  champion_user_id        text,
  champion_display_name   text,
  runner_up_user_id       text,
  runner_up_display_name  text,
  caller_participated     boolean,
  final_rank              int,
  wins                    numeric,
  losses                  numeric,
  ties                    numeric,
  points_for              numeric,
  playoff_teams           int,
  playoff_weeks           int,
  playoff_wins            int,
  playoff_losses          int,
  playoff_result          text,
  playoff_exit_round      int,
  best_week_number        int,
  best_week_gain          numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_caller        text := auth.uid()::text;
  v_league        record;
  v_season        record;
  v_standings     jsonb;
  v_entry         jsonb;
  v_is_current    boolean;
  v_no_standings  boolean;
  v_reason        text;
  -- playoff shape
  v_po_rows       int;
  v_po_unscored   int;
  v_po_max_round  int;
  v_p             int;
  v_w             int;
  v_final_count   int;
  v_final_winner  text;
  v_final_loser   text;
  -- caller's playoffs
  v_my_po_games   int;
  v_my_po_wins    int;
  v_my_po_round   int;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Membership gate. 0 rows for a non-member, an unknown league, or (below) a
  -- season of another league: all indistinguishable.
  if not public.is_member(p_league_id) then
    return;
  end if;

  select l.id, l.league_type, l.num_weeks, l.playoff_teams, l.season_status,
         l.current_season_id
    into v_league
  from leagues l
  where l.id = p_league_id;
  if not found then
    return;
  end if;

  -- ---- season selection -----------------------------------------------------
  if p_season_id is not null then
    select s.* into v_season
    from league_seasons s
    where s.id = p_season_id and s.league_id = p_league_id;
    if not found then
      return;
    end if;
  else
    select s.* into v_season
    from league_seasons s
    where s.league_id = p_league_id and s.completed_at is not null
    order by s.season_number desc
    limit 1;
    if not found then
      select s.* into v_season
      from league_seasons s
      where s.id = v_league.current_season_id and s.league_id = p_league_id;
      if not found then
        status := 'not_complete';
        reason := 'no_season';
        return next;
        return;
      end if;
    end if;
  end if;

  season_id     := v_season.id;
  season_number := v_season.season_number;

  if v_league.league_type is distinct from 'matchup' then
    status := 'unsupported';
    reason := 'not_a_matchup_league';
    return next;
    return;
  end if;

  if v_season.completed_at is null then
    status := 'not_complete';
    reason := 'season_in_progress';
    return next;
    return;
  end if;

  v_is_current := v_season.id = v_league.current_season_id;
  v_standings  := v_season.final_standings;

  -- ---- checks that apply to every completed season ----------------------------
  -- (a CASE, not OR: jsonb_array_length raises on a non-array, and SQL does not
  -- promise OR short-circuits; kept out of the IF because plpgsql ends an IF
  -- condition at the first THEN token)
  v_no_standings := case when v_standings is null then true
                         when jsonb_typeof(v_standings) <> 'array' then true
                         else jsonb_array_length(v_standings) = 0 end;
  if v_is_current and v_league.season_status is distinct from 'completed' then
    v_reason := 'season_status_mismatch';
  elsif v_no_standings then
    v_reason := 'final_standings_missing';
  end if;

  -- ---- 'full' scope checks: the current season still has its matchups --------
  if v_reason is null and v_is_current then
    select count(*)::int,
           count(*) filter (where m.team1_gain is null)::int,
           max(m.playoff_round_number)::int
      into v_po_rows, v_po_unscored, v_po_max_round
    from matchups m
    where m.league_id = p_league_id and m.is_playoff is true;

    if v_po_rows = 0 or v_po_unscored > 0 then
      v_reason := 'playoffs_unscored';
    else
      v_p := v_po_rows + 1;  -- a single-elimination bracket of P has P-1 games
      v_w := 0;
      while (1 << v_w) < v_p loop v_w := v_w + 1; end loop;

      select count(*)::int,
             max(m.winner_user_id),
             max(case when m.winner_user_id = m.team1_user_id then m.team2_user_id
                      else m.team1_user_id end)
        into v_final_count, v_final_winner, v_final_loser
      from matchups m
      where m.league_id = p_league_id and m.is_playoff is true
        and m.playoff_round_number = v_w and m.bracket_position = 0;

      if v_p is distinct from v_league.playoff_teams
         or v_po_max_round is distinct from v_w
         or v_final_count <> 1 then
        v_reason := 'playoff_shape_mismatch';
      elsif v_final_winner is null then
        v_reason := 'playoff_final_unresolved';
      elsif v_final_winner is distinct from v_season.champion_user_id
         or v_final_loser  is distinct from v_season.runner_up_user_id then
        v_reason := 'champion_mismatch';
      end if;
    end if;

    -- Everyone scheduled in the regular season must have a final_standings entry.
    if v_reason is null and exists (
      select 1
      from (select m.team1_user_id as u from matchups m
             where m.league_id = p_league_id and m.is_playoff is not true
               and m.team1_user_id is not null
            union
            select m.team2_user_id from matchups m
             where m.league_id = p_league_id and m.is_playoff is not true
               and m.team2_user_id is not null) sched
      where not exists (
        select 1 from jsonb_array_elements(v_standings) as e(v) where e.v ->> 'user_id' = sched.u)
    ) then
      v_reason := 'standings_missing_participant';
    end if;

    -- Per participant: exactly num_weeks regular rows (one per week, byes
    -- included), all scored, and summed gains == points_for to the cent.
    if v_reason is null then
      with fs as (
        select e.v ->> 'user_id' as u, (e.v ->> 'points_for')::numeric as pf
        from jsonb_array_elements(v_standings) as e(v)
      ),
      mine as (
        select fs.u, fs.pf,
               count(m.id)::int                                   as rows_n,
               count(distinct m.week_number)::int                 as weeks_n,
               count(m.id) filter (where m.team1_gain is null)::int as unscored_n,
               coalesce(sum(case when m.team1_user_id = fs.u then m.team1_gain
                                 else m.team2_gain end), 0)       as gain_sum
        from fs
        left join matchups m
          on m.league_id = p_league_id and m.is_playoff is not true
         and fs.u in (m.team1_user_id, m.team2_user_id)
        group by fs.u, fs.pf
      )
      select case
               when bool_or(mine.rows_n <> coalesce(v_league.num_weeks, -1)
                            or mine.weeks_n <> coalesce(v_league.num_weeks, -1)
                            or mine.unscored_n > 0) then 'weeks_unscored'
               when bool_or(round(mine.gain_sum, 2) <> round(coalesce(mine.pf, 0), 2))
                    then 'points_for_mismatch'
             end
        into v_reason
      from mine;
    end if;
  end if;

  completed_at := v_season.completed_at;

  if v_reason is not null then
    status := 'inconsistent';
    reason := v_reason;
    return next;
    return;
  end if;

  -- ---- the verdict: complete --------------------------------------------------
  status          := 'complete';
  detail_scope    := case when v_is_current then 'full' else 'standings_only' end;
  standings_count := jsonb_array_length(v_standings);

  champion_user_id       := v_season.champion_user_id;
  runner_up_user_id      := v_season.runner_up_user_id;
  champion_display_name  := case when v_season.champion_user_id is null then null
                                 else public.league_participant_display_name(p_league_id, v_season.champion_user_id) end;
  runner_up_display_name := case when v_season.runner_up_user_id is null then null
                                 else public.league_participant_display_name(p_league_id, v_season.runner_up_user_id) end;

  select e.v into v_entry
  from jsonb_array_elements(v_standings) as e(v)
  where e.v ->> 'user_id' = v_caller
  limit 1;

  caller_participated := v_entry is not null;
  if not caller_participated then
    -- Joined after this season: the podium is still the season's, but there is
    -- no caller record to show.
    return next;
    return;
  end if;

  final_rank := (v_entry ->> 'rank')::int;
  wins       := (v_entry ->> 'wins')::numeric;
  losses     := (v_entry ->> 'losses')::numeric;
  ties       := (v_entry ->> 'ties')::numeric;
  points_for := (v_entry ->> 'points_for')::numeric;

  if not v_is_current then
    -- standings_only: the podium is known, eliminated-vs-missed is not.
    playoff_result := case when v_caller = v_season.champion_user_id then 'champion'
                           when v_caller = v_season.runner_up_user_id then 'runner_up' end;
    return next;
    return;
  end if;

  playoff_teams := v_p;
  playoff_weeks := v_w;

  select count(*)::int,
         count(*) filter (where m.winner_user_id = v_caller)::int,
         max(m.playoff_round_number)::int
    into v_my_po_games, v_my_po_wins, v_my_po_round
  from matchups m
  where m.league_id = p_league_id and m.is_playoff is true
    and v_caller in (m.team1_user_id, m.team2_user_id);

  playoff_wins   := v_my_po_wins;
  playoff_losses := v_my_po_games - v_my_po_wins;
  if v_caller = v_season.champion_user_id then
    playoff_result := 'champion';
    playoff_exit_round := v_w;
  elsif v_caller = v_season.runner_up_user_id then
    playoff_result := 'runner_up';
    playoff_exit_round := v_w;
  elsif v_my_po_games > 0 then
    playoff_result := 'eliminated';
    playoff_exit_round := v_my_po_round;
  else
    playoff_result := 'missed';
  end if;

  select m.week_number,
         case when m.team1_user_id = v_caller then m.team1_gain else m.team2_gain end
    into best_week_number, best_week_gain
  from matchups m
  where m.league_id = p_league_id and m.is_playoff is not true
    and v_caller in (m.team1_user_id, m.team2_user_id)
  order by case when m.team1_user_id = v_caller then m.team1_gain else m.team2_gain end desc,
           m.week_number asc
  limit 1;

  return next;
  return;
end;
$$;

revoke all on function public.get_season_result(uuid, uuid) from public;
revoke all on function public.get_season_result(uuid, uuid) from anon;
revoke all on function public.get_season_result(uuid, uuid) from authenticated;
revoke all on function public.get_season_result(uuid, uuid) from service_role;
grant execute on function public.get_season_result(uuid, uuid) to authenticated;

-- ---- get_renewal_roster: superset of 20261115000003 -----------------------------
create or replace function public.get_renewal_roster(p_league_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller text := auth.uid()::text;
  v_l      public.leagues%rowtype;
  v_r      public.league_renewal_responses%rowtype;
  v_member boolean;
  v_is_c   boolean;
  v_people jsonb;
  v_c      record;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into v_l from public.leagues where id = p_league_id;
  if not found or v_l.previous_league_id is null then
    return jsonb_build_object('status', 'not_visible');
  end if;
  select * into v_r from public.league_renewal_responses
   where league_id = p_league_id and user_id = v_caller;
  v_member := public.is_member(p_league_id);
  if not v_member and not found then
    return jsonb_build_object('status', 'not_visible');
  end if;

  if not v_member then
    -- commissioner_name: so a pending invitee's ask can name who is running it back.
    return jsonb_build_object(
      'status', 'ok', 'league_id', p_league_id, 'full_list', false,
      'commissioner_name', public.league_participant_display_name(p_league_id, v_l.commissioner_id),
      'caller_status', v_r.status, 'caller_decided_by', v_r.decided_by,
      'draft_status', v_l.draft_status, 'draft_date', v_l.draft_date);
  end if;

  v_is_c := v_l.commissioner_id = v_caller;
  select * into v_c from public._renewal_counts(p_league_id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', x.user_id,
           'display_name', public.league_participant_display_name(p_league_id, x.user_id),
           'group', x.grp,
           'is_commissioner', x.user_id = v_l.commissioner_id,
           'decided_by', x.decided_by,
           'responded_at', case when x.grp in ('in','out') then x.responded_at end,
           'nudge_count', case when v_is_c then x.nudge_count end,
           'last_nudged_at', case when v_is_c then x.last_nudged_at end,
           'can_nudge', v_is_c and x.grp = 'pending'
                        and (x.last_nudged_at is null or x.last_nudged_at <= now() - interval '24 hours'),
           'can_remove', v_is_c and x.grp = 'pending'
         ) order by x.grp, x.user_id), '[]'::jsonb)
    into v_people
    from (
      select r.user_id,
             case r.status when 'in' then 'in' when 'out' then 'out' else 'pending' end as grp,
             r.decided_by, r.responded_at, r.nudge_count, r.last_nudged_at
        from public.league_renewal_responses r where r.league_id = p_league_id
      union all
      select m.user_id, 'new', null::text, null::timestamptz, 0::smallint, null::timestamptz
        from public.league_members m
       where m.league_id = p_league_id
         and m.user_id not like 'bot-%'
         and not exists (select 1 from public.league_renewal_responses r
                          where r.league_id = m.league_id and r.user_id = m.user_id)
    ) x;

  return jsonb_build_object(
    'status', 'ok',
    'league_id', p_league_id,
    'full_list', true,
    'commissioner_name', public.league_participant_display_name(p_league_id, v_l.commissioner_id),
    'is_commissioner', v_is_c,
    'caller_status', case when v_r.user_id is null then 'new' else v_r.status end,
    'draft_status', v_l.draft_status,
    'draft_date', v_l.draft_date,
    'counts', jsonb_build_object(
      'in', v_c.n_in, 'new', v_c.n_new, 'out', v_c.n_out, 'pending', v_c.n_pending,
      'team_count', v_c.n_in + v_c.n_new, 'max_teams', 16),
    'replies_pending', v_c.n_pending > 0,
    'people', v_people);
end;
$$;

revoke all on function public.get_renewal_roster(uuid)                       from public, anon, service_role;
grant execute on function public.get_renewal_roster(uuid)                    to authenticated;

-- ---- get_league_history: superset of 20261115000003 -----------------------------
create or replace function public.get_league_history(p_league_id uuid)
returns table(
  league_id              uuid,
  season_number          int,
  is_current             boolean,
  draft_status           text,
  season_id              uuid,
  completed_at           timestamptz,
  champion_user_id       text,
  champion_display_name  text,
  runner_up_user_id      text,
  runner_up_display_name text,
  final_standings        jsonb,
  my_rank                int,
  my_wins                numeric,
  my_losses              numeric,
  my_ties                numeric,
  my_points_for          numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller text := auth.uid()::text;
  v_key    uuid;
  v_max    int;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select coalesce(l.lineage_id, l.id) into v_key from public.leagues l where l.id = p_league_id;
  if not found then
    return;
  end if;
  -- Visibility ceiling: a caller sees every season up to the LATEST one they
  -- were a member of. A newcomer (a member of Season 2) reads Season 1; a player
  -- who declined or was removed from Season 2 does not read Season 2.
  select max(l.season_number) into v_max
    from public.leagues l
    join public.league_members m on m.league_id = l.id and m.user_id = v_caller
   where coalesce(l.lineage_id, l.id) = v_key;
  if v_max is null then
    return;
  end if;

  return query
  select
    l.id,
    l.season_number,
    not exists (select 1 from public.leagues n where n.previous_league_id = l.id),
    l.draft_status,
    s.id,
    s.completed_at,
    s.champion_user_id,
    public.league_participant_display_name(l.id, s.champion_user_id),
    s.runner_up_user_id,
    public.league_participant_display_name(l.id, s.runner_up_user_id),
    case when jsonb_typeof(s.final_standings) = 'array' then (
      select jsonb_agg(e || jsonb_build_object(
               'display_name', public.league_participant_display_name(l.id, e->>'user_id'))
             order by (e->>'rank')::int)
        from jsonb_array_elements(s.final_standings) e)
    end,
    case when jsonb_typeof(s.final_standings) = 'array' then (
      select (e->>'rank')::int from jsonb_array_elements(s.final_standings) e
       where e->>'user_id' = v_caller) end,
    case when jsonb_typeof(s.final_standings) = 'array' then (
      select (e->>'wins')::numeric from jsonb_array_elements(s.final_standings) e
       where e->>'user_id' = v_caller) end,
    case when jsonb_typeof(s.final_standings) = 'array' then (
      select (e->>'losses')::numeric from jsonb_array_elements(s.final_standings) e
       where e->>'user_id' = v_caller) end,
    case when jsonb_typeof(s.final_standings) = 'array' then (
      select (e->>'ties')::numeric from jsonb_array_elements(s.final_standings) e
       where e->>'user_id' = v_caller) end,
    case when jsonb_typeof(s.final_standings) = 'array' then (
      select (e->>'points_for')::numeric from jsonb_array_elements(s.final_standings) e
       where e->>'user_id' = v_caller) end
  from public.leagues l
  left join public.league_seasons s on s.id = l.current_season_id
  where coalesce(l.lineage_id, l.id) = v_key
    and l.season_number <= v_max
  order by l.season_number desc;
end;
$$;

revoke all on function public.get_league_history(uuid)                       from public, anon, service_role;
grant execute on function public.get_league_history(uuid)                    to authenticated;

-- ---- get_season_matchups: superset of 20261115000003 -----------------------------
create or replace function public.get_season_matchups(p_league_id uuid)
returns table(
  league_id             uuid,
  season_number         int,
  week_number           int,
  is_playoff            boolean,
  playoff_round_number  smallint,
  bracket_position      smallint,
  week_start            timestamptz,
  week_end              timestamptz,
  team1_user_id         text,
  team1_display_name    text,
  team1_gain            numeric,
  team2_user_id         text,
  team2_display_name    text,
  team2_gain            numeric,
  winner_user_id        text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller text := auth.uid()::text;
  v_key    uuid;
  v_max    int;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select coalesce(l.lineage_id, l.id) into v_key from public.leagues l where l.id = p_league_id;
  if not found then
    return;
  end if;
  -- Same visibility ceiling as get_league_history.
  select max(l.season_number) into v_max
    from public.leagues l
    join public.league_members m on m.league_id = l.id and m.user_id = v_caller
   where coalesce(l.lineage_id, l.id) = v_key;
  if v_max is null then
    return;
  end if;

  -- The draft recap (picks per season) is NOT included: it is a separate read
  -- and is listed as a follow-up in the design.
  return query
  select l.id, l.season_number, mu.week_number, coalesce(mu.is_playoff, false),
         mu.playoff_round_number, mu.bracket_position, mu.week_start, mu.week_end,
         mu.team1_user_id, public.league_participant_display_name(l.id, mu.team1_user_id), mu.team1_gain,
         mu.team2_user_id, public.league_participant_display_name(l.id, mu.team2_user_id), mu.team2_gain,
         mu.winner_user_id
    from public.leagues l
    join public.matchups mu on mu.league_id = l.id
   where coalesce(l.lineage_id, l.id) = v_key
     and l.season_number <= v_max
   order by l.season_number desc, mu.week_number, coalesce(mu.is_playoff, false), mu.bracket_position;
end;
$$;

revoke all on function public.get_season_matchups(uuid)                      from public, anon, service_role;
grant execute on function public.get_season_matchups(uuid)                   to authenticated;
