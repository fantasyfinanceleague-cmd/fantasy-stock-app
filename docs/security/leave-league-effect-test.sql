-- ============================================================================
-- LEAVE LEAGUE EFFECT TEST: run in the Supabase SQL editor AFTER `db push` of
-- 20261107000000-04. Read-only in effect: NOTHING persists.
-- ============================================================================
-- Same shape as docs/security/draft-order-modes-effect-test.sql:
--   * The SQL editor shows only the LAST statement's output, and a failing
--     statement aborts the transaction. So every case runs in its own
--     BEGIN/EXCEPTION sub-block and records its outcome, and the block ENDS BY
--     RAISING. That rolls back the fixture and every write, and puts the result
--     table in the editor's error panel.
--   * Role/claims switch with set_config(..., true), the mechanism PostgREST
--     uses, so auth.uid(), RLS and EXECUTE grants behave as for a real call.
--     Cases run in privilege order (postgres fixture, service_role,
--     authenticated, anon): nothing depends on switching back UP.
--   * now() is frozen for the transaction, so time is each fixture league's
--     draft_date (5h away = open; 30 min away = inside the hour, order set).
--   * Grant cases match the "permission denied" MESSAGE, not only SQLSTATE
--     42501.
--   * supabase/tests/leave_league.pglite.test.ts runs THIS file on real
--     Postgres and requires every line to PASS.
--
-- EXPECTED OUTPUT (the final "ERROR:" text): every line ends in PASS.
--   G1  leave/unhide/confirm RPCs: service_role only, definer, path pinned  PASS
--   G2  league_roster_reconfirm: RLS on; read-only for authenticated/service PASS
--   G3  league_members has NO DELETE policy ([I5] gone)                       PASS
--   G4  get_home_summary: authenticated only, skips hidden leagues           PASS
--   G5  member_left kind allowed; league_members.hidden_at exists            PASS
--   S1  pre-draft leave: row gone, reconfirm row, member_left to commish     PASS
--   S2  inside the hour: locked_in (order_set), nothing written              PASS
--   S3  commissioner: successor_required, then hand-over to the successor    PASS
--   S4  confirm: P above members refused; confirm with P = members           PASS
--   S5  after the season: hidden, membership kept                            PASS
--   S6  mid-season: locked_in (season)                                        PASS
--   A1  authenticated cannot call leave_league                               PASS
--   A2  a client DELETE of one's own membership deletes nothing              PASS
--   A3  a client cannot write league_roster_reconfirm                        PASS
--   A4  a member reads the reconfirm row; an outsider sees none              PASS
--   N1  anon cannot call leave_league / read the reconfirm row               PASS
-- Any FAIL line is a real finding: stop and report it.
-- ============================================================================
do $$
declare
  c_uid  text := gen_random_uuid()::text;   -- commissioner
  a_uid  text := gen_random_uuid()::text;
  b_uid  text := gen_random_uuid()::text;
  d_uid  text := gen_random_uuid()::text;
  e_uid  text := gen_random_uuid()::text;
  x_uid  text := gen_random_uuid()::text;   -- outsider
  l_far  uuid;   -- not started, draft 5h away: leaving is open
  l_soon uuid;   -- not started, draft 30 min away: the order is set
  l_rd   uuid;   -- not started, 5h away: for the read cases
  l_live uuid;   -- mid-season
  l_done uuid;   -- season completed
  res    jsonb;
  acl    text;
  n      int;
  out    text := E'\nLEAVE LEAGUE EFFECT TEST RESULTS\n';
begin
  -- ---- G: grants and catalog ------------------------------------------------
  select string_agg(proname || '=' || coalesce(proacl::text, 'NULL') || ' sd=' || prosecdef || ' cfg=' || coalesce(proconfig::text, 'NULL'), ' ')
    into acl
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and proname in ('leave_league', 'unhide_league', 'confirm_league_roster')
     and (proacl::text !~ 'service_role=X' or proacl::text ~ '(anon|authenticated)=' or proacl::text ~ '(^|[{,])=X'
          or not prosecdef or coalesce(proconfig::text, '') !~ 'search_path=public, pg_temp');
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and proname in ('leave_league', 'unhide_league', 'confirm_league_roster');
  out := out || format(E'G1 RPC grants (%s fns)       %s  %s\n', n, coalesce(acl, 'ok'),
    case when acl is null and n = 3 then 'PASS' else 'FAIL' end);

  select relname || '=' || coalesce(relacl::text, 'NULL') || ' rls=' || relrowsecurity into acl
    from pg_class where relname = 'league_roster_reconfirm' and relnamespace = 'public'::regnamespace;
  out := out || format(E'G2 reconfirm table           %s  %s\n', acl,
    case when acl ~ 'rls=true' and acl !~ 'anon=' and acl ~ 'authenticated=r/' and acl ~ 'service_role=r/'
          and acl !~ 'authenticated=[^/]*[awdDxtm]' and acl !~ 'service_role=[^/]*[awdDxtm]' then 'PASS' else 'FAIL' end);

  select count(*), string_agg(policyname, ',') into n, acl from pg_policies
   where schemaname = 'public' and tablename = 'league_members' and cmd in ('DELETE', 'ALL');
  out := out || format(E'G3 league_members DELETE policies = %s %s  %s\n', n, coalesce(acl, ''),
    case when n = 0 then 'PASS' else 'FAIL' end);

  select proacl::text || case when prosrc ~ 'hidden_at is null' then ' skips-hidden' else ' NO-FILTER' end into acl
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and proname = 'get_home_summary';
  out := out || format(E'G4 get_home_summary          %s  %s\n', acl,
    case when acl ~ 'authenticated=X' and acl !~ '(anon|service_role)=' and acl ~ 'skips-hidden' then 'PASS' else 'FAIL' end);

  select count(*) into n from pg_constraint
   where conname = 'league_notifications_kind_check' and pg_get_constraintdef(oid) ~ 'member_left'
     and pg_get_constraintdef(oid) ~ 'draft_order_set';
  out := out || format(E'G5 member_left kind / hidden_at col  %s  %s\n',
    n || '/' || (select count(*) from information_schema.columns
                  where table_schema = 'public' and table_name = 'league_members' and column_name = 'hidden_at'),
    case when n = 1 and exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'league_members' and column_name = 'hidden_at')
         then 'PASS' else 'FAIL' end);

  -- ---- fixture (as the editor's own role) -----------------------------------
  insert into public.leagues (name, commissioner_id, invite_code, num_participants, draft_status, draft_date, playoff_teams)
  values ('__LEAVE_FAR__', c_uid, 'LV-' || gen_random_uuid(), 8, 'not_started', now() + interval '5 hours', 4)
  returning id into l_far;
  insert into public.leagues (name, commissioner_id, invite_code, num_participants, draft_status, draft_date, playoff_teams)
  values ('__LEAVE_SOON__', c_uid, 'LV-' || gen_random_uuid(), 8, 'not_started', now() + interval '30 minutes', 4)
  returning id into l_soon;
  insert into public.leagues (name, commissioner_id, invite_code, num_participants, draft_status, draft_date, playoff_teams)
  values ('__LEAVE_READ__', c_uid, 'LV-' || gen_random_uuid(), 8, 'not_started', now() + interval '5 hours', 4)
  returning id into l_rd;
  insert into public.leagues (name, commissioner_id, invite_code, num_participants, draft_status, draft_date, playoff_teams)
  values ('__LEAVE_LIVE__', c_uid, 'LV-' || gen_random_uuid(), 8, 'not_started', now() + interval '5 hours', 4)
  returning id into l_live;
  insert into public.leagues (name, commissioner_id, invite_code, num_participants, draft_status, draft_date, playoff_teams)
  values ('__LEAVE_DONE__', c_uid, 'LV-' || gen_random_uuid(), 8, 'not_started', now() + interval '5 hours', 4)
  returning id into l_done;
  insert into public.league_members (league_id, user_id, role)
  select l, u, case when u = c_uid then 'commissioner' else 'member' end
    from unnest(array[l_far, l_soon, l_rd, l_live, l_done]) l,
         unnest(array[c_uid, a_uid, b_uid, d_uid, e_uid]) u;
  update public.leagues set draft_status = 'completed', draft_started_at = now() where id in (l_live, l_done);
  update public.leagues set season_status = 'completed' where id = l_done;

  -- ---- service_role: the leave-league / draft-control edge functions' calls --
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);

  begin
    res := public.leave_league(l_far, a_uid);
    out := out || format(E'S1 pre-draft leave           -> %s/%s reconfirm=%s notice->commish=%s members=%s  %s\n',
      res->>'status', res->>'reconfirm_required',
      (select count(*) from public.league_roster_reconfirm where league_id = l_far),
      (select count(*) from public.league_notifications where league_id = l_far and kind = 'member_left' and user_id = c_uid),
      (select count(*) from public.league_members where league_id = l_far),
      case when res->>'status' = 'left' and (res->>'reconfirm_required')::boolean
            and not exists (select 1 from public.league_members where league_id = l_far and user_id = a_uid)
            and exists (select 1 from public.league_roster_reconfirm where league_id = l_far)
            and (select count(*) from public.league_notifications where league_id = l_far and kind = 'member_left' and user_id = c_uid) = 1
           then 'PASS' else 'FAIL ' || res::text end);
  exception when others then
    out := out || format(E'S1 pre-draft leave           -> %s FAIL (%s)\n', sqlstate, sqlerrm);
  end;

  begin
    res := public.leave_league(l_soon, a_uid);
    out := out || format(E'S2 inside the hour           -> %s/%s/%s  %s\n', res->>'status', res->>'reason', res->>'window',
      case when res->>'reason' = 'locked_in' and res->>'window' = 'order_set'
            and exists (select 1 from public.league_members where league_id = l_soon and user_id = a_uid)
            and not exists (select 1 from public.league_roster_reconfirm where league_id = l_soon)
           then 'PASS' else 'FAIL ' || res::text end);
  exception when others then
    out := out || format(E'S2 inside the hour           -> %s FAIL (%s)\n', sqlstate, sqlerrm);
  end;

  begin
    res := public.leave_league(l_far, c_uid);
    if res->>'reason' is distinct from 'successor_required' then
      out := out || format(E'S3 commissioner, no successor -> %s  FAIL\n', res::text);
    else
      res := public.leave_league(l_far, c_uid, b_uid);
      out := out || format(E'S3 commissioner hand-over    -> %s commish=%s role=%s  %s\n', res->>'status',
        (select commissioner_id = b_uid from public.leagues where id = l_far),
        (select role from public.league_members where league_id = l_far and user_id = b_uid),
        case when res->>'status' = 'left' and (res->>'made_commissioner')::boolean
              and (select commissioner_id from public.leagues where id = l_far) = b_uid
              and (select role from public.league_members where league_id = l_far and user_id = b_uid) = 'commissioner'
              and not exists (select 1 from public.league_members where league_id = l_far and user_id = c_uid)
             then 'PASS' else 'FAIL ' || res::text end);
    end if;
  exception when others then
    out := out || format(E'S3 commissioner hand-over    -> %s FAIL (%s)\n', sqlstate, sqlerrm);
  end;

  begin
    -- l_far now has b (commissioner), d, e: 3 members, playoff_teams 4.
    res := public.confirm_league_roster(l_far, b_uid);
    if res->>'reason' is distinct from 'playoff_teams_exceeds_members' then
      out := out || format(E'S4 confirm with P > members  -> %s  FAIL\n', res::text);
    else
      res := public.confirm_league_roster(l_far, b_uid, 3);
      out := out || format(E'S4 confirm (P=3)             -> %s P=%s reconfirm rows=%s  %s\n', res->>'status',
        (select playoff_teams from public.leagues where id = l_far),
        (select count(*) from public.league_roster_reconfirm where league_id = l_far),
        case when res->>'status' = 'confirmed' and (select playoff_teams from public.leagues where id = l_far) = 3
              and not exists (select 1 from public.league_roster_reconfirm where league_id = l_far)
             then 'PASS' else 'FAIL ' || res::text end);
    end if;
  exception when others then
    out := out || format(E'S4 confirm                   -> %s FAIL (%s)\n', sqlstate, sqlerrm);
  end;

  begin
    res := public.leave_league(l_done, a_uid);
    out := out || format(E'S5 after the season          -> %s hidden=%s  %s\n', res->>'status',
      (select hidden_at is not null from public.league_members where league_id = l_done and user_id = a_uid),
      case when res->>'status' = 'hidden'
            and (select hidden_at is not null from public.league_members where league_id = l_done and user_id = a_uid)
           then 'PASS' else 'FAIL ' || res::text end);
  exception when others then
    out := out || format(E'S5 after the season          -> %s FAIL (%s)\n', sqlstate, sqlerrm);
  end;

  begin
    res := public.leave_league(l_live, a_uid);
    out := out || format(E'S6 mid-season                -> %s/%s/%s  %s\n', res->>'status', res->>'reason', res->>'window',
      case when res->>'reason' = 'locked_in' and res->>'window' = 'season'
            and exists (select 1 from public.league_members where league_id = l_live and user_id = a_uid)
           then 'PASS' else 'FAIL ' || res::text end);
  exception when others then
    out := out || format(E'S6 mid-season                -> %s FAIL (%s)\n', sqlstate, sqlerrm);
  end;

  -- A reconfirm row to read in A4 (e leaves l_rd).
  res := public.leave_league(l_rd, e_uid);

  -- ---- authenticated: member d ----------------------------------------------
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', d_uid, 'role', 'authenticated')::text, true);

  begin
    res := public.leave_league(l_rd, d_uid);
    out := out || format(E'A1 authenticated leave_league -> accepted %s  FAIL\n', res::text);
  exception when others then
    out := out || format(E'A1 authenticated leave_league -> %s  %s\n', sqlstate,
      case when sqlerrm like 'permission denied%' then 'PASS' else 'FAIL (' || sqlerrm || ')' end);
  end;

  begin
    delete from public.league_members where league_id = l_rd and user_id = d_uid;
    get diagnostics n = row_count;
    out := out || format(E'A2 client self-DELETE         -> %s row(s)  %s\n', n, case when n = 0 then 'PASS' else 'FAIL' end);
  exception when others then
    -- A refusal is also a pass: the row survives either way.
    out := out || format(E'A2 client self-DELETE         -> %s  PASS\n', sqlstate);
  end;

  begin
    insert into public.league_roster_reconfirm (league_id, departed, members_before)
    values (l_rd, '[{"user_id":"x"}]'::jsonb, 9);
    out := out || E'A3 client reconfirm INSERT    -> accepted  FAIL\n';
  exception when others then
    out := out || format(E'A3 client reconfirm INSERT    -> %s  %s\n', sqlstate,
      case when sqlerrm like 'permission denied%' then 'PASS' else 'FAIL (' || sqlerrm || ')' end);
  end;

  begin
    select count(*) into n from public.league_roster_reconfirm where league_id = l_rd;
    perform set_config('request.jwt.claims', json_build_object('sub', x_uid, 'role', 'authenticated')::text, true);
    out := out || format(E'A4 member reads / outsider    -> %s / %s  %s\n', n,
      (select count(*) from public.league_roster_reconfirm where league_id = l_rd),
      case when n = 1 and (select count(*) from public.league_roster_reconfirm where league_id = l_rd) = 0
           then 'PASS' else 'FAIL' end);
  exception when others then
    out := out || format(E'A4 reconfirm read            -> %s FAIL (%s)\n', sqlstate, sqlerrm);
  end;

  -- ---- anon ------------------------------------------------------------------
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  begin
    res := public.leave_league(l_rd, d_uid);
    out := out || E'N1 anon leave_league           -> accepted  FAIL\n';
  exception when others then
    begin
      select count(*) into n from public.league_roster_reconfirm;
      out := out || format(E'N1 anon                       -> call %s; table read accepted  FAIL\n', sqlstate);
    exception when others then
      out := out || format(E'N1 anon call / table read     -> denied / denied  %s\n',
        case when sqlerrm like 'permission denied%' then 'PASS' else 'FAIL (' || sqlerrm || ')' end);
    end;
  end;

  raise exception '%', out;
end;
$$;
