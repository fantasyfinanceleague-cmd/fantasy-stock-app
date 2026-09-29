-- ============================================================================
-- league_standings_ranked: the ONE ranking every surface reads
-- ============================================================================
-- PROBLEM
--   Nine places ranked managers, in at least five different orders:
--     * mobile league.tsx standings: win% -> wins -> points_for (no H2H)
--     * get_home_summary (20261004000001): win% -> wins -> points_for -> user_id
--     * mobile useHomeData: .order('wins') only (arbitrary within a tie)
--     * process-week-results generatePlayoffs: wins -> pf, SLICED to the playoff
--       count, THEN a pairwise H2H sort. The slice ran before the tiebreak, so a
--       manager tied on wins at the cutoff could be cut before H2H was ever
--       consulted. The pairwise comparator is also non-transitive for 3+ tied
--       managers (A>B, B>C, C>A), so the seed order depended on the sort engine.
--     * process-week-results completeSeasonFromStandings: wins -> pf
--     * complete_league_season final_standings.rank: wins -> pf
--     * web Leaderboard / LeagueDetail / (dead) utils/tiebreaker.js
--   So two 5-1 managers could show 1st/2nd in standings and get the opposite
--   playoff seeds.
--
-- THE RULE (Giorgio, 2026-09-29; approved by the Orchestrator)
--   Standings order == seed order. Keys, in order:
--     1. win_points = wins + 0.5 * ties, desc. A tie counts as half a win (the
--        NFL / common-fantasy convention). Every member appears in every week of
--        the schedule, so games played are equal and this orders exactly like
--        win% while matching "wins decide". The key reads the RECORDED W/L/T
--        verbatim, so it stays correct if a bye is ever scored differently
--        (e.g. vs the week's median) than today's automatic win.
--     2. head-to-head, as a MINI-LEAGUE among the whole tied set:
--          * counted games: scored (team1_gain IS NOT NULL), regular-season,
--            NON-BYE (team2_user_id IS NOT NULL) matchups with BOTH managers in
--            the set. A drawn game (winner_user_id NULL) is half a win to each.
--          * applied ONLY if the set is BALANCED: every pair in the set has met
--            the same, non-zero number of times. Otherwise H2H is skipped for the
--            whole set (a manager who never faced the leader cannot "lose" H2H).
--          * if it separates the set, each still-tied subgroup of 2+ restarts at
--            this step with H2H recomputed among just that subgroup (so a
--            2-subgroup is decided by direct H2H). No separation -> step 3.
--     3. season gain (points_for, dollars) desc.
--     4. league_members.joined_at asc, then user_id asc. Stable, never random.
--        Not vanishingly rare: before week 1 is scored everyone is 0-0-0 at
--        $0.00, so this IS the pre-season order. A standings row with no member
--        row (a departed member) sorts after members, by user_id.
--   Ranks are strictly 1..N (no shared ranks) so a rank IS a seed.
--
--   `tiebreak` says which key placed a manager among the managers it was tied
--   with on win_points: NULL (not tied), 'h2h', 'season_gain' or 'join_order'.
--
-- SECURITY -- SECURITY INVOKER, and why that is safe here
--   Runs with the caller's rights, so RLS is the boundary: it reads
--   league_standings, matchups and league_members, whose SELECT policies are all
--   `is_member(league_id)` (league_members also `or user_id = auth.uid()`). Those
--   are LEAGUE-WIDE: a member sees every row of the league, a non-member sees no
--   standings and gets 0 rows back. There is no parameter to forge beyond the
--   league id, which RLS already gates.
--
--   PARTIAL-VISIBILITY ASSUMPTION (CLAUDE.md "verdict scope must match evidence
--   scope"): the ranking is only correct if the caller sees ALL of a league's
--   standings/matchups/members or NONE. If a future policy ever hides SOME rows
--   from a member (e.g. per-user matchup visibility), this function would
--   silently rank a subset and present it as the whole league. Any such policy
--   change must revisit this function (or switch it to DEFINER + membership
--   check). Pinned by the PGlite non-member test.
--
--   service_role (process-week-results) and the DEFINER callers
--   (get_home_summary, complete_league_season, both owned by postgres) bypass
--   RLS and see the whole league.
--
--   Grants: Supabase's default privileges put anon/authenticated/service_role
--   EXECUTE on every new function and REVOKE FROM PUBLIC does not clear them
--   (CLAUDE.md). Explicit revoke from all four, then grant to authenticated
--   (mobile/web clients) and service_role (process-week-results) only.
--
-- ---------------------------------------------------------------------------
-- POST-PUSH EFFECT CHECKS (run each separately):
--   -- 1. grants: expect authenticated=X and service_role=X (+ postgres) only;
--   --    no anon=, no bare =X (PUBLIC)
--   SELECT proname, proacl, prosecdef, proconfig FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND proname = 'league_standings_ranked';
--   -- 2. every matchup league returns one row per standings row, ranks 1..N
--   SELECT l.id, l.name, count(r.*) AS ranked,
--          (SELECT count(*) FROM league_standings s WHERE s.league_id = l.id) AS rows,
--          min(r.rank) AS min_rank, max(r.rank) AS max_rank
--   FROM leagues l CROSS JOIN LATERAL public.league_standings_ranked(l.id) r
--   WHERE l.league_type = 'matchup' GROUP BY l.id, l.name;
-- ============================================================================

create or replace function public.league_standings_ranked(p_league_id uuid)
returns table(
  user_id         text,
  rank            int,
  wins            numeric,
  losses          numeric,
  ties            numeric,
  win_points      numeric,
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
  -- Work queue of segments still to place, in final order. Each element is
  -- {"u": [user ids], "l": label-if-this-segment-is-a-singleton}.
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
  -- Seed the queue with win_points buckets, best first.
  select coalesce(jsonb_agg(jsonb_build_object('u', b.users, 'l', null) order by b.wp desc), '[]'::jsonb)
    into v_queue
  from (
    select s.wins + 0.5 * s.ties as wp, jsonb_agg(s.user_id order by s.user_id) as users
    from league_standings s
    where s.league_id = p_league_id
    group by s.wins + 0.5 * s.ties
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
      select least(m.team1_user_id, m.team2_user_id) a,
             greatest(m.team1_user_id, m.team2_user_id) b,
             count(*)::int c
      from matchups m
      where m.league_id = p_league_id
        and coalesce(m.is_playoff, false) = false
        and m.team1_gain is not null
        and m.team2_user_id is not null
        and m.team1_user_id = any(v_set)
        and m.team2_user_id = any(v_set)
      group by 1, 2
    ) p;

    v_parts := null;
    if v_pairs = v_n * (v_n - 1) / 2 and v_min = v_max then
      -- Split by mini-league score, best first. Only used if it separates.
      select jsonb_agg(jsonb_build_object('u', g.users, 'l', 'h2h') order by g.score desc)
        into v_parts
      from (
        select sc.score, jsonb_agg(sc.u order by sc.u) as users
        from (
          select u.u,
                 coalesce(sum(case when m.winner_user_id = u.u then 1.0
                                   when m.winner_user_id is null then 0.5
                                   else 0 end), 0) as score
          from unnest(v_set) as u(u)
          left join matchups m
            on m.league_id = p_league_id
           and coalesce(m.is_playoff, false) = false
           and m.team1_gain is not null
           and m.team2_user_id is not null
           and m.team1_user_id = any(v_set)
           and m.team2_user_id = any(v_set)
           and u.u in (m.team1_user_id, m.team2_user_id)
          group by u.u
        ) sc
        group by sc.score
      ) g;
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
      from league_standings s
      left join league_members lm
        on lm.league_id = s.league_id and lm.user_id = s.user_id
      where s.league_id = p_league_id
        and s.user_id = any(v_set)
      order by s.points_for desc,
               lm.joined_at asc nulls last,
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
         s.wins + s.losses + s.ties,
         s.points_for, s.points_against,
         v_labels[o.ord]
  from unnest(v_order) with ordinality as o(uid, ord)
  join league_standings s
    on s.league_id = p_league_id and s.user_id = o.uid
  order by o.ord;
end;
$$;

revoke all on function public.league_standings_ranked(uuid) from public;
revoke all on function public.league_standings_ranked(uuid) from anon;
revoke all on function public.league_standings_ranked(uuid) from authenticated;
revoke all on function public.league_standings_ranked(uuid) from service_role;
grant execute on function public.league_standings_ranked(uuid) to authenticated;
grant execute on function public.league_standings_ranked(uuid) to service_role;
