-- ============================================================================
-- HOME SUMMARY + DISPLAY NAMES EFFECT TEST — run in the Supabase SQL editor
-- AFTER `db push` of 20261004000000_participant_display_names.sql and
-- 20261004000001_get_home_summary_rpc.sql. Read-only in effect: NOTHING
-- persists. Same shape as docs/security/join-mid-draft-effect-test.sql and
-- f10-policy-drop-effect-test.sql (savepointed cases inside one DO block,
-- ending in a RAISE that rolls back the whole fixture).
--
-- WHY THIS SHAPE, and one addition over the prior tests:
--   * Both functions are SECURITY DEFINER, so the thing worth exercising is
--     (a) each function's own naming/refusal logic and (b) that the
--     GRANT/REVOKE on the functions is enforced AT CALL TIME (cases D, G, H),
--     not merely visible in pg_proc.proacl.
--   * NEW vs. prior tests: this fixture needs REAL auth.users rows, because
--     user_profiles.id references auth.users(id) ON DELETE CASCADE and case A
--     exercises the username path. If prod has an auth.users trigger that
--     auto-creates a user_profiles row (none exists in supabase/migrations/
--     today, but this is defensive), the profile INSERT below uses
--     `ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username` so the
--     test passes whether or not such a trigger exists. Everything —
--     auth.users, user_profiles, leagues, members, standings, matchups,
--     trades — rolls back on the final RAISE regardless.
--   * num_participants=5 for league L (5 fixture members) and =4 for L2/L3,
--     both inside the CHECK (between 4 and 16, 20250819185319).
--
-- EXPECTED OUTPUT (the final "ERROR:" text):
--   A  member sees every name        -> username, Player XXXX, 2 distinct bot names, Test User 2,
--                                        AND a trades-only (no member/standings/matchup/draft row)
--                                        participant, proving the trades UNION arm actually fires   PASS
--   B  home summary as M             -> L: bot oppo name, team1_gain NULL; L2: both gains set       PASS
--   C  non-member refused/excluded   -> 42501 on names; home summary omits L/L2 for O               PASS
--   D  anon refused                  -> 42501 on both RPCs                                          PASS
--   E  bot ids -> curated names      -> bot-1 != bot-1-1, both from the curated list                PASS
--   F  caller identity from JWT only -> no-arg call errors 42883; switching sub changes result;
--                                        no-sub authenticated call -> 42501                          PASS
--   G  no profile-oracle grant       -> participant_display_name refused for anon AND authenticated PASS
--   H  proacl/has_function_privilege -> anon=false/authenticated=true/service_role=false on both
--                                        RPCs; all three false on the helper                        PASS
-- Any FAIL line is a real finding: stop and report it.
-- ============================================================================
do $$
declare
  m_uid   uuid := gen_random_uuid();  -- real user, has a username
  p_uid   uuid := gen_random_uuid();  -- real user, NO username (blank)
  o_uid   uuid := gen_random_uuid();  -- outsider, not a member of L/L2
  q_uid   uuid := gen_random_uuid();  -- trade-only participant: NO league_members/
                                       -- standings/matchups/drafts row, exists only via
                                       -- `trades` (exercises that UNION arm specifically)
  l_id    uuid;  -- league L: matchup, unscored week-1 matchup vs bot-1
  l2_id   uuid;  -- league L2: matchup, SCORED week-1 matchup, M vs P
  l3_id   uuid;  -- league L3: O's own league, unrelated to L/L2
  mu_id   uuid;  -- L's week-1 matchup (M vs bot-1)
  res     jsonb;
  rec     record;
  name_m       text; name_p text; name_bot1 text; name_bot1_1 text; name_tu2 text; name_q text;
  is_bot_bot1  boolean;
  n            int;
  rank_m       int; rank_p int;
  out          text := E'\n';

begin
  -- ---- fixture: real auth users + profiles (as the editor's own role) -----
  insert into auth.users (id, email, created_at, updated_at, aud, role, instance_id)
  values
    (m_uid, 'fixture-m-' || m_uid || '@example.invalid', now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (p_uid, 'fixture-p-' || p_uid || '@example.invalid', now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (o_uid, 'fixture-o-' || o_uid || '@example.invalid', now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (q_uid, 'fixture-q-' || q_uid || '@example.invalid', now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

  insert into public.user_profiles (id, username) values (m_uid, 'hstest_m')
    on conflict (id) do update set username = excluded.username;
  insert into public.user_profiles (id, username) values (p_uid, null)
    on conflict (id) do update set username = excluded.username;
  insert into public.user_profiles (id, username) values (q_uid, 'hstest_q')
    on conflict (id) do update set username = excluded.username;
  -- o_uid deliberately gets no profile row at all (tests the no-row branch
  -- of participant_display_name is unreachable for O since O never appears
  -- as a participant in L/L2 — only used as the outsider caller in case C).

  -- ---- league L: matchup type, 5 members, unscored week-1 matchup --------
  insert into public.leagues (name, commissioner_id, invite_code, num_participants, league_type,
                               draft_status, current_week, num_weeks, season_status)
  values ('__HSDN_L__', m_uid::text, 'HSDN-L-' || substr(gen_random_uuid()::text, 1, 8),
          5, 'matchup', 'completed', 1, 1, 'active')
  returning id into l_id;

  insert into public.league_members (league_id, user_id, role) values
    (l_id, m_uid::text, 'commissioner'),
    (l_id, p_uid::text, 'member'),
    (l_id, 'bot-1', 'member'),
    (l_id, 'bot-1-1', 'member'),
    (l_id, 'test-user-2', 'member');

  insert into public.league_standings (league_id, user_id, wins, losses, ties, points_for) values
    (l_id, m_uid::text, 1, 0, 0, 100),
    (l_id, p_uid::text, 0, 1, 0, 50),
    (l_id, 'bot-1', 0, 0, 0, 0),
    (l_id, 'bot-1-1', 0, 0, 0, 10),
    (l_id, 'test-user-2', 0, 0, 0, 5);

  insert into public.matchups (league_id, week_number, team1_user_id, team2_user_id, week_start, week_end)
  values (l_id, 1, m_uid::text, 'bot-1', now() - interval '2 days', now() + interval '2 days')
  returning id into mu_id;

  -- q_uid: a `trades`-only participant of L — deliberately NO league_members,
  -- league_standings, matchups, or drafts row. Exercises the trades UNION arm
  -- added after supabase-reviewer flagged the participant set as an
  -- undocumented subset claim; without this row the trades branch would be
  -- untested code, not a verified one.
  insert into public.trades (league_id, user_id, symbol, action, quantity, price, total_value)
  values (l_id, q_uid, 'AAPL', 'buy', 1, 100.00, 100.00);

  -- ---- league L2: matchup type, SCORED week-1 matchup, M vs P ------------
  insert into public.leagues (name, commissioner_id, invite_code, num_participants, league_type,
                               draft_status, current_week, num_weeks, season_status)
  values ('__HSDN_L2__', m_uid::text, 'HSDN-L2-' || substr(gen_random_uuid()::text, 1, 8),
          4, 'matchup', 'completed', 1, 1, 'active')
  returning id into l2_id;

  insert into public.league_members (league_id, user_id, role) values
    (l2_id, m_uid::text, 'commissioner'),
    (l2_id, p_uid::text, 'member');

  insert into public.matchups (league_id, week_number, team1_user_id, team2_user_id,
                                team1_gain, team2_gain, winner_user_id, week_start, week_end)
  values (l2_id, 1, m_uid::text, p_uid::text, 15.50, -3.25, m_uid::text,
          now() - interval '2 days', now() + interval '2 days');

  -- ---- league L3: outsider O's own, unrelated league ---------------------
  insert into public.leagues (name, commissioner_id, invite_code, num_participants, league_type,
                               draft_status, current_week, season_status)
  values ('__HSDN_L3__', o_uid::text, 'HSDN-L3-' || substr(gen_random_uuid()::text, 1, 8),
          4, 'duration', 'not_started', 1, 'active')
  returning id into l3_id;
  insert into public.league_members (league_id, user_id, role) values (l3_id, o_uid::text, 'commissioner');

  -- ---- become authenticated as M (a real client, publishable-key shape) --
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', m_uid::text, 'role', 'authenticated')::text, true);

  -- A: member M gets every name.
  begin
    select display_name into name_m      from public.get_league_display_names(l_id) where user_id = m_uid::text;
    select display_name into name_p      from public.get_league_display_names(l_id) where user_id = p_uid::text;
    select display_name, is_bot into name_bot1, is_bot_bot1 from public.get_league_display_names(l_id) where user_id = 'bot-1';
    select display_name into name_bot1_1 from public.get_league_display_names(l_id) where user_id = 'bot-1-1';
    select display_name into name_tu2    from public.get_league_display_names(l_id) where user_id = 'test-user-2';
    -- q_uid has NO league_members/standings/matchups/drafts row — only a
    -- trades row — so its presence here specifically proves the trades UNION
    -- arm, not just that "some" branch found it.
    select display_name into name_q      from public.get_league_display_names(l_id) where user_id = q_uid::text;
    out := out || format(E'A  names: m=%s p=%s bot1=%s bot1-1=%s tu2=%s q(trades-only)=%s bot1_is_bot=%s  %s\n',
      name_m, name_p, name_bot1, name_bot1_1, name_tu2, name_q, is_bot_bot1,
      case when name_m = 'hstest_m'
             and name_p = 'Player ' || upper(left(p_uid::text, 4))
             and name_bot1 = 'Ticker Tina'
             and name_bot1_1 = 'Ticker Tina 2'
             and name_tu2 = 'Test User 2'
             and name_q = 'hstest_q'
             and is_bot_bot1 = true
           then 'PASS' else 'FAIL' end);
  exception when others then
    out := out || format(E'A  names                -> FAIL (%s %s)\n', sqlstate, sqlerrm);
  end;

  -- B: get_home_summary as M — L shows the bot opponent name with
  --    team1_gain IS NULL (not scored); L2 shows both gains populated.
  begin
    select team1_gain, team2_display_name, team2_is_bot
      into rec from public.get_home_summary() where league_id = l_id;
    out := out || format(E'B1 home L (unscored)   -> gain=%s oppo=%s is_bot=%s  %s\n',
      rec.team1_gain, rec.team2_display_name, rec.team2_is_bot,
      case when rec.team1_gain is null and rec.team2_display_name = 'Ticker Tina' and rec.team2_is_bot = true
           then 'PASS' else 'FAIL' end);

    select team1_gain, team2_gain into rec from public.get_home_summary() where league_id = l2_id;
    out := out || format(E'B2 home L2 (scored)    -> t1=%s t2=%s  %s\n', rec.team1_gain, rec.team2_gain,
      case when rec.team1_gain = 15.50 and rec.team2_gain = -3.25 then 'PASS' else 'FAIL' end);
  exception when others then
    out := out || format(E'B  home summary        -> FAIL (%s %s)\n', sqlstate, sqlerrm);
  end;

  -- ---- become authenticated as outsider O --------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', o_uid::text, 'role', 'authenticated')::text, true);

  -- C: non-member O is refused on names, and home summary omits L/L2 for O.
  begin
    perform public.get_league_display_names(l_id);
    out := out || E'C1 non-member names    -> FAIL (should have been refused)\n';
  exception when others then
    out := out || format(E'C1 non-member names    -> %s %s\n', sqlstate,
      case when sqlstate = '42501' then 'PASS' else 'FAIL (' || sqlerrm || ')' end);
  end;

  begin
    select count(*) into n from public.get_home_summary() where league_id in (l_id, l2_id);
    out := out || format(E'C2 home excludes L/L2  -> rows=%s  %s\n', n, case when n = 0 then 'PASS' else 'FAIL' end);
  exception when others then
    out := out || format(E'C2 home excludes L/L2  -> FAIL (%s %s)\n', sqlstate, sqlerrm);
  end;

  -- ---- become anon --------------------------------------------------------
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

  -- D: anon refused on both RPCs.
  begin
    perform public.get_league_display_names(l_id);
    out := out || E'D1 anon names          -> FAIL (should have been refused)\n';
  exception when others then
    out := out || format(E'D1 anon names          -> %s %s\n', sqlstate,
      case when sqlstate in ('42501', '42883') then 'PASS' else 'FAIL (' || sqlerrm || ')' end);
  end;

  begin
    perform public.get_home_summary();
    out := out || E'D2 anon home summary   -> FAIL (should have been refused)\n';
  exception when others then
    out := out || format(E'D2 anon home summary   -> %s %s\n', sqlstate,
      case when sqlstate in ('42501', '42883') then 'PASS' else 'FAIL (' || sqlerrm || ')' end);
  end;

  -- E: bot ids resolve to distinct curated names (re-asserts A's bot pair
  --    explicitly, per the contract's own case list).
  out := out || format(E'E  bot names distinct  -> bot1=%s bot1-1=%s  %s\n', name_bot1, name_bot1_1,
    case when name_bot1 is not null and name_bot1_1 is not null and name_bot1 <> name_bot1_1
         then 'PASS' else 'FAIL' end);

  -- ---- back to authenticated: F, forgery + identity-from-JWT-only --------
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', m_uid::text, 'role', 'authenticated')::text, true);

  -- F1: no-arg function can't be called with a forged user id argument.
  begin
    execute 'select * from public.get_home_summary($1)' using m_uid::text;
    out := out || E'F1 forged-arg call     -> FAIL (should not have a matching signature)\n';
  exception when others then
    out := out || format(E'F1 forged-arg call     -> %s %s\n', sqlstate,
      case when sqlstate = '42883' then 'PASS' else 'FAIL (' || sqlerrm || ')' end);
  end;

  -- F2: identity comes from the JWT, not a parameter — switching sub changes
  --     the caller's own rank in the SAME league (M=1st, P=2nd by design).
  begin
    select standings_rank into rank_m from public.get_home_summary() where league_id = l_id;
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
    select standings_rank into rank_p from public.get_home_summary() where league_id = l_id;
    out := out || format(E'F2 identity from JWT   -> rank_m=%s rank_p=%s  %s\n', rank_m, rank_p,
      case when rank_m = 1 and rank_p = 2 and rank_m <> rank_p then 'PASS' else 'FAIL' end);
  exception when others then
    out := out || format(E'F2 identity from JWT   -> FAIL (%s %s)\n', sqlstate, sqlerrm);
  end;

  -- F3: authenticated role, but no `sub` claim at all -> refused, not a
  --     silent NULL-caller result.
  begin
    perform set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
    perform public.get_home_summary();
    out := out || E'F3 authenticated no sub -> FAIL (should have been refused)\n';
  exception when others then
    out := out || format(E'F3 authenticated no sub -> %s %s\n', sqlstate,
      case when sqlstate = '42501' then 'PASS' else 'FAIL (' || sqlerrm || ')' end);
  end;

  -- G: the internal helper is not a profile oracle — refused for both
  --    authenticated and anon, exactly like any other unauthorized function.
  perform set_config('request.jwt.claims', json_build_object('sub', m_uid::text, 'role', 'authenticated')::text, true);
  begin
    perform public.participant_display_name(p_uid::text);
    out := out || E'G1 authenticated helper -> FAIL (should have been refused)\n';
  exception when others then
    out := out || format(E'G1 authenticated helper -> %s %s\n', sqlstate,
      case when sqlstate = '42501' then 'PASS' else 'FAIL (' || sqlerrm || ')' end);
  end;

  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  begin
    perform public.participant_display_name(p_uid::text);
    out := out || E'G2 anon helper          -> FAIL (should have been refused)\n';
  exception when others then
    out := out || format(E'G2 anon helper          -> %s %s\n', sqlstate,
      case when sqlstate = '42501' then 'PASS' else 'FAIL (' || sqlerrm || ')' end);
  end;

  -- H: static grant check — belt-and-suspenders alongside the migration's
  --    own proacl HUMAN ACTION query. Includes service_role: Supabase's
  --    default-privilege grants cover it too (CLAUDE.md), and a "granted to
  --    nobody" claim that only checked anon/authenticated would be a
  --    verdict-scope mismatch against its own evidence (the exact defect
  --    flagged in security review and fixed in the migration — see its
  --    header). service_role is expected FALSE on all three: the two entry
  --    points reach the helper via definer-owner privilege, not a grant, and
  --    nothing calls any of the three via service_role.
  out := out || format(
    E'H  grants -> home(anon=%s,auth=%s,svc=%s) names(anon=%s,auth=%s,svc=%s) helper(anon=%s,auth=%s,svc=%s)  %s\n',
    has_function_privilege('anon', 'public.get_home_summary()', 'execute'),
    has_function_privilege('authenticated', 'public.get_home_summary()', 'execute'),
    has_function_privilege('service_role', 'public.get_home_summary()', 'execute'),
    has_function_privilege('anon', 'public.get_league_display_names(uuid)', 'execute'),
    has_function_privilege('authenticated', 'public.get_league_display_names(uuid)', 'execute'),
    has_function_privilege('service_role', 'public.get_league_display_names(uuid)', 'execute'),
    has_function_privilege('anon', 'public.participant_display_name(text)', 'execute'),
    has_function_privilege('authenticated', 'public.participant_display_name(text)', 'execute'),
    has_function_privilege('service_role', 'public.participant_display_name(text)', 'execute'),
    case when has_function_privilege('anon', 'public.get_home_summary()', 'execute') = false
           and has_function_privilege('authenticated', 'public.get_home_summary()', 'execute') = true
           and has_function_privilege('service_role', 'public.get_home_summary()', 'execute') = false
           and has_function_privilege('anon', 'public.get_league_display_names(uuid)', 'execute') = false
           and has_function_privilege('authenticated', 'public.get_league_display_names(uuid)', 'execute') = true
           and has_function_privilege('service_role', 'public.get_league_display_names(uuid)', 'execute') = false
           and has_function_privilege('anon', 'public.participant_display_name(text)', 'execute') = false
           and has_function_privilege('authenticated', 'public.participant_display_name(text)', 'execute') = false
           and has_function_privilege('service_role', 'public.participant_display_name(text)', 'execute') = false
         then 'PASS' else 'FAIL' end);

  -- Deliberate: rolls back the fixture (auth.users, user_profiles, leagues,
  -- members, standings, matchups, trades) and every write above, and
  -- displays `out`.
  raise exception 'HOME SUMMARY + DISPLAY NAMES EFFECT TEST RESULTS (all rolled back):%', out;
end;
$$;
