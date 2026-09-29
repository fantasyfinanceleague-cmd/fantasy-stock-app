-- ============================================================================
-- Flexible playoffs (2/4): start_league_playoffs validates ANY-P brackets
-- ============================================================================
-- Replaces the body of start_league_playoffs (20261011000003). The claim, the
-- compare-and-swap on p_expected_week, the atomic insert, the return statuses
-- and the grants are UNCHANGED; see that migration's header for the concurrency
-- argument. What changes is validation, which used to accept only the 2/4/8
-- shapes (rounds quarter|semi|finals, weeks num_weeks+1..+3) and now accepts
-- exactly the bracket that supabase/functions/_shared/playoff-bracket.ts
-- planBracket() defines for the league's own playoff_teams, and nothing else.
--
-- THE SHAPE IS RECOMPUTED HERE, NOT TRUSTED. From P = leagues.playoff_teams:
--   W = ceil(log2 P), size = 2^W, the display seed order for `size` lines
--   (1,8 | 5,4 | 3,6 | 7,2 ...). Round-1 line pair p is a game iff both seeds
--   are <= P (team1 = the better seed), else the better seed is a BYE placed
--   into round 2, position p/2, slot team1 if p is even else team2. Rounds 3+
--   are all placeholders. The caller's rows must match that expected set
--   EXACTLY: P - 1 rows, unique addresses, each at week num_weeks + round, with
--   the structural round code, and the exact seeds (or NULLs) in each slot.
--   The caller supplies only the seed -> user mapping (from
--   league_standings_ranked); every user must be a distinct league member.
--   So a bye can never be a missing row by accident: the function only accepts
--   the absence of a round-1 game where the math puts a bye.
--
-- NEW REFUSAL REASONS (write-free, before the claim):
--   invalid_playoff_teams       playoff_teams NULL or < 2
--   bracket_too_large           more than 16 teams (> 4 rounds: no round code),
--                               checked before any bit shift (a huge P can
--                               not reach the loop)
--   bracket_bad_position        bracket_position missing / not an integer / out of range
--   bracket_bad_seed            a seed that is not an integer 1..P, or a team
--                               without a seed (or a seed without a team)
--   bracket_bad_size            not exactly P - 1 rows
--   bracket_duplicate_address   two rows at one (round, position)
--   bracket_shape_mismatch      a row whose seeds are not what the math puts there
--   bracket_duplicate_team      one user in two slots
-- Kept: bracket_not_a_nonempty_array, bracket_row_not_object, bracket_bad_round
-- (now: playoff_round_number out of range, or playoff_round != its code),
-- bracket_bad_week (now: week_number != num_weeks + round), bracket_non_member,
-- bracket_self_pairing, bracket_first_round_incomplete.
--
-- SECURITY: unchanged. SECURITY DEFINER, search_path pinned, EXECUTE for
-- service_role only. CREATE OR REPLACE keeps the ACL, but the revoke/grant block
-- is restated so this file alone is the lockdown (CLAUDE.md: REVOKE FROM PUBLIC
-- does not clear Supabase's explicit anon/authenticated grants).
--
-- POST-PUSH EFFECT CHECKS:
--   SELECT proname, proacl, prosecdef, proconfig FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND proname = 'start_league_playoffs';
--   -- expect one row; proacl {postgres=X/postgres,service_role=X/postgres};
--   -- prosecdef t; proconfig {"search_path=public, pg_temp"}
--   SELECT pg_get_functiondef('public.start_league_playoffs(uuid,int,jsonb)'::regprocedure)
--     LIKE '%bracket_shape_mismatch%';                                   -- expect t
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
  v_p         int;
  v_w         int;
  v_size      int;
  v_order     int[];
  v_next      int[];
  v_n2        int;
  v_i         int;
  v_s         int;
  v_a         int;
  v_b         int;
  v_expected  jsonb := '{}'::jsonb;  -- 'round:pos' -> [seed1|null, seed2|null]
  v_row       jsonb;
  v_rn        numeric;
  v_pos       numeric;
  v_wnum      numeric;
  v_seed      jsonb;
  v_t1        text;
  v_t2        text;
  v_codes     text[] := array['finals', 'semi', 'quarter', 'round_of_16'];
  v_key       text;
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

  v_p := v_league.playoff_teams;
  if v_p is null or v_p < 2 then
    return jsonb_build_object('status', 'refused', 'reason', 'invalid_playoff_teams');
  end if;
  -- Refuse > 16 teams (more than 4 rounds: no round code) BEFORE any shift.
  -- playoff_teams has no DB upper bound (P <= managers is enforced at draft
  -- start), and int4 `1 << n` is undefined for n >= 32 (it wraps to 1 on x86),
  -- so the loop below must never see a P it could not reach: a huge P would
  -- otherwise spin forever inside the shared process-week-results run
  -- (security review, 2026-09-29).
  if v_p > (1 << array_length(v_codes, 1)) then
    return jsonb_build_object('status', 'refused', 'reason', 'bracket_too_large');
  end if;
  v_w := 0;
  while (1 << v_w) < v_p loop v_w := v_w + 1; end loop;
  v_size := 1 << v_w;

  if p_bracket is null or jsonb_typeof(p_bracket) <> 'array' or jsonb_array_length(p_bracket) = 0 then
    return jsonb_build_object('status', 'refused', 'reason', 'bracket_not_a_nonempty_array');
  end if;

  -- Per-row checks. Every number is range-checked as numeric BEFORE any int
  -- cast, so a hostile value is a clean refusal, not an "out of range" error.
  for v_row in select * from jsonb_array_elements(p_bracket) loop
    if jsonb_typeof(v_row) <> 'object' then
      return jsonb_build_object('status', 'refused', 'reason', 'bracket_row_not_object');
    end if;

    if jsonb_typeof(v_row -> 'playoff_round_number') is distinct from 'number' then
      return jsonb_build_object('status', 'refused', 'reason', 'bracket_bad_round');
    end if;
    v_rn := (v_row ->> 'playoff_round_number')::numeric;
    if v_rn <> trunc(v_rn) or v_rn < 1 or v_rn > v_w
       or (v_row ->> 'playoff_round') is distinct from v_codes[v_w - v_rn::int + 1] then
      return jsonb_build_object('status', 'refused', 'reason', 'bracket_bad_round');
    end if;

    if jsonb_typeof(v_row -> 'bracket_position') is distinct from 'number' then
      return jsonb_build_object('status', 'refused', 'reason', 'bracket_bad_position');
    end if;
    v_pos := (v_row ->> 'bracket_position')::numeric;
    if v_pos <> trunc(v_pos) or v_pos < 0 or v_pos >= (v_size >> v_rn::int) then
      return jsonb_build_object('status', 'refused', 'reason', 'bracket_bad_position');
    end if;

    if jsonb_typeof(v_row -> 'week_number') is distinct from 'number' then
      return jsonb_build_object('status', 'refused', 'reason', 'bracket_bad_week');
    end if;
    v_wnum := (v_row ->> 'week_number')::numeric;
    if v_wnum <> v_league.num_weeks + v_rn then
      return jsonb_build_object('status', 'refused', 'reason', 'bracket_bad_week');
    end if;

    v_t1 := v_row ->> 'team1_user_id';
    v_t2 := v_row ->> 'team2_user_id';
    -- A team and its seed come together or not at all (an unseeded team, or a
    -- seed on an empty slot, would corrupt the seed tiebreak later).
    foreach v_key in array array['1', '2'] loop
      v_seed := v_row -> ('team' || v_key || '_seed');
      if (case v_key when '1' then v_t1 else v_t2 end) is null then
        if v_seed is not null and jsonb_typeof(v_seed) <> 'null' then
          return jsonb_build_object('status', 'refused', 'reason', 'bracket_bad_seed');
        end if;
      else
        if jsonb_typeof(v_seed) is distinct from 'number'
           or (v_seed #>> '{}')::numeric <> trunc((v_seed #>> '{}')::numeric)
           or (v_seed #>> '{}')::numeric < 1 or (v_seed #>> '{}')::numeric > v_p then
          return jsonb_build_object('status', 'refused', 'reason', 'bracket_bad_seed');
        end if;
      end if;
    end loop;

    if (v_t1 is not null and not exists (select 1 from league_members m where m.league_id = p_league_id and m.user_id = v_t1))
       or (v_t2 is not null and not exists (select 1 from league_members m where m.league_id = p_league_id and m.user_id = v_t2)) then
      return jsonb_build_object('status', 'refused', 'reason', 'bracket_non_member');
    end if;
    if v_t1 is not null and v_t1 = v_t2 then
      return jsonb_build_object('status', 'refused', 'reason', 'bracket_self_pairing');
    end if;
  end loop;

  -- EVERY first-round row must be fully populated, not just one (the CLAUDE.md
  -- "any row" vs "every row" trap). Byes are not rows, so this holds for any P.
  if not exists (
       select 1 from jsonb_array_elements(p_bracket) r where (r ->> 'playoff_round_number')::int = 1)
     or exists (
       select 1 from jsonb_array_elements(p_bracket) r
       where (r ->> 'playoff_round_number')::int = 1
         and (r ->> 'team1_user_id' is null or r ->> 'team2_user_id' is null)) then
    return jsonb_build_object('status', 'refused', 'reason', 'bracket_first_round_incomplete');
  end if;

  if jsonb_array_length(p_bracket) <> v_p - 1 then
    return jsonb_build_object('status', 'refused', 'reason', 'bracket_bad_size');
  end if;
  if (select count(distinct (r ->> 'playoff_round_number') || ':' || (r ->> 'bracket_position'))
        from jsonb_array_elements(p_bracket) r) <> v_p - 1 then
    return jsonb_build_object('status', 'refused', 'reason', 'bracket_duplicate_address');
  end if;

  -- The expected bracket (mirror of planBracket). Display seed order first.
  v_order := array[1, 2];
  while array_length(v_order, 1) < v_size loop
    v_n2 := array_length(v_order, 1) * 2;
    v_next := '{}';
    for v_i in 1 .. array_length(v_order, 1) loop
      v_s := v_order[v_i];
      if (v_i - 1) % 2 = 0 then v_next := v_next || array[v_s, v_n2 + 1 - v_s];
      else v_next := v_next || array[v_n2 + 1 - v_s, v_s];
      end if;
    end loop;
    v_order := v_next;
  end loop;

  -- Rounds 2..W start as placeholders; byes then overwrite their round-2 slot.
  for v_i in 2 .. v_w loop
    for v_s in 0 .. (v_size >> v_i) - 1 loop
      v_expected := v_expected || jsonb_build_object(v_i || ':' || v_s, jsonb_build_array(null, null));
    end loop;
  end loop;
  for v_i in 0 .. (v_size / 2) - 1 loop
    v_a := least(v_order[2 * v_i + 1], v_order[2 * v_i + 2]);
    v_b := greatest(v_order[2 * v_i + 1], v_order[2 * v_i + 2]);
    if v_b <= v_p then
      v_expected := v_expected || jsonb_build_object('1:' || v_i, jsonb_build_array(v_a, v_b));
    else
      v_key := '2:' || (v_i / 2);
      v_expected := jsonb_set(v_expected, array[v_key, (v_i % 2)::text], to_jsonb(v_a));
    end if;
  end loop;

  -- Row count and unique addresses are already P - 1, and the expected set has
  -- exactly P - 1 keys, so "every row matches its expected key" means the two
  -- sets are equal.
  if exists (
       select 1 from jsonb_array_elements(p_bracket) r
       where v_expected -> ((r ->> 'playoff_round_number') || ':' || (r ->> 'bracket_position'))
             is distinct from jsonb_build_array(coalesce(r -> 'team1_seed', 'null'::jsonb),
                                                coalesce(r -> 'team2_seed', 'null'::jsonb))) then
    return jsonb_build_object('status', 'refused', 'reason', 'bracket_shape_mismatch');
  end if;

  if (select count(*) from (
        select r ->> 'team1_user_id' u from jsonb_array_elements(p_bracket) r where r ->> 'team1_user_id' is not null
        union all
        select r ->> 'team2_user_id' from jsonb_array_elements(p_bracket) r where r ->> 'team2_user_id' is not null) t)
     <> (select count(distinct u) from (
        select r ->> 'team1_user_id' u from jsonb_array_elements(p_bracket) r where r ->> 'team1_user_id' is not null
        union all
        select r ->> 'team2_user_id' from jsonb_array_elements(p_bracket) r where r ->> 'team2_user_id' is not null) t) then
    return jsonb_build_object('status', 'refused', 'reason', 'bracket_duplicate_team');
  end if;

  -- (a) CLAIM. Unchanged from 20261011000003; see CONCURRENCY there.
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
                        team1_seed, team2_seed, week_start, week_end, is_playoff, playoff_round,
                        playoff_round_number, bracket_position)
  select p_league_id, x.week_number, x.team1_user_id, x.team2_user_id,
         x.team1_seed, x.team2_seed, x.week_start, x.week_end, true, x.playoff_round,
         x.playoff_round_number, x.bracket_position
  from jsonb_to_recordset(p_bracket) as x(
    week_number int, team1_user_id text, team2_user_id text, team1_seed int, team2_seed int,
    week_start timestamptz, week_end timestamptz, playoff_round text,
    playoff_round_number smallint, bracket_position smallint);
  get diagnostics v_inserted = row_count;

  return jsonb_build_object('status', 'started', 'matchups_inserted', v_inserted);
end;
$$;

revoke all on function public.start_league_playoffs(uuid, int, jsonb) from public;
revoke all on function public.start_league_playoffs(uuid, int, jsonb) from anon;
revoke all on function public.start_league_playoffs(uuid, int, jsonb) from authenticated;
revoke all on function public.start_league_playoffs(uuid, int, jsonb) from service_role;
grant execute on function public.start_league_playoffs(uuid, int, jsonb) to service_role;
