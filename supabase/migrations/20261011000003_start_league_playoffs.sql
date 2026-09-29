-- ============================================================================
-- start_league_playoffs: claim the league + insert the bracket, atomically
-- ============================================================================
-- PROBLEM
--   process-week-results used to end a regular season with two independent
--   writes: UPDATE leagues SET season_status='playoffs', then one INSERT per
--   bracket row, with insert errors only logged. So:
--     * a failed or partial bracket insert stranded the league in 'playoffs'
--       with no (or half a) bracket, permanently: nothing re-selects a league
--       whose regular season is fully scored;
--     * once the heal pass (20261011000000 work, season-transition.ts) made the
--       transition RE-ENTERABLE, two overlapping runs (a cron retry plus a
--       manual run, or the heal pass racing a normal batch) could each insert a
--       bracket.
--
-- DESIGN: one transaction does both, and the claim comes first.
--   (a) CLAIM:  UPDATE leagues SET season_status='playoffs', current_week =
--               num_weeks + 1 WHERE id = p_league_id AND season_status = 'active'
--               AND current_week = p_expected_week AND no playoff matchup exists
--               for the league. p_expected_week is the current_week the caller
--               observed when it decided to transition: a compare-and-swap token,
--               so a caller acting on a stale read changes nothing. current_week
--               is set to num_weeks + 1 (the bracket's first week, which the
--               validation below pins the bracket to), not p_expected_week + 1:
--               the two are equal in the normal case (current_week = num_weeks).
--   (b) INSERT: the bracket rows passed in (built by the pure, unit-tested
--               buildPlayoffBracket in process-week-results/season-transition.ts
--               from seeds read from league_standings_ranked).
--   (c) RETURN: {status:'started', matchups_inserted:n}
--               | {status:'already_transitioned', season_status:...}  (not
--                 'active', or playoff rows exist: another run did it; no-op)
--               | {status:'not_eligible', current_week, expected_week}  (still
--                 'active' with no bracket, but current_week moved: no-op, and
--                 the caller reports it; the heal pass re-reads next run)
--               | {status:'refused', reason:...}  (validation; no-op)
--   Any error in (b) (a constraint violation, a bad timestamp) raises, and the
--   whole call rolls back INCLUDING the claim, so the league is back to
--   'active' with zero playoff rows and the heal pass retries it next run. A
--   half-written bracket is impossible.
--
-- CONCURRENCY. Every PostgREST rpc call is its own transaction. Two concurrent
--   calls both reach the UPDATE; the second blocks on the first's row lock on
--   the leagues row. When the first commits, READ COMMITTED re-evaluates the
--   WHERE clause against the NEW row version (EvalPlanQual). season_status is
--   now 'playoffs', so the second updates 0 rows and returns
--   already_transitioned without inserting anything. If the first rolls back,
--   the second claims normally. The season_status predicate is what makes this
--   safe. The NOT EXISTS is a guard for a league that somehow has playoff rows
--   while still 'active' (e.g. hand-edited); it is not re-checked under EPQ and
--   is not relied on for the race.
--
-- VALIDATION (write-free refusals, before the claim), mirroring
-- finalize_league_draft's refuse-don't-fabricate style:
--   league exists and is a matchup league with num_weeks > 0; the bracket is a
--   non-empty array of objects; each row's playoff_round is quarter|semi|finals
--   and its week_number is within num_weeks+1 .. num_weeks+3; every non-null
--   team id is a member of the league; no self-pairing; EVERY first-round row
--   is fully populated. current_week comes from the league's own num_weeks,
--   never from the caller.
--
-- SECURITY
--   SECURITY DEFINER (it writes leagues + matchups, which clients cannot) with
--   `set search_path = public, pg_temp`. Called ONLY by process-week-results
--   (service_role). Supabase's default privileges grant EXECUTE to anon and
--   authenticated, and REVOKE FROM PUBLIC does not clear them (CLAUDE.md), so
--   the block below revokes from all four roles and grants service_role only.
--   An anon-callable version would let anyone force any league into playoffs
--   with a forged bracket.
--
-- ---------------------------------------------------------------------------
-- POST-PUSH EFFECT CHECKS (run each separately):
--   -- 1. grants: expect service_role=X (+ postgres) only; prosecdef = t;
--   --    proconfig = {"search_path=public, pg_temp"}
--   SELECT proname, proacl, prosecdef, proconfig FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND proname = 'start_league_playoffs';
--   -- 2. call-time: as anon / authenticated, expect 42501 permission denied
-- ============================================================================

create or replace function public.start_league_playoffs(p_league_id uuid, p_expected_week int, p_bracket jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_league    leagues%rowtype;
  v_row       jsonb;
  v_round     text;
  v_wnum      numeric;
  v_t1        text;
  v_t2        text;
  v_first_wk  int;
  v_claimed   int;
  v_inserted  int;
  v_status    text;
  v_cur_week  int;
begin
  select * into v_league from leagues where id = p_league_id;
  if not found then
    return jsonb_build_object('status', 'refused', 'reason', 'league_not_found');
  end if;
  if v_league.league_type is distinct from 'matchup' or coalesce(v_league.num_weeks, 0) <= 0 then
    return jsonb_build_object('status', 'refused', 'reason', 'not_a_scheduled_matchup_league');
  end if;

  if p_bracket is null or jsonb_typeof(p_bracket) <> 'array' or jsonb_array_length(p_bracket) = 0 then
    return jsonb_build_object('status', 'refused', 'reason', 'bracket_not_a_nonempty_array');
  end if;

  for v_row in select * from jsonb_array_elements(p_bracket) loop
    if jsonb_typeof(v_row) <> 'object' then
      return jsonb_build_object('status', 'refused', 'reason', 'bracket_row_not_object');
    end if;
    v_round := v_row ->> 'playoff_round';
    if v_round is null or v_round not in ('quarter', 'semi', 'finals') then
      return jsonb_build_object('status', 'refused', 'reason', 'bracket_bad_round');
    end if;
    if jsonb_typeof(v_row -> 'week_number') <> 'number' then
      return jsonb_build_object('status', 'refused', 'reason', 'bracket_bad_week');
    end if;
    -- Range-checked as numeric BEFORE the int cast, so an out-of-range value is
    -- a clean refusal rather than an "integer out of range" exception.
    v_wnum := (v_row ->> 'week_number')::numeric;
    if v_wnum <> trunc(v_wnum)
       or v_wnum < v_league.num_weeks + 1 or v_wnum > v_league.num_weeks + 3 then
      return jsonb_build_object('status', 'refused', 'reason', 'bracket_bad_week');
    end if;
    v_t1 := v_row ->> 'team1_user_id';
    v_t2 := v_row ->> 'team2_user_id';
    if (v_t1 is not null and not exists (select 1 from league_members m where m.league_id = p_league_id and m.user_id = v_t1))
       or (v_t2 is not null and not exists (select 1 from league_members m where m.league_id = p_league_id and m.user_id = v_t2)) then
      return jsonb_build_object('status', 'refused', 'reason', 'bracket_non_member');
    end if;
    if v_t1 is not null and v_t1 = v_t2 then
      return jsonb_build_object('status', 'refused', 'reason', 'bracket_self_pairing');
    end if;
  end loop;

  -- EVERY first-round row must be fully populated, not just one (an EXISTS here
  -- would accept a first round with one real game and one half-empty slot:
  -- the CLAUDE.md "any row" vs "every row" trap). Later rounds are placeholders.
  v_first_wk := v_league.num_weeks + 1;
  if not exists (
       select 1 from jsonb_array_elements(p_bracket) r
       where (r ->> 'week_number')::int = v_first_wk)
     or exists (
       select 1 from jsonb_array_elements(p_bracket) r
       where (r ->> 'week_number')::int = v_first_wk
         and (r ->> 'team1_user_id' is null or r ->> 'team2_user_id' is null)) then
    return jsonb_build_object('status', 'refused', 'reason', 'bracket_first_round_incomplete');
  end if;

  -- (a) CLAIM. See CONCURRENCY above.
  update leagues l
     set season_status = 'playoffs',
         current_week  = v_league.num_weeks + 1
   where l.id = p_league_id
     and l.season_status = 'active'
     and l.current_week = p_expected_week
     and not exists (select 1 from matchups m where m.league_id = p_league_id and m.is_playoff);
  get diagnostics v_claimed = row_count;

  if v_claimed = 0 then
    select season_status, current_week into v_status, v_cur_week from leagues where id = p_league_id;
    if v_status is distinct from 'active'
       or exists (select 1 from matchups m where m.league_id = p_league_id and m.is_playoff) then
      return jsonb_build_object('status', 'already_transitioned', 'season_status', v_status);
    end if;
    return jsonb_build_object('status', 'not_eligible', 'current_week', v_cur_week,
                              'expected_week', p_expected_week);
  end if;

  -- (b) INSERT. Any error here rolls back the claim too.
  insert into matchups (league_id, week_number, team1_user_id, team2_user_id,
                        team1_seed, team2_seed, week_start, week_end, is_playoff, playoff_round)
  select p_league_id, x.week_number, x.team1_user_id, x.team2_user_id,
         x.team1_seed, x.team2_seed, x.week_start, x.week_end, true, x.playoff_round
  from jsonb_to_recordset(p_bracket) as x(
    week_number int, team1_user_id text, team2_user_id text, team1_seed int, team2_seed int,
    week_start timestamptz, week_end timestamptz, playoff_round text);
  get diagnostics v_inserted = row_count;

  return jsonb_build_object('status', 'started', 'matchups_inserted', v_inserted);
end;
$$;

revoke all on function public.start_league_playoffs(uuid, int, jsonb) from public;
revoke all on function public.start_league_playoffs(uuid, int, jsonb) from anon;
revoke all on function public.start_league_playoffs(uuid, int, jsonb) from authenticated;
revoke all on function public.start_league_playoffs(uuid, int, jsonb) from service_role;
grant execute on function public.start_league_playoffs(uuid, int, jsonb) to service_role;
