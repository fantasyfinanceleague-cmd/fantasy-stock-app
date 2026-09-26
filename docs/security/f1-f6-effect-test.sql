-- ============================================================================
-- F1 / F11 / F6 EFFECT TEST — run in the Supabase SQL editor AFTER `db push`
-- of 20260925000000 + 20260925000001. Read-only in effect: NOTHING persists.
-- ============================================================================
-- Why this shape:
--   * Prod has no league in `in_progress`, and the member draft-complete RLS
--     policy only admits UPDATEs on `in_progress` rows. So the test builds its
--     own fixture leagues rather than borrowing a real one.
--   * The SQL editor shows only the LAST statement's output, and a failing
--     statement aborts a transaction. So every case runs in its own
--     BEGIN/EXCEPTION sub-block (a savepoint) and records its outcome, and the
--     block ENDS BY RAISING — which rolls back the fixture and every write, and
--     puts the result table in the editor's error panel.
--   * Role/claims are switched with set_config(..., true), the same mechanism
--     PostgREST uses, so auth.uid() and RLS behave exactly as for a real call.
--
-- EXPECTED OUTPUT (the final "ERROR:" text):
--   A  member takeover (commissioner_id)           -> 42501 trigger   PASS
--   A2 member rewrites a set date (F11)            -> 42501 trigger   PASS
--   A3 member changes notional_per_slot            -> 42501 trigger   PASS
--   B  member completes + first-time date stamp    -> rows=1          PASS
--   C  service_role (auth.uid() NULL) any column   -> rows=1          PASS
--   E  commissioner edits settings                 -> rows=1          PASS
--   F6a member inserts non-zero standings          -> 42501           PASS
--   F6b member inserts all-zero standings          -> rows=1          PASS
-- Any FAIL line is a real finding: stop and report it.
-- ============================================================================
do $$
declare
  c_uid  text := gen_random_uuid()::text;   -- fixture commissioner
  m_uid  text := gen_random_uuid()::text;   -- fixture non-commissioner member
  l_null uuid;                              -- in_progress, dates NULL
  l_set  uuid;                              -- in_progress, dates already set
  n int;
  out text := E'\n';

begin
  -- ---- fixture (as the editor's own role; bypasses RLS) ---------------------
  insert into public.leagues (name, commissioner_id, invite_code, num_participants, draft_status)
  values ('__F1_TEST_NULL__', c_uid, 'F1T-' || gen_random_uuid(), 4, 'in_progress')
  returning id into l_null;

  insert into public.leagues (name, commissioner_id, invite_code, num_participants, draft_status,
                              league_start_date, league_end_date)
  values ('__F1_TEST_SET__', c_uid, 'F1T-' || gen_random_uuid(), 4, 'in_progress',
          now(), now() + interval '30 days')
  returning id into l_set;

  insert into public.league_members (league_id, user_id, role) values
    (l_null, c_uid, 'commissioner'), (l_null, m_uid, 'member'),
    (l_set,  c_uid, 'commissioner'), (l_set,  m_uid, 'member');

  -- ---- become the non-commissioner member -----------------------------------
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', m_uid, 'role', 'authenticated')::text, true);

  -- A: takeover. draft_status='completed' is included so RLS WITH CHECK passes
  -- and the ONLY thing that can refuse is the trigger (checked via its message).
  begin
    update public.leagues set draft_status = 'completed', commissioner_id = m_uid where id = l_null;
    get diagnostics n = row_count;
    out := out || format(E'A  takeover          -> rows=%s  FAIL (trigger did not fire)\n', n);
  exception when others then
    out := out || format(E'A  takeover          -> %s %s\n', sqlstate,
      case when sqlstate = '42501' and sqlerrm like '%non-commissioner member%' then 'trigger PASS'
           else 'FAIL (' || sqlerrm || ')' end);
  end;

  -- A2: F11, rewrite an already-set date.
  begin
    update public.leagues set draft_status = 'completed',
                              league_start_date = league_start_date - interval '7 days'
     where id = l_set;
    get diagnostics n = row_count;
    out := out || format(E'A2 date rewrite      -> rows=%s  FAIL\n', n);
  exception when others then
    out := out || format(E'A2 date rewrite      -> %s %s\n', sqlstate,
      case when sqlstate = '42501' and sqlerrm like '%non-commissioner member%' then 'trigger PASS'
           else 'FAIL (' || sqlerrm || ')' end);
  end;

  -- A3: a column added AFTER the trigger was written (whole-row guard).
  begin
    update public.leagues set draft_status = 'completed', notional_per_slot = 999999 where id = l_null;
    get diagnostics n = row_count;
    out := out || format(E'A3 notional change   -> rows=%s  FAIL\n', n);
  exception when others then
    out := out || format(E'A3 notional change   -> %s %s\n', sqlstate,
      case when sqlstate = '42501' and sqlerrm like '%non-commissioner member%' then 'trigger PASS'
           else 'FAIL (' || sqlerrm || ')' end);
  end;

  -- F6a / F6b: standings INSERT bound (as the same member, before B changes l_null).
  begin
    insert into public.league_standings (league_id, user_id, wins) values (l_null, c_uid, 5);
    out := out || E'F6a non-zero insert  -> accepted  FAIL\n';
  exception when others then
    out := out || format(E'F6a non-zero insert  -> %s %s\n', sqlstate,
      case when sqlstate = '42501' then 'PASS' else 'FAIL (' || sqlerrm || ')' end);
  end;
  begin
    insert into public.league_standings (league_id, user_id) values (l_null, m_uid);
    get diagnostics n = row_count;
    out := out || format(E'F6b zero insert      -> rows=%s  %s\n', n, case when n = 1 then 'PASS' else 'FAIL' end);
  exception when others then
    out := out || format(E'F6b zero insert      -> %s FAIL (%s)\n', sqlstate, sqlerrm);
  end;

  -- B: the legitimate web completeDraft shape.
  begin
    update public.leagues set draft_status = 'completed',
                              league_start_date = now(), league_end_date = now() + interval '30 days'
     where id = l_null;
    get diagnostics n = row_count;
    out := out || format(E'B  member completion -> rows=%s  %s\n', n, case when n = 1 then 'PASS' else 'FAIL' end);
  exception when others then
    out := out || format(E'B  member completion -> %s FAIL (%s)\n', sqlstate, sqlerrm);
  end;

  -- ---- become the commissioner ----------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', c_uid, 'role', 'authenticated')::text, true);
  begin
    update public.leagues set name = '__F1_TEST_SET_RENAMED__', notional_per_slot = 2000 where id = l_set;
    get diagnostics n = row_count;
    out := out || format(E'E  commissioner edit -> rows=%s  %s\n', n, case when n = 1 then 'PASS' else 'FAIL' end);
  exception when others then
    out := out || format(E'E  commissioner edit -> %s FAIL (%s)\n', sqlstate, sqlerrm);
  end;

  -- ---- become service_role with no sub (edge-function admin client shape) ---
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  begin
    update public.leagues set commissioner_id = m_uid, current_week = 3 where id = l_set;
    get diagnostics n = row_count;
    out := out || format(E'C  service_role      -> rows=%s  %s\n', n, case when n = 1 then 'PASS' else 'FAIL' end);
  exception when others then
    out := out || format(E'C  service_role      -> %s FAIL (%s)\n', sqlstate, sqlerrm);
  end;

  -- Deliberate: rolls back the fixture and every write above, and displays `out`.
  raise exception 'F1/F6 EFFECT TEST RESULTS (all rolled back):%', out;
end;
$$;
