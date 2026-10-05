-- ============================================================================
-- league_standings_ranked(p_league_id, p_through_week): "standings as of week N"
-- ============================================================================
-- PROVISIONAL TIMESTAMP 20261030000000 (latest existing migration is
-- 20261029000000). Re-stamp at release so it sorts after the final migration.
--
-- PURPOSE
--   The 1-arg league_standings_ranked(uuid) reads the CUMULATIVE league_standings
--   table, so it can only answer "as of now". This overload answers "as of the end
--   of week p_through_week" by deriving each member's W/L/T, points_for and
--   points_against FROM public.matchups, restricted to week_number <=
--   p_through_week, then ranking with the SAME algorithm (win% -> head-to-head
--   mini-league -> season gain -> joined_at/user_id) as the 1-arg function.
--
-- DERIVATION (checked against process-week-results, 2026-10-05)
--   Only rows with team1_gain IS NOT NULL (scored) and is_playoff = false count.
--   For each scored regular-season matchup:
--     * team1 side: points_for += team1_gain; points_against += team2_gain
--       (0 on a bye, where team2_gain is NULL).
--     * team2 side (non-bye only): points_for += team2_gain;
--       points_against += team1_gain.
--     * non-bye: winner_user_id = me -> wins; winner = opponent -> losses;
--       is_tie -> ties (winner NULL). Same as standingsIncrements().
--     * bye (team2_user_id IS NULL): NO W/L/T, but points_for += team1_gain.
--       Same as standingsIncrements() returning team2 = null and no W/L/T.
--     * playoff matchups (is_playoff) contribute NOTHING. The server never writes
--       league_standings for them (index.ts `if (!isPlayoff)` around the
--       standings writes).
--   Roster = the league_standings user_id set (NOT matchup participants). The
--   draft finalizer (finalize_league_draft, 20260926000000) inserts a zero row for
--   every member at draft time, so a member with no scored games yet still ranks
--   (0-0-0, season gain 0, join order), exactly as in the 1-arg function.
--
-- WHEN THE ANSWER EQUALS THE 1-ARG FUNCTION
--   p_through_week >= the latest scored regular-season week gives the same rows as
--   league_standings_ranked(p_league_id), PROVIDED league_standings agrees with
--   matchups. That holds unless one of these is true:
--     (a) LEGACY BYE WINS. Scored regular-season byes written before the
--         bye-no-result deploy still carry a winner and inflate W and games played
--         in league_standings. This overload ignores them (correct under the
--         current rule). Until docs/migrations/bye-no-result-standings-recompute.sql
--         has run for the league, the two functions disagree on odd-roster leagues.
--     (b) A failed standings write. process-week-results updates matchups and then
--         league_standings in two separate statements and only logs a failed
--         standings write, so a matchup can be scored with no standings increment.
--         This overload is then the more accurate of the two, but the rows differ.
--
-- OVERLOAD SAFETY
--   CREATE OR REPLACE FUNCTION with a DIFFERENT argument list creates a second
--   function. It does NOT replace the 1-arg function and does NOT touch its ACL.
--   The 1-arg function is not modified by this file.
--   The new parameter has NO DEFAULT on purpose: with a default, a call such as
--   rpc('league_standings_ranked', { p_league_id }) would be ambiguous between the
--   two overloads. Callers that want the current standings keep using the 1-arg.
--
-- SECURITY -- SECURITY INVOKER (same reasoning as the 1-arg function)
--   Reads matchups, league_standings and league_members under the caller's RLS.
--   Those SELECT policies are league-wide (is_member), so a non-member gets 0
--   rows. The partial-visibility assumption in 20261011000000 applies unchanged.
--   The ranking core _league_standings_rank_core takes its inputs as jsonb and
--   reads NO tables. It is pure, so granting it to authenticated exposes nothing
--   beyond what the caller can already compute.
--
-- GRANTS
--   Supabase's default privileges grant EXECUTE to anon, authenticated and
--   service_role, and REVOKE FROM PUBLIC does not clear those grants (CLAUDE.md).
--   Each function therefore gets an explicit revoke from public, anon, authenticated
--   and service_role, then a grant to authenticated and service_role only.
--
-- ---------------------------------------------------------------------------
-- POST-PUSH EFFECT CHECKS (run each separately, after `supabase db push`)
--   -- 1. Both overloads. Expect, for EACH row: no anon=, no bare =X (PUBLIC),
--   --    authenticated=X and service_role=X (+ postgres) only, prosecdef = false.
--   --    The 1-arg row's proacl must be UNCHANGED from before this push.
--   SELECT proname, pg_get_function_identity_arguments(p.oid) AS args,
--          proacl, prosecdef, proconfig
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND proname = 'league_standings_ranked';
--   -- 2. The ranking core: no anon=, no =X PUBLIC.
--   SELECT proname, proacl FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND proname = '_league_standings_rank_core';
--   -- 3. Through-week at the latest scored week must equal the 1-arg standings.
--   --    Expect 0 rows. A league listed here is either a legacy-bye (a) or a
--   --    failed-standings-write (b) case from the header, not a bug in this file.
--   WITH latest AS (
--     SELECT l.id AS league_id,
--            coalesce((SELECT max(m.week_number) FROM matchups m
--                      WHERE m.league_id = l.id AND m.team1_gain IS NOT NULL
--                        AND coalesce(m.is_playoff, false) = false), 0) AS wk
--     FROM leagues l WHERE l.league_type = 'matchup'
--   )
--   SELECT x.league_id, count(*) AS mismatched_rows
--   FROM latest x
--   CROSS JOIN LATERAL (
--     (SELECT user_id, rank, wins, losses, ties, points_for
--        FROM public.league_standings_ranked(x.league_id)
--      EXCEPT
--      SELECT user_id, rank, wins, losses, ties, points_for
--        FROM public.league_standings_ranked(x.league_id, x.wk))
--     UNION ALL
--     (SELECT user_id, rank, wins, losses, ties, points_for
--        FROM public.league_standings_ranked(x.league_id, x.wk)
--      EXCEPT
--      SELECT user_id, rank, wins, losses, ties, points_for
--        FROM public.league_standings_ranked(x.league_id))
--   ) d
--   GROUP BY x.league_id;
--
-- TESTS
--   The hermetic PGlite suite lives in supabase/tests/ (run with Deno; see
--   supabase/tests/README.md). Extend supabase/tests/league_standings_through_week.pglite.test.ts
--   with the through-week cases: week-N derivation, bye adds points_for only,
--   playoff rows excluded, and through-latest == 1-arg.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Ranking core. Pure: the caller passes the per-member rows and the counted
-- games; this function reads no tables. Same algorithm and the same tiebreak
-- labels as league_standings_ranked(uuid) in 20261011000000.
--
--   p_rows  jsonb array of
--           { user_id text, wins num, losses num, ties num,
--             points_for num, points_against num, joined_at timestamptz|null }
--   p_games jsonb array of COUNTED head-to-head games ONLY, i.e. scored,
--           regular-season, non-bye matchups:
--           { t1 text, t2 text, w text|null }   (w NULL = drawn game)
-- ----------------------------------------------------------------------------
create or replace function public._league_standings_rank_core(p_rows jsonb, p_games jsonb)
returns table(
  user_id         text,
  rank            int,
  wins            numeric,
  losses          numeric,
  ties            numeric,
  win_points      numeric,
  win_pct         numeric,
  games_played    numeric,
  points_for      numeric,
  points_against  numeric,
  tiebreak        text
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_queue    jsonb := '[]'::jsonb;
  v_seg      jsonb;
  v_set      text[];
  v_n        int;
  v_pairs    int;
  v_min      int;
  v_max      int;
  v_parts    jsonb;
  v_order    text[] := '{}';
  v_labels   text[] := '{}';
  v_u        text;
  v_dup      boolean;
begin
  -- Seed the queue with win_pct buckets, best first.
  select coalesce(jsonb_agg(jsonb_build_object('u', b.users, 'l', null) order by b.pct desc), '[]'::jsonb)
    into v_queue
  from (
    select case when s.wins + s.losses + s.ties > 0
                then round((s.wins + 0.5 * s.ties) / (s.wins + s.losses + s.ties), 12)
                else 0 end as pct,
           jsonb_agg(s.user_id order by s.user_id) as users
    from jsonb_to_recordset(p_rows)
      as s(user_id text, wins numeric, losses numeric, ties numeric,
           points_for numeric, points_against numeric, joined_at timestamptz)
    group by 1
  ) b;

  while jsonb_array_length(v_queue) > 0 loop
    v_seg   := v_queue -> 0;
    v_queue := v_queue - 0;
    v_set   := array(select jsonb_array_elements_text(v_seg -> 'u'));
    v_n     := cardinality(v_set);

    if v_n = 1 then
      v_order  := v_order  || v_set[1];
      v_labels := v_labels || (v_seg ->> 'l');
      continue;
    end if;

    -- Mini-league among v_set. Balanced = every one of the n(n-1)/2 pairs has
    -- met, and all pairs the same number of times.
    select count(*), min(c), max(c) into v_pairs, v_min, v_max
    from (
      select least(g.t1, g.t2) a,
             greatest(g.t1, g.t2) b,
             count(*)::int c
      from jsonb_to_recordset(p_games) as g(t1 text, t2 text, w text)
      where g.t1 = any(v_set)
        and g.t2 = any(v_set)
      group by 1, 2
    ) p;

    v_parts := null;
    if v_pairs = v_n * (v_n - 1) / 2 and v_min = v_max then
      -- Split by mini-league score, best first. Only used if it separates.
      select jsonb_agg(jsonb_build_object('u', g2.users, 'l', 'h2h') order by g2.score desc)
        into v_parts
      from (
        select sc.score, jsonb_agg(sc.u order by sc.u) as users
        from (
          select u.u,
                 coalesce(sum(case when gm.w = u.u then 1.0
                                   when gm.t1 is not null and gm.w is null then 0.5
                                   else 0 end), 0) as score
          from unnest(v_set) as u(u)
          left join jsonb_to_recordset(p_games) as gm(t1 text, t2 text, w text)
            on gm.t1 = any(v_set)
           and gm.t2 = any(v_set)
           and u.u in (gm.t1, gm.t2)
          group by u.u
        ) sc
        group by sc.score
      ) g2;
      if jsonb_array_length(v_parts) < 2 then
        v_parts := null; -- H2H did not separate anyone
      end if;
    end if;

    if v_parts is not null then
      -- Place the H2H subgroups ahead of everything still queued; a subgroup of
      -- 2+ is re-examined from the H2H step among just its own members.
      v_queue := v_parts || v_queue;
      continue;
    end if;

    -- Season gain, then join order, then user id.
    for v_u, v_dup in
      select s.user_id,
             count(*) over (partition by s.points_for) > 1
      from jsonb_to_recordset(p_rows)
        as s(user_id text, wins numeric, losses numeric, ties numeric,
             points_for numeric, points_against numeric, joined_at timestamptz)
      where s.user_id = any(v_set)
      order by s.points_for desc,
               s.joined_at asc nulls last,
               s.user_id asc
    loop
      v_order  := v_order  || v_u;
      v_labels := v_labels || case when v_dup then 'join_order' else 'season_gain' end;
    end loop;
  end loop;

  return query
  select s.user_id,
         o.ord::int,
         s.wins, s.losses, s.ties,
         s.wins + 0.5 * s.ties,
         case when s.wins + s.losses + s.ties > 0
              then round((s.wins + 0.5 * s.ties) / (s.wins + s.losses + s.ties), 12)
              else 0 end,
         s.wins + s.losses + s.ties,
         s.points_for, s.points_against,
         v_labels[o.ord]
  from unnest(v_order) with ordinality as o(uid, ord)
  join jsonb_to_recordset(p_rows)
    as s(user_id text, wins numeric, losses numeric, ties numeric,
         points_for numeric, points_against numeric, joined_at timestamptz)
    on s.user_id = o.uid
  order by o.ord;
end;
$$;

revoke all on function public._league_standings_rank_core(jsonb, jsonb) from public;
revoke all on function public._league_standings_rank_core(jsonb, jsonb) from anon;
revoke all on function public._league_standings_rank_core(jsonb, jsonb) from authenticated;
revoke all on function public._league_standings_rank_core(jsonb, jsonb) from service_role;
grant execute on function public._league_standings_rank_core(jsonb, jsonb) to authenticated;
grant execute on function public._league_standings_rank_core(jsonb, jsonb) to service_role;

-- ----------------------------------------------------------------------------
-- The through-week overload. A NEW signature: the 1-arg function is untouched.
-- ----------------------------------------------------------------------------
create or replace function public.league_standings_ranked(p_league_id uuid, p_through_week int)
returns table(
  user_id         text,
  rank            int,
  wins            numeric,
  losses          numeric,
  ties            numeric,
  win_points      numeric,
  win_pct         numeric,
  games_played    numeric,
  points_for      numeric,
  points_against  numeric,
  tiebreak        text
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_rows  jsonb;
  v_games jsonb;
begin
  -- A NULL week compares false against every row, which would return an all-
  -- 0-0-0 table that looks like a valid pre-season order. Refuse it instead.
  if p_through_week is null or p_through_week < 0 then
    raise exception 'p_through_week must be >= 0' using errcode = '22023';
  end if;

  -- Per-member totals, derived from scored regular-season matchups through
  -- p_through_week. Each matchup contributes one row per side (see the header).
  with scored as (
    select m.team1_user_id, m.team2_user_id, m.team1_gain, m.team2_gain,
           m.winner_user_id, coalesce(m.is_tie, false) as is_tie
    from matchups m
    where m.league_id = p_league_id
      and m.week_number <= p_through_week
      and coalesce(m.is_playoff, false) = false
      and m.team1_gain is not null
  ),
  sides as (
    -- team1 side: every scored regular matchup, byes included (bye: no opponent,
    -- so no W/L/T and points_against 0).
    select sc.team1_user_id as user_id,
           sc.team1_gain    as gain_for,
           coalesce(sc.team2_gain, 0) as gain_against,
           (sc.team2_user_id is not null and sc.winner_user_id = sc.team1_user_id) as won,
           (sc.team2_user_id is not null and sc.winner_user_id = sc.team2_user_id) as lost,
           (sc.team2_user_id is not null and sc.is_tie)                            as tied
    from scored sc
    union all
    -- team2 side: non-bye matchups only.
    select sc.team2_user_id,
           coalesce(sc.team2_gain, 0),
           sc.team1_gain,
           (sc.winner_user_id = sc.team2_user_id),
           (sc.winner_user_id = sc.team1_user_id),
           sc.is_tie
    from scored sc
    where sc.team2_user_id is not null
  ),
  tally as (
    select sd.user_id,
           sum(case when sd.won  then 1 else 0 end)::numeric as wins,
           sum(case when sd.lost then 1 else 0 end)::numeric as losses,
           sum(case when sd.tied then 1 else 0 end)::numeric as ties,
           sum(sd.gain_for)::numeric                         as points_for,
           sum(sd.gain_against)::numeric                     as points_against
    from sides sd
    group by sd.user_id
  ),
  -- Roster = the league_standings member set, as the 1-arg function ranks it.
  -- Only the MEMBER LIST is read from the cumulative table; every number comes
  -- from matchups.
  roster as (
    select s.user_id, lm.joined_at
    from league_standings s
    left join league_members lm
      on lm.league_id = s.league_id and lm.user_id = s.user_id
    where s.league_id = p_league_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id',        r.user_id,
           'wins',           coalesce(t.wins, 0),
           'losses',         coalesce(t.losses, 0),
           'ties',           coalesce(t.ties, 0),
           'points_for',     coalesce(t.points_for, 0),
           'points_against', coalesce(t.points_against, 0),
           'joined_at',      r.joined_at
         )), '[]'::jsonb)
  into v_rows
  from roster r
  left join tally t on t.user_id = r.user_id;

  -- Counted head-to-head games: scored, regular-season, non-bye, through the week.
  select coalesce(jsonb_agg(jsonb_build_object(
           't1', m.team1_user_id,
           't2', m.team2_user_id,
           'w',  m.winner_user_id
         )), '[]'::jsonb)
  into v_games
  from matchups m
  where m.league_id = p_league_id
    and m.week_number <= p_through_week
    and coalesce(m.is_playoff, false) = false
    and m.team1_gain is not null
    and m.team2_user_id is not null;

  return query
  select c.user_id, c.rank, c.wins, c.losses, c.ties, c.win_points,
         c.win_pct, c.games_played, c.points_for, c.points_against, c.tiebreak
  from public._league_standings_rank_core(v_rows, v_games) c;
end;
$$;

revoke all on function public.league_standings_ranked(uuid, int) from public;
revoke all on function public.league_standings_ranked(uuid, int) from anon;
revoke all on function public.league_standings_ranked(uuid, int) from authenticated;
revoke all on function public.league_standings_ranked(uuid, int) from service_role;
grant execute on function public.league_standings_ranked(uuid, int) to authenticated;
grant execute on function public.league_standings_ranked(uuid, int) to service_role;
