-- ============================================================================
-- get_season_result: the caller's summary of ONE finished season, + the podium
-- ============================================================================
-- Phase-3 backend ask #11: the mobile Home "Season complete" state (3b-2,
-- board docs/design/screens/inventory.jsx HomeComplete). One read-only call.
--
--   get_season_result(p_league_id uuid, p_season_id uuid default null)
--     -> ONE row, or 0 rows (not a member / unknown league / season of another
--        league -- indistinguishable on purpose, so it is no existence oracle).
--
-- SEASON SELECTION
--   p_season_id given   -> that season (must belong to p_league_id, else 0 rows)
--   p_season_id NULL    -> the latest COMPLETED season (highest season_number
--                          with completed_at set); if none, the league's current
--                          season, reported as 'not_complete'; if the league has
--                          no season at all (pre-draft), 'not_complete' with
--                          reason 'no_season'.
--
-- WHERE THE NUMBERS COME FROM (reused, never re-derived)
--   final_rank / wins / losses / ties / points_for: the caller's entry in
--     league_seasons.final_standings, written by complete_league_season
--     (20261011000002) from league_standings_ranked. The rank is therefore the
--     unified order the standings screen showed and the playoffs were seeded
--     from. points_for IS the Standings "Season gain" number. Seasons completed
--     before 20261011 carry the old wins->points_for rank; that is the rank their
--     history already shows, so it is returned as stored.
--   champion / runner-up: league_seasons.champion_user_id / runner_up_user_id.
--   playoff record + how far: the season's playoff rows (#66 addresses).
--   best week: the caller's highest-gain SCORED regular-season week. Bye weeks
--     are included: a bye records no W/L/T but its real gain counts toward
--     season gain (process-week-results standingsIncrements), so it is a week
--     the caller scored. Equal gains -> the earliest week.
--
-- NO DISPLAY COPY IN SQL
--   Round names are derived by the client from playoff_teams with the existing
--   playoffRoundLabels (_shared/playoff-bracket.ts, mirrored byte-for-byte in
--   apps/mobile/lib/playoffs.ts + apps/web, pinned by a test). This function
--   returns STRUCTURE only: playoff_result in ('champion','runner_up',
--   'eliminated','missed'), playoff_exit_round (1..playoff_weeks). The client
--   maps champion -> "Champion", runner_up -> "Final", eliminated at round r ->
--   playoffRoundLabels(playoff_teams)[r-1]. A fourth copy of the label table
--   here would be a drift risk.
--
-- DROPPED FROM v1: "best pick" (the drafted symbol with the best return). Not
--   honestly derivable server-side today:
--     (a) drafts carry no season: draft rows persist across seasons, so a pick
--         cannot be attributed to season N >= 2;
--     (b) there is no season-END price for a pick that was sold mid-season;
--     (c) symbols.last_price is a LIVE price, not a season-end one (a ~2-day
--         enrich rotation, and ~31% of active symbols are NULL).
--   The honest path is to snapshot a best pick at completion time (inside
--   complete_league_season, from week_snapshots), not to guess it here.
--   Also not here: the board's "Final value" (not budget + points_for under
--   weekly snapshot scoring); flagged to Design.
--
-- ---------------------------------------------------------------------------
-- WHY MOST PAST SEASONS ARE 'standings_only'
--   start_new_league_season (20260718000000) RESETS league_standings and
--   DELETES every matchup of the league. A season that is no longer the league's
--   current season therefore keeps ONLY its league_seasons row (podium +
--   final_standings). So:
--     detail_scope = 'full'           the league's CURRENT season, completed:
--                                     every field, and every coverage check ran.
--     detail_scope = 'standings_only' an older season: podium, rank, record,
--                                     points_for. playoff_result is only
--                                     'champion' / 'runner_up' (from the podium)
--                                     or NULL -- eliminated vs missed cannot be
--                                     known, so it is NOT guessed. Playoff W/L,
--                                     exit round, best week: NULL. The flag says
--                                     so; nothing is left for the client to infer
--                                     from a NULL.
--   The Home "Season complete" state is always the current season, i.e. 'full'.
--
-- STATUS -- refuse honestly on partial state (CLAUDE.md "guards keyed on
-- all-or-nothing state"; "verdict scope must match evidence scope")
--   'complete'      every check below passed for the scope stated.
--   'not_complete'  completed_at IS NULL (or no season). NO champion, no caller
--                   fields: an unfinished season never gets a podium.
--   'inconsistent'  completed_at is set but the evidence disagrees. `reason`
--                   names the FIRST failed check; every derived field is NULL.
--                   Nothing is fabricated from a half-true record.
--   'unsupported'   not a matchup league (duration leagues have no seasons of
--                   matchups to summarise).
--   Checks, 'full' scope, each a COUNT AGAINST THE EXPECTED SET, never EXISTS:
--     season_status_mismatch        the current season has completed_at but the
--                                   league is not 'completed'.
--     final_standings_missing       completed with no final_standings array.
--     playoffs_unscored             the league-season has no playoff rows, or
--                                   any playoff row is unscored.
--     playoff_shape_mismatch        rows != P-1 for the league's playoff_teams,
--                                   or the deepest round != ceil(log2 P), or no
--                                   single final at (W, 0). P is taken from the
--                                   ROWS (count + 1) and checked against
--                                   leagues.playoff_teams, so a later settings
--                                   change cannot silently relabel the bracket.
--     playoff_final_unresolved      the final is scored but names no winner
--                                   (unreachable today: a playoff game always
--                                   resolves by seed; refused, not guessed).
--     champion_mismatch             the scored final's winner/loser are not
--                                   champion_user_id/runner_up_user_id. Catches
--                                   a forged podium on the current season.
--     standings_missing_participant someone scheduled in the regular season has
--                                   no final_standings entry (the ranking left
--                                   them out, so every rank is suspect).
--     weeks_unscored                a final_standings participant does not have
--                                   exactly num_weeks regular rows (one per week,
--                                   byes included), all scored.
--     points_for_mismatch           a participant's summed regular gains !=
--                                   their final_standings points_for (to the
--                                   cent). process-week-results only LOGS a
--                                   failed standings write (updateUserStandings),
--                                   so a scored week can be missing from the
--                                   season gain; this refuses instead of showing
--                                   a silently low number.
--   The weeks/points checks run for EVERY participant, not just the caller: the
--   caller's rank depends on everyone's record, so one member's gap makes every
--   rank suspect. W/L/T are NOT recomputed (data written under the old
--   bye-as-win rule would disagree; the stored record is what history shows).
--
-- SECURITY -- SECURITY DEFINER + explicit membership gate, and why not INVOKER
--   (1) The coverage checks must count against the WHOLE league-season. Under
--       INVOKER they would inherit league_standings_ranked's all-or-none RLS
--       visibility assumption (20261011000000): a future policy hiding SOME rows
--       from a member would make "every week scored" silently true over a
--       subset -- a subset-derived verdict stated as a whole-season one. As the
--       owner (postgres) this function always sees every row.
--   (2) The podium's display names need participant_display_name, a postgres-
--       only helper by design (20261004000000), so the card is one call.
--   The gate: auth.uid() NULL -> 42501; not in league_members for p_league_id
--   (public.is_member, the one definition of membership) -> 0 rows. Every read
--   below is keyed on p_league_id, and a p_season_id is only honoured when it
--   belongs to that league, so a member cannot read another league's season.
--   A member who has LEFT the league is no longer a member and gets 0 rows.
--
--   Grants: Supabase default privileges put anon/authenticated/service_role
--   EXECUTE on every new function, and REVOKE FROM PUBLIC does not clear them
--   (CLAUDE.md). Explicit revoke from all four, then authenticated only. No
--   server caller exists, and service_role has no auth.uid() so it would be
--   refused anyway.
--
-- ---------------------------------------------------------------------------
-- POST-PUSH EFFECT CHECKS (run each separately):
--   -- 1. grants: expect {postgres=X/postgres,authenticated=X/postgres} only
--   --    (no anon=, no service_role=, no bare =X); prosecdef = t;
--   --    proconfig = {"search_path=public, pg_temp"}
--   SELECT proname, proacl, prosecdef, proconfig FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND proname = 'get_season_result';
--   -- 2. effect, in the SQL editor as a member of a completed test league
--   --    (replace both ids; expect ONE row with a status, never an error):
--   BEGIN;
--   SET LOCAL ROLE authenticated;
--   SELECT set_config('request.jwt.claim.sub', '<member-uuid>', true);
--   SELECT * FROM public.get_season_result('<league-uuid>');
--   ROLLBACK;
--   -- 3. anon: expect ERROR 42501 permission denied for function
--   BEGIN; SET LOCAL ROLE anon;
--   SELECT * FROM public.get_season_result('<league-uuid>');
--   ROLLBACK;
-- ============================================================================

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
                                 else public.participant_display_name(v_season.champion_user_id) end;
  runner_up_display_name := case when v_season.runner_up_user_id is null then null
                                 else public.participant_display_name(v_season.runner_up_user_id) end;

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
