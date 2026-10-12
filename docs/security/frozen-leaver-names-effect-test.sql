-- ============================================================================
-- FROZEN LEAVER NAMES EFFECT TEST: run in the Supabase SQL editor AFTER
-- `db push` of 20261119000000 + 20261119000001.
-- Read-only in effect: NOTHING persists (the block ends by RAISING, which rolls
-- back every fixture, auth.users rows included).
-- ============================================================================
-- Giorgio, 2026-10-11, board #call-leaver-names, "A with frozen names": a
-- manager who left stays named in the seasons they played with you, frozen as
-- they were when they left; a later rename or avatar change must not reach
-- their former leaguemates.
--
-- Same shape as leave-league-effect-test.sql:
--   * The editor shows only the last statement's output, so every case records
--     a line and the block ends with RAISE. The FIRST line of the message is the
--     verdict: 'FROZEN LEAVER NAMES EFFECT TEST: PASS ...' or '... FAIL ...'.
--   * Role/claims switch with set_config(..., true), the way PostgREST does, so
--     auth.uid() and EXECUTE grants behave as for a real call. Switches happen
--     OUTSIDE the per-case begin/exception blocks.
--   * Fixtures set league_members.role and leagues.league_type EXPLICITLY
--     (prod has no role default; league_type defaults to 'duration').
--   * The fixture league is inserted not_started and then completed, as the
--     leave-league effect test does (the draft-status triggers expect that).
--   * Users are real auth.users rows (user_profiles.id references them); the
--     profile is upserted, so this works whether or not the signup trigger made
--     the row.
--   * supabase/tests/frozen_leaver_names.pglite.test.ts runs THIS file on real
--     Postgres and requires the PASS verdict.
--
-- Cast: A = the viewer. B leaves L1 after the season, then renames and changes
-- avatar. N has NO username and leaves L1 too. L1 is a completed matchup league
-- (A, B, N, bot-1) whose champion is B. L2 is a later league where B is a
-- CURRENT member with A.
--
-- EXPECTED OUTPUT: the verdict line, then every line ends in PASS.
--   G1  frozen columns + trigger present                                  PASS
--   G2  freeze fn + resolver: definer, path pinned, NO API grant           PASS
--   G3  get_visible_profiles: authenticated only, has the frozen branch    PASS
--   G4  six callers switched to the resolver, authenticated only          PASS
--   G5  backfill: no hidden row without a snapshot                        PASS
--   S1  hiding snapshots the CURRENT profile                              PASS
--   S2  unrelated updates and forged frozen writes change nothing         PASS
--   V1  A, get_visible_profiles: B's OLD name + avatar; N's null name     PASS
--   V2  A, get_league_display_names(L1): B old; N = Player XXXX           PASS
--   V3  A, get_league_history(L1): champion + standings show B old        PASS
--   V4  A, get_season_matchups(L1): B old in every slot                   PASS
--   V5  A, get_season_result(L1): complete, champion B old                PASS
--   V6  A, get_home_summary: L1's matchup names B old                     PASS
--   L1  B is a CURRENT member of L2 with A: live name there and by id;
--       still frozen in L1                                               PASS
--   U1  unhide clears the snapshot: L1 shows the live name                PASS
--   N1  authenticated/anon cannot execute the resolver or the trigger fn  PASS
-- Any FAIL line is a real finding: stop and report it.
-- ============================================================================
do $$
declare
  sfx    text := substr(md5(random()::text), 1, 10);
  a_uid  uuid := gen_random_uuid();
  b_uid  uuid := gen_random_uuid();
  n_uid  uuid := gen_random_uuid();
  b_old  text := 'fxb_' || sfx;
  b_new  text := 'fxr_' || sfx;
  l1     uuid;
  l2     uuid;
  s1     uuid;
  acl    text;
  got    text;
  got2   text;
  n      int;
  out    text := '';
begin
  -- ---- G: catalog -------------------------------------------------------------
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'league_members'
     and column_name in ('frozen_username', 'frozen_avatar', 'frozen_at', 'hidden_at');
  out := out || format(E'G1 frozen cols %s/4, trigger %s  %s\n', n,
    (select count(*) from pg_trigger where tgname = 'trg_league_members_freeze_leaver' and tgenabled = 'O'),
    case when n = 4 and exists (select 1 from pg_trigger
           where tgname = 'trg_league_members_freeze_leaver' and tgenabled = 'O') then 'PASS' else 'FAIL' end);

  select string_agg(proname || '=' || coalesce(proacl::text, 'NULL'), ' ') into acl
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and proname in ('league_members_freeze_leaver', 'league_participant_display_name')
     and (not prosecdef or coalesce(proconfig::text, '') !~ 'search_path=public, pg_temp'
          or coalesce(proacl::text, '') ~ '(anon|authenticated|service_role)=' or coalesce(proacl::text, '{=X}') ~ '(^|[{,])=X');
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and proname in ('league_members_freeze_leaver', 'league_participant_display_name');
  out := out || format(E'G2 freeze fn + resolver (%s fns) %s  %s\n', n, coalesce(acl, 'ok'),
    case when n = 2 and acl is null then 'PASS' else 'FAIL' end);

  select proacl::text || case when prosrc ~ 'frozen_username' then ' frozen-branch' else ' NO-FROZEN' end into acl
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and proname = 'get_visible_profiles';
  out := out || format(E'G3 get_visible_profiles %s  %s\n', acl,
    case when acl ~ 'authenticated=X' and acl !~ '(anon|service_role)=' and acl !~ '(^|[{,])=X'
          and acl ~ 'frozen-branch' then 'PASS' else 'FAIL' end);

  select string_agg(proname || ':' || coalesce(proacl::text, 'NULL'), ' ') into acl
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public'
     and proname in ('get_league_display_names', 'get_home_summary', 'get_season_result',
                     'get_renewal_roster', 'get_league_history', 'get_season_matchups')
     and (prosrc !~ 'league_participant_display_name' or prosrc ~ '[^_]participant_display_name\('
          or coalesce(proacl::text, '') !~ 'authenticated=X' or coalesce(proacl::text, '') ~ '(anon|service_role)=');
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public'
     and proname in ('get_league_display_names', 'get_home_summary', 'get_season_result',
                     'get_renewal_roster', 'get_league_history', 'get_season_matchups');
  out := out || format(E'G4 callers switched (%s/6) %s  %s\n', n, coalesce(acl, 'ok'),
    case when n = 6 and acl is null then 'PASS' else 'FAIL' end);

  select count(*) into n from public.league_members where hidden_at is not null and frozen_at is null;
  out := out || format(E'G5 hidden rows without a snapshot = %s  %s\n', n, case when n = 0 then 'PASS' else 'FAIL' end);

  -- ---- fixture (the editor's own role) ---------------------------------------
  insert into auth.users (id, email, created_at, updated_at, aud, role, instance_id)
  values
    (a_uid, 'fixture-a-' || a_uid || '@frozen-leaver-test.invalid', now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (b_uid, 'fixture-b-' || b_uid || '@frozen-leaver-test.invalid', now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (n_uid, 'fixture-n-' || n_uid || '@frozen-leaver-test.invalid', now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  insert into public.user_profiles (id, username, avatar) values
    (a_uid, 'fxa_' || sfx, 'A1'), (b_uid, b_old, 'B1'), (n_uid, null, 'N1')
    on conflict (id) do update set username = excluded.username, avatar = excluded.avatar;

  insert into public.leagues (name, commissioner_id, invite_code, num_participants, draft_status, draft_date,
                              playoff_teams, league_type, num_weeks, current_week)
  values ('__FROZEN_L1__', a_uid::text, 'FZ-' || gen_random_uuid(), 4, 'not_started', now() + interval '5 hours',
          2, 'matchup', 1, 2)
  returning id into l1;
  insert into public.league_members (league_id, user_id, role) values
    (l1, a_uid::text, 'commissioner'), (l1, b_uid::text, 'member'),
    (l1, n_uid::text, 'member'), (l1, 'bot-1', 'member');
  update public.leagues set draft_status = 'completed', draft_started_at = now() where id = l1;
  -- A consistent finished season: week 1 (A 10 vs B 20, N 5 vs bot 7) and a
  -- two-team playoff final B over A, so get_season_result reads 'complete'.
  insert into public.matchups (league_id, week_number, team1_user_id, team2_user_id, team1_gain, team2_gain,
                               winner_user_id, week_start, week_end, is_playoff, playoff_round_number, bracket_position)
  values
    (l1, 1, a_uid::text, b_uid::text, 10, 20, b_uid::text, now() - interval '14 days', now() - interval '7 days', false, null, null),
    (l1, 1, n_uid::text, 'bot-1',     5,  7,  'bot-1',     now() - interval '14 days', now() - interval '7 days', false, null, null),
    (l1, 2, b_uid::text, a_uid::text, 30, 15, b_uid::text, now() - interval '7 days',  now() - interval '1 day',  true,  1,    0);
  insert into public.league_standings (league_id, user_id, wins, losses, ties, points_for) values
    (l1, b_uid::text, 1, 0, 0, 20), (l1, a_uid::text, 0, 1, 0, 10),
    (l1, 'bot-1', 1, 0, 0, 7), (l1, n_uid::text, 0, 1, 0, 5);
  insert into public.league_seasons (league_id, season_number, completed_at, champion_user_id, runner_up_user_id, final_standings)
  values (l1, 1, now(), b_uid::text, a_uid::text, jsonb_build_array(
    jsonb_build_object('user_id', b_uid::text, 'rank', 1, 'wins', 1, 'losses', 0, 'ties', 0, 'points_for', 20),
    jsonb_build_object('user_id', a_uid::text, 'rank', 2, 'wins', 0, 'losses', 1, 'ties', 0, 'points_for', 10),
    jsonb_build_object('user_id', 'bot-1',     'rank', 3, 'wins', 1, 'losses', 0, 'ties', 0, 'points_for', 7),
    jsonb_build_object('user_id', n_uid::text, 'rank', 4, 'wins', 0, 'losses', 1, 'ties', 0, 'points_for', 5)))
  returning id into s1;
  update public.leagues set season_status = 'completed', current_season_id = s1 where id = l1;

  -- B and N leave after the season: leave_league's own statement.
  update public.league_members set hidden_at = now()
   where league_id = l1 and user_id in (b_uid::text, n_uid::text) and hidden_at is null;

  select frozen_username || '/' || frozen_avatar into got
    from public.league_members where league_id = l1 and user_id = b_uid::text;
  select coalesce(frozen_username, '<null>') || '/' || frozen_avatar || '/' || (frozen_at is not null) into got2
    from public.league_members where league_id = l1 and user_id = n_uid::text;
  out := out || format(E'S1 snapshot B=%s N=%s  %s\n', got, got2,
    case when got = b_old || '/B1' and got2 = '<null>/N1/true' then 'PASS' else 'FAIL' end);

  -- B renames and changes avatar AFTER leaving.
  update public.user_profiles set username = b_new, avatar = 'B2' where id = b_uid;

  -- Unrelated updates do not re-snapshot; a direct write of the frozen columns is ignored.
  update public.league_members set role = 'member' where league_id = l1 and user_id = b_uid::text;
  update public.league_members set hidden_at = hidden_at + interval '1 second' where league_id = l1 and user_id = b_uid::text;
  update public.league_members set frozen_username = 'forged', frozen_avatar = 'X' where league_id = l1 and user_id = b_uid::text;
  select frozen_username || '/' || frozen_avatar into got
    from public.league_members where league_id = l1 and user_id = b_uid::text;
  out := out || format(E'S2 after role/hidden_at/forged writes B=%s  %s\n', got,
    case when got = b_old || '/B1' then 'PASS' else 'FAIL' end);

  -- ---- as A ---------------------------------------------------------------------
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', a_uid, 'role', 'authenticated')::text, true);

  begin
    select string_agg(coalesce(v.username, '<null>') || '/' || coalesce(v.avatar, '<null>'), ',' order by v.id = b_uid desc)
      into got from public.get_visible_profiles(array[b_uid::text, n_uid::text]) v;
    out := out || format(E'V1 get_visible_profiles B,N = %s  %s\n', got,
      case when got = b_old || '/B1,<null>/N1' then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'V1 get_visible_profiles -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;

  begin
    select max(display_name) filter (where user_id = b_uid::text),
           max(display_name) filter (where user_id = n_uid::text)
      into got, got2 from public.get_league_display_names(l1);
    out := out || format(E'V2 get_league_display_names(L1) B=%s N=%s  %s\n', got, got2,
      case when got = b_old and got2 = 'Player ' || upper(left(n_uid::text, 4)) then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'V2 get_league_display_names -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;

  begin
    select h.champion_display_name,
           (select e->>'display_name' from jsonb_array_elements(h.final_standings) e where e->>'user_id' = b_uid::text)
      into got, got2 from public.get_league_history(l1) h where h.league_id = l1;
    out := out || format(E'V3 get_league_history(L1) champion=%s standings=%s  %s\n', got, got2,
      case when got = b_old and got2 = b_old then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'V3 get_league_history -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;

  begin
    select string_agg(distinct case when m.team1_user_id = b_uid::text then m.team1_display_name
                                    else m.team2_display_name end, ','),
           count(*)::text
      into got, got2 from public.get_season_matchups(l1) m
     where b_uid::text in (m.team1_user_id, m.team2_user_id);
    out := out || format(E'V4 get_season_matchups(L1) B=%s in %s rows  %s\n', got, got2,
      case when got = b_old and got2 = '2' then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'V4 get_season_matchups -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;

  begin
    select r.status || '/' || coalesce(r.reason, '-'), r.champion_display_name
      into got, got2 from public.get_season_result(l1) r;
    out := out || format(E'V5 get_season_result(L1) %s champion=%s  %s\n', got, got2,
      case when got = 'complete/-' and got2 = b_old then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'V5 get_season_result -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;

  begin
    select case when h.team1_user_id = b_uid::text then h.team1_display_name else h.team2_display_name end
      into got from public.get_home_summary() h where h.league_id = l1;
    out := out || format(E'V6 get_home_summary L1 opponent=%s  %s\n', got,
      case when got = b_old then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'V6 get_home_summary -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;

  -- ---- L2: B is a CURRENT member with A (the editor's role again) -------------
  reset role;
  perform set_config('request.jwt.claims', '', true);
  insert into public.leagues (name, commissioner_id, invite_code, num_participants, draft_status, draft_date,
                              playoff_teams, league_type)
  values ('__FROZEN_L2__', a_uid::text, 'FZ-' || gen_random_uuid(), 4, 'not_started', now() + interval '5 hours', 2, 'matchup')
  returning id into l2;
  insert into public.league_members (league_id, user_id, role) values
    (l2, a_uid::text, 'commissioner'), (l2, b_uid::text, 'member');

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', a_uid, 'role', 'authenticated')::text, true);
  begin
    select v.username || '/' || v.avatar into got from public.get_visible_profiles(array[b_uid::text]) v;
    select display_name into got2 from public.get_league_display_names(l2) where user_id = b_uid::text;
    select got2 || ' L1=' || display_name into got2 from public.get_league_display_names(l1) where user_id = b_uid::text;
    out := out || format(E'L1 shared live league: by id=%s L2=%s  %s\n', got, got2,
      case when got = b_new || '/B2' and got2 = b_new || ' L1=' || b_old then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'L1 shared live league -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;

  -- ---- unhide (unhide_league's own statement) -----------------------------------
  reset role;
  perform set_config('request.jwt.claims', '', true);
  update public.league_members set hidden_at = null
   where league_id = l1 and user_id = b_uid::text and hidden_at is not null;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', a_uid, 'role', 'authenticated')::text, true);
  begin
    select display_name into got from public.get_league_display_names(l1) where user_id = b_uid::text;
    select coalesce(frozen_username, '<null>') || '/' || coalesce(frozen_at::text, '<null>') into got2
      from public.league_members where league_id = l1 and user_id = b_uid::text;
    out := out || format(E'U1 unhidden: L1 name=%s frozen=%s  %s\n', got, got2,
      case when got = b_new and got2 = '<null>/<null>' then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'U1 unhide -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;

  reset role;
  perform set_config('request.jwt.claims', '', true);
  out := out || format(E'N1 resolver exec auth=%s anon=%s; freeze fn exec auth=%s anon=%s  %s\n',
    has_function_privilege('authenticated', 'public.league_participant_display_name(uuid, text)', 'execute'),
    has_function_privilege('anon', 'public.league_participant_display_name(uuid, text)', 'execute'),
    has_function_privilege('authenticated', 'public.league_members_freeze_leaver()', 'execute'),
    has_function_privilege('anon', 'public.league_members_freeze_leaver()', 'execute'),
    case when not has_function_privilege('authenticated', 'public.league_participant_display_name(uuid, text)', 'execute')
          and not has_function_privilege('anon', 'public.league_participant_display_name(uuid, text)', 'execute')
          and not has_function_privilege('authenticated', 'public.league_members_freeze_leaver()', 'execute')
          and not has_function_privilege('anon', 'public.league_members_freeze_leaver()', 'execute')
         then 'PASS' else 'FAIL' end);

  -- Deliberate: rolls back every fixture and shows the result.
  raise exception E'FROZEN LEAVER NAMES EFFECT TEST: % (all rolled back)\n%',
    case when out ~ 'FAIL' then 'FAIL' else 'PASS' end
      || format(' (%s/16 lines PASS)', (select count(*) from regexp_matches(out, 'PASS\n', 'g'))), out;
end;
$$;
