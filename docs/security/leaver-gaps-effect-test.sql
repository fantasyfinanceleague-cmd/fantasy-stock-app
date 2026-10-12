-- ============================================================================
-- LEAVER GAPS EFFECT TEST: run in the Supabase SQL editor AFTER `db push` of
-- 20261120000000 (transfer_commissioner refuses a hidden member) and
-- 20261120000001 (league_members_insert_self refuses hidden_at).
-- Read-only in effect: NOTHING persists.
-- ============================================================================
-- Same shape as docs/security/leave-league-effect-test.sql:
--   * The SQL editor shows only the LAST statement's output, and a failing
--     statement aborts the transaction. So every case runs in its own
--     BEGIN/EXCEPTION sub-block and records its outcome, and the block ENDS BY
--     RAISING. That rolls back the fixture and every write, and puts the result
--     table in the editor's error panel.
--   * Role/claims switch with set_config(..., true), the mechanism PostgREST
--     uses, so auth.uid(), RLS and EXECUTE grants behave as for a real call.
--     Cases run in privilege order (postgres fixture, service_role,
--     authenticated): nothing depends on switching back UP.
--   * Every fixture league sets league_type EXPLICITLY (the prod default is
--     'duration'), and every league_members insert names role (prod has no
--     default; supabase/tests/effect_test_fixture_columns.test.ts).
--   * The leaver is made by leave_league itself (service role, after the
--     season), the only real path that sets hidden_at.
--   * supabase/tests/leaver_gaps.pglite.test.ts runs THIS file on real
--     Postgres and requires every PASS line to PASS.
--
-- EXPECTED OUTPUT (the final "ERROR:" text): every line ends in PASS, except I1.
--   G1  transfer_commissioner: service_role only (has_function_privilege),
--       definer, search_path pinned, refuses hidden targets                  PASS
--   G2  league_members_insert_self: authenticated INSERT, WITH CHECK keeps
--       user_id / role / not-started league AND adds hidden_at IS NULL       PASS
--   T1  after the season, a member leaves (hidden); the commissioner tries to
--       hand them the title -> target_invalid, nothing written              PASS
--   T2  the same transfer to a CURRENT member still goes through            PASS
--   P1  the creator self-inserts as commissioner, hidden_at set -> 42501     PASS
--   P2  the creator's normal self-insert (no hidden_at) -> 1 row, not hidden PASS
--   I1  [I6] residual, NOT fixed here: a member adds a bot row born hidden.
--       Reports what happens (rows=1 until [I6] is dropped by
--       migrations/deferred/20260929000000_drop_I6_I2b.sql)                  INFO
-- BEFORE the push, G1 G2 T1 P1 read FAIL: that is the finding.
-- Any FAIL line after the push is a real finding: stop and report it.
-- ============================================================================
do $$
declare
  c_uid  text := gen_random_uuid()::text;   -- commissioner
  a_uid  text := gen_random_uuid()::text;   -- leaves after the season (hidden)
  b_uid  text := gen_random_uuid()::text;   -- stays: a current member
  l_done uuid;   -- season completed, members c a b
  l_new1 uuid;   -- c's brand-new league, not started, no members yet
  l_new2 uuid;   -- c's brand-new league, not started, no members yet
  res    jsonb;
  acl    text;
  n      int;
  out    text := E'\nLEAVER GAPS EFFECT TEST RESULTS\n';
begin
  -- ---- G: grants and catalog ------------------------------------------------
  select format('anon=%s auth=%s service=%s sd=%s cfg=%s hidden=%s',
           has_function_privilege('anon', p.oid, 'EXECUTE'),
           has_function_privilege('authenticated', p.oid, 'EXECUTE'),
           has_function_privilege('service_role', p.oid, 'EXECUTE'),
           prosecdef, coalesce(proconfig::text, 'NULL'), prosrc ~ 'hidden_at is null')
    into acl
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and proname = 'transfer_commissioner';
  out := out || format(E'G1 transfer_commissioner     %s  %s\n', coalesce(acl, 'MISSING'),
    case when acl = 'anon=f auth=f service=t sd=t cfg={"search_path=public, pg_temp"} hidden=t'
         then 'PASS' else 'FAIL' end);

  select count(*), string_agg(roles::text || ' ' || cmd || ' ' || with_check, ' | ') into n, acl
    from pg_policies
   where schemaname = 'public' and tablename = 'league_members' and policyname = 'league_members_insert_self';
  out := out || format(E'G2 insert_self policy        %s  %s\n', coalesce(acl, 'MISSING'),
    case when n = 1 and acl ~ '^\{authenticated\} INSERT '
          and acl ~ 'auth\.uid\(\)' and acl ~ '''commissioner''' and acl ~ 'commissioner_id'
          and acl ~ '''not_started''' and acl ~ 'hidden_at IS NULL'
         then 'PASS' else 'FAIL' end);

  -- ---- fixture (as the editor's own role) -----------------------------------
  insert into public.leagues (name, commissioner_id, invite_code, num_participants, draft_status, draft_date, playoff_teams, league_type)
  values ('__LEAVER_DONE__', c_uid, 'LG-' || gen_random_uuid(), 8, 'not_started', now() + interval '5 hours', 4, 'matchup')
  returning id into l_done;
  insert into public.leagues (name, commissioner_id, invite_code, num_participants, draft_status, draft_date, playoff_teams, league_type)
  values ('__LEAVER_NEW1__', c_uid, 'LG-' || gen_random_uuid(), 8, 'not_started', now() + interval '5 hours', 4, 'matchup')
  returning id into l_new1;
  insert into public.leagues (name, commissioner_id, invite_code, num_participants, draft_status, draft_date, playoff_teams, league_type)
  values ('__LEAVER_NEW2__', c_uid, 'LG-' || gen_random_uuid(), 8, 'not_started', now() + interval '5 hours', 4, 'matchup')
  returning id into l_new2;
  insert into public.league_members (league_id, user_id, role)
  select l_done, u, case when u = c_uid then 'commissioner' else 'member' end
    from unnest(array[c_uid, a_uid, b_uid]) u;
  update public.leagues set draft_status = 'completed', draft_started_at = now() where id = l_done;
  update public.leagues set season_status = 'completed' where id = l_done;

  -- ---- service_role: the leave-league edge function's calls -----------------
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);

  begin
    -- a leaves the finished league: the real hide path.
    acl := public.leave_league(l_done, a_uid)->>'status';
    res := public.transfer_commissioner(l_done, c_uid, a_uid);
    out := out || format(E'T1 transfer to a leaver      -> hide=%s %s/%s  %s\n', acl, res->>'status', res->>'reason',
      case when acl = 'hidden' and res->>'status' = 'refused' and res->>'reason' = 'target_invalid'
            and (select commissioner_id from public.leagues where id = l_done) = c_uid
            and (select role from public.league_members where league_id = l_done and user_id = a_uid) = 'member'
            and (select role from public.league_members where league_id = l_done and user_id = c_uid) = 'commissioner'
            and not exists (select 1 from public.league_notifications
                             where league_id = l_done and kind = 'commissioner_transferred')
           then 'PASS' else 'FAIL ' || res::text end);
  exception when others then
    out := out || format(E'T1 transfer to a leaver      -> %s FAIL (%s)\n', sqlstate, sqlerrm);
  end;

  begin
    res := public.transfer_commissioner(l_done, c_uid, b_uid);
    out := out || format(E'T2 transfer to a member      -> %s/%s  %s\n', res->>'status', res->>'window',
      case when res->>'status' = 'transferred' and res->>'window' = 'after_season'
            and (select commissioner_id from public.leagues where id = l_done) = b_uid
            and (select role from public.league_members where league_id = l_done and user_id = b_uid) = 'commissioner'
           then 'PASS' else 'FAIL ' || res::text end);
  exception when others then
    out := out || format(E'T2 transfer to a member      -> %s FAIL (%s)\n', sqlstate, sqlerrm);
  end;

  -- ---- authenticated: c's own session, the create-league clients' calls -----
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', c_uid, 'role', 'authenticated')::text, true);

  begin
    insert into public.league_members (league_id, user_id, role, hidden_at) values (l_new1, c_uid, 'commissioner', now());
    get diagnostics n = row_count;
    out := out || format(E'P1 self-insert born hidden   -> rows=%s  FAIL\n', n);
  exception when others then
    out := out || format(E'P1 self-insert born hidden   -> %s  %s\n', sqlstate,
      case when sqlstate = '42501' then 'PASS' else 'FAIL (' || sqlerrm || ')' end);
  end;

  begin
    insert into public.league_members (league_id, user_id, role) values (l_new2, c_uid, 'commissioner');
    get diagnostics n = row_count;
    out := out || format(E'P2 normal self-insert        -> rows=%s  %s\n', n,
      case when n = 1 and (select hidden_at is null from public.league_members
                            where league_id = l_new2 and user_id = c_uid)
           then 'PASS' else 'FAIL' end);
  exception when others then
    out := out || format(E'P2 normal self-insert        -> %s FAIL (%s)\n', sqlstate, sqlerrm);
  end;

  begin
    -- c is now a member of l_new2 (P2), so [I6]'s is_member() holds.
    insert into public.league_members (league_id, user_id, role, hidden_at) values (l_new2, 'bot-leaver-gaps', 'member', now());
    get diagnostics n = row_count;
    out := out || format(E'I1 [I6] bot born hidden      -> rows=%s  INFO (residual, not fixed here)\n', n);
  exception when others then
    out := out || format(E'I1 [I6] bot born hidden      -> %s  INFO (%s)\n', sqlstate, sqlerrm);
  end;

  raise exception '%', out;
end;
$$;
