-- ============================================================================
-- DRAFT PICK CLOCK EFFECT TEST — run in the Supabase SQL editor AFTER `db push`
-- of 20261010000000_draft_pick_clock_and_queue.sql. Read-only in effect:
-- NOTHING persists.
-- ============================================================================
-- Why this shape (same as docs/security/join-mid-draft-effect-test.sql):
--   * The SQL editor shows only the LAST statement's output, and a failing
--     statement aborts a transaction. So every case runs in its own
--     BEGIN/EXCEPTION sub-block (a savepoint) and records its outcome, and the
--     block ENDS BY RAISING — which rolls back the fixture and every write,
--     and puts the result table in the editor's error panel.
--   * Role/claims are switched with set_config(..., true), the same mechanism
--     PostgREST uses, so auth.uid(), RLS and EXECUTE grants behave exactly as
--     for a real call. Cases run in privilege order (postgres fixture, then
--     service_role, then authenticated, then anon) so no case depends on
--     switching back UP.
--   * What this does NOT prove: that a turn becomes overdue after
--     pick_seconds. now() is frozen for a whole transaction, so real elapsed
--     time cannot be observed here; that logic is proven on real Postgres by
--     supabase/tests/draft_pick_clock.pglite.test.ts (same SQL, loaded
--     verbatim), and end-to-end by the deferred cron's data check.
--   * Grant cases match the "permission denied" MESSAGE, not only SQLSTATE
--     42501 (a function's own raise can share that code).
--
-- EXPECTED OUTPUT (the final "ERROR:" text): every line ends in PASS.
--   G1..G5  proacl for the 5 functions                              PASS
--   P0      pre-existing in_progress drafts are all unclocked      PASS (count shown)
--   T1      pick_seconds=20 refused by CHECK                        PASS
--   T2      draft_started_at NULL before the draft starts           PASS
--   T3      flip to in_progress stamps draft_started_at             PASS
--   T4      a direct write to draft_started_at is discarded         PASS
--   T5      pick_seconds change after start -> pick_seconds_locked  PASS
--   C1      get_draft_clock: deadline = started + pick_seconds      PASS
--   C2      a recorded pick re-anchors the clock to its own row     PASS
--   R1      same pick_number twice -> 23505, one row                PASS
--   R2      pick_source 'auto' refused by CHECK                     PASS
--   S1      overdue_draft_turns (service_role) lists no unclocked league  PASS
--   S2      auto_pick_search_candidates (service_role): only active,
--           draftable, in-bracket, not-excluded rows, largest first  PASS
--   A1      member sets queue: normalized + de-duplicated           PASS
--   A2      unknown symbol refused, queue unchanged                 PASS
--   A3      member reads own queue (RLS)                            PASS
--   A4      direct INSERT into draft_queue refused                  PASS
--   A5      commissioner flip of pick_clock_enabled is discarded    PASS
--   A6      authenticated cannot call overdue_draft_turns           PASS
--   A7      another member sees none of it                          PASS
--   A8      non-member set_draft_queue -> not_a_member              PASS
--   N1      anon cannot call get_draft_clock / set_draft_queue      PASS
-- Any FAIL line is a real finding: stop and report it.
-- ============================================================================
do $$
declare
  c_uid  text := gen_random_uuid()::text;   -- commissioner
  a_uid  text := gen_random_uuid()::text;   -- member A (queue owner)
  x_uid  text := gen_random_uuid()::text;   -- outsider
  l_id   uuid;
  st     timestamptz;
  rec    record;
  res    jsonb;
  n      int;
  acl    text;
  res_bad    int;
  res_ok     boolean;
  res_sorted boolean;
  out    text := E'\n';
begin
  -- ---- G: grants (proacl), read as the editor's role ------------------------
  select proacl::text into acl from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and proname = 'get_draft_clock';
  out := out || format(E'G1 get_draft_clock      %s  %s\n', acl,
    case when acl !~ 'anon=' and acl !~ '(^|[{,])=X' and acl ~ 'authenticated=X' and acl ~ 'service_role=X' then 'PASS' else 'FAIL' end);
  select proacl::text into acl from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and proname = 'overdue_draft_turns';
  out := out || format(E'G2 overdue_draft_turns  %s  %s\n', acl,
    case when acl !~ '(anon|authenticated)=' and acl !~ '(^|[{,])=X' and acl ~ 'service_role=X' then 'PASS' else 'FAIL' end);
  select proacl::text into acl from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and proname = 'set_draft_queue';
  out := out || format(E'G3 set_draft_queue      %s  %s\n', acl,
    case when acl !~ 'anon=' and acl !~ '(^|[{,])=X' and acl ~ 'authenticated=X' then 'PASS' else 'FAIL' end);
  select proacl::text into acl from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and proname = 'enforce_leagues_pick_clock';
  out := out || format(E'G4 trigger fn           %s  %s\n', acl,
    case when acl !~ '(anon|authenticated)=' and acl !~ '(^|[{,])=X' then 'PASS' else 'FAIL' end);

  select proacl::text into acl from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and proname = 'auto_pick_search_candidates';
  out := out || format(E'G5 search fn           %s  %s\n', acl,
    case when acl !~ '(anon|authenticated)=' and acl !~ '(^|[{,])=X' and acl ~ 'service_role=X' then 'PASS' else 'FAIL' end);

  -- ---- P0: the Q2 hold — nothing running before the push is clocked ---------
  select count(*) into n from public.leagues
   where draft_status = 'in_progress' and pick_clock_enabled and draft_started_at is null;
  out := out || format(E'P0 in_progress clocked w/o anchor = %s (in_progress unclocked = %s)  %s\n', n,
    (select count(*) from public.leagues where draft_status = 'in_progress' and not pick_clock_enabled),
    case when n = 0 then 'PASS' else 'FAIL' end);

  -- ---- fixture (as the editor's own role; bypasses RLS) ---------------------
  begin
    insert into public.leagues (name, commissioner_id, invite_code, num_participants, draft_status, pick_seconds)
    values ('__CLOCK_T1__', c_uid, 'CLK-' || gen_random_uuid(), 4, 'not_started', 20);
    out := out || E'T1 pick_seconds=20      -> accepted  FAIL\n';
  exception when others then
    out := out || format(E'T1 pick_seconds=20      -> %s  %s\n', sqlstate, case when sqlstate = '23514' then 'PASS' else 'FAIL (' || sqlerrm || ')' end);
  end;

  insert into public.leagues (name, commissioner_id, invite_code, num_participants, draft_status, pick_seconds)
  values ('__CLOCK__', c_uid, 'CLK-' || gen_random_uuid(), 4, 'not_started', 45)
  returning id into l_id;
  insert into public.league_members (league_id, user_id, role) values
    (l_id, c_uid, 'commissioner'), (l_id, a_uid, 'member');

  select draft_started_at into st from public.leagues where id = l_id;
  out := out || format(E'T2 before start          -> %s  %s\n', st, case when st is null then 'PASS' else 'FAIL' end);

  update public.leagues set draft_status = 'in_progress' where id = l_id;
  select draft_started_at into st from public.leagues where id = l_id;
  out := out || format(E'T3 flip to in_progress   -> %s  %s\n', st, case when st = now() then 'PASS' else 'FAIL' end);

  update public.leagues set draft_started_at = '2000-01-01' where id = l_id;
  out := out || format(E'T4 direct write          -> %s  %s\n',
    (select draft_started_at from public.leagues where id = l_id),
    case when (select draft_started_at from public.leagues where id = l_id) = st then 'PASS' else 'FAIL' end);

  begin
    update public.leagues set pick_seconds = 90 where id = l_id;
    out := out || E'T5 pick_seconds after start -> accepted  FAIL\n';
  exception when others then
    out := out || format(E'T5 pick_seconds after start -> %s  %s\n', sqlstate,
      case when sqlerrm like 'pick_seconds_locked%' then 'PASS' else 'FAIL (' || sqlerrm || ')' end);
  end;

  select * into rec from public.get_draft_clock(l_id);
  out := out || format(E'C1 clock                  -> running=%s picks=%s deadline-start=%s  %s\n',
    rec.clock_running, rec.picks_made, rec.deadline_at - rec.turn_started_at,
    case when rec.clock_running and rec.picks_made = 0 and rec.turn_started_at = st
          and rec.deadline_at = st + interval '45 seconds' then 'PASS' else 'FAIL' end);

  insert into public.drafts (league_id, user_id, symbol, entry_price, quantity, round, pick_number, pick_source, recorded_at)
  values (l_id, c_uid, 'AAPL', 1, 1, 1, 1, 'manual', now() + interval '5 seconds');
  select * into rec from public.get_draft_clock(l_id);
  out := out || format(E'C2 after a pick           -> picks=%s anchor=+%s  %s\n', rec.picks_made, rec.turn_started_at - st,
    case when rec.picks_made = 1 and rec.turn_started_at = now() + interval '5 seconds'
          and rec.deadline_at = now() + interval '50 seconds' then 'PASS' else 'FAIL' end);

  begin
    insert into public.drafts (league_id, user_id, symbol, entry_price, quantity, round, pick_number, pick_source)
    values (l_id, c_uid, 'MSFT', 1, 1, 1, 1, 'auto_queue');
    out := out || E'R1 duplicate pick_number -> accepted  FAIL\n';
  exception when others then
    out := out || format(E'R1 duplicate pick_number -> %s rows=%s  %s\n', sqlstate,
      (select count(*) from public.drafts where league_id = l_id),
      case when sqlstate = '23505' then 'PASS' else 'FAIL (' || sqlerrm || ')' end);
  end;

  begin
    insert into public.drafts (league_id, user_id, symbol, entry_price, quantity, round, pick_number, pick_source)
    values (l_id, a_uid, 'MSFT', 1, 1, 1, 2, 'auto');
    out := out || E'R2 pick_source=auto     -> accepted  FAIL\n';
  exception when others then
    out := out || format(E'R2 pick_source=auto     -> %s  %s\n', sqlstate, case when sqlstate = '23514' then 'PASS' else 'FAIL (' || sqlerrm || ')' end);
  end;

  -- ---- service_role (the edge functions' admin client) ----------------------
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  begin
    select count(*) into n from public.overdue_draft_turns() o
      join public.leagues l on l.id = o.league_id where not l.pick_clock_enabled;
    out := out || format(E'S1 overdue lists unclocked = %s  %s\n', n, case when n = 0 then 'PASS' else 'FAIL' end);
  exception when others then
    out := out || format(E'S1 overdue as service_role -> %s FAIL (%s)\n', sqlstate, sqlerrm);
  end;

  -- S2: the best-available search against the REAL catalog. Largest-first,
  --     every row active + draftable + inside the bracket, the excluded
  --     symbol absent. (Legality itself is validatePick's job, in the edge
  --     function; this proves the search feeding it respects its filters.)
  begin
    select count(*),
           count(*) filter (where not (s.active is true and s.is_draftable is true
                                       and r.last_price between 10 and 500 and r.symbol <> 'AAPL')),
           bool_and(r.market_cap is not null)
      into n, res_bad, res_ok
      from public.auto_pick_search_candidates(10, 500, null, true, array['AAPL'], 25) r
      join public.symbols s on s.symbol = r.symbol;
    select coalesce(bool_and(ordered), true) into res_sorted from (
      select market_cap <= lag(market_cap) over (order by ord) or lag(market_cap) over (order by ord) is null as ordered
        from public.auto_pick_search_candidates(10, 500, null, true, array['AAPL'], 25)
             with ordinality as x(symbol, last_price, is_draftable, market_cap, ord)) y;
    out := out || format(E'S2 search: rows=%s bad=%s sorted=%s  %s\n', n, res_bad, res_sorted,
      case when n > 0 and res_bad = 0 and res_sorted then 'PASS' else 'FAIL' end);
  exception when others then
    out := out || format(E'S2 search as service_role -> %s FAIL (%s)\n', sqlstate, sqlerrm);
  end;

  -- ---- authenticated: member A ---------------------------------------------
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', a_uid, 'role', 'authenticated')::text, true);

  begin
    res := public.set_draft_queue(l_id, array[' msft', 'aapl', 'MSFT', '']);
    out := out || format(E'A1 set queue              -> %s  %s\n', res,
      case when res = '{"ok": true, "symbols": ["MSFT", "AAPL"]}'::jsonb then 'PASS' else 'FAIL' end);
  exception when others then
    out := out || format(E'A1 set queue              -> %s FAIL (%s)\n', sqlstate, sqlerrm);
  end;

  begin
    res := public.set_draft_queue(l_id, array['MSFT', 'ZZZZQX']);
    select count(*) into n from public.draft_queue where league_id = l_id;
    out := out || format(E'A2 unknown symbol         -> %s rows=%s  %s\n', res->>'reason', n,
      case when res->>'reason' = 'unknown_symbols' and n = 2 then 'PASS' else 'FAIL' end);
  exception when others then
    out := out || format(E'A2 unknown symbol         -> %s FAIL (%s)\n', sqlstate, sqlerrm);
  end;

  begin
    select count(*) into n from public.draft_queue where league_id = l_id;
    out := out || format(E'A3 owner reads own queue  -> rows=%s  %s\n', n, case when n = 2 then 'PASS' else 'FAIL' end);
  exception when others then
    out := out || format(E'A3 owner reads own queue  -> %s FAIL (%s)\n', sqlstate, sqlerrm);
  end;

  begin
    insert into public.draft_queue (league_id, user_id, symbol, position) values (l_id, a_uid, 'NVDA', 3);
    out := out || E'A4 direct queue INSERT   -> accepted  FAIL\n';
  exception when others then
    out := out || format(E'A4 direct queue INSERT   -> %s  %s\n', sqlstate,
      case when sqlstate = '42501' then 'PASS' else 'FAIL (' || sqlerrm || ')' end);
  end;

  begin
    select count(*) into n from public.overdue_draft_turns();
    out := out || E'A6 authenticated overdue -> allowed  FAIL\n';
  exception when others then
    out := out || format(E'A6 authenticated overdue -> %s  %s\n', sqlstate,
      case when sqlerrm like 'permission denied for function%' then 'PASS' else 'FAIL (' || sqlerrm || ')' end);
  end;

  -- ---- authenticated: the commissioner (same league, different manager) -----
  perform set_config('request.jwt.claims', json_build_object('sub', c_uid, 'role', 'authenticated')::text, true);
  begin
    update public.leagues set pick_clock_enabled = false where id = l_id;
    out := out || format(E'A5 commissioner disables clock -> enabled=%s  %s\n',
      (select pick_clock_enabled from public.leagues where id = l_id),
      case when (select pick_clock_enabled from public.leagues where id = l_id) then 'PASS' else 'FAIL' end);
  exception when others then
    out := out || format(E'A5 commissioner disables clock -> %s FAIL (%s)\n', sqlstate, sqlerrm);
  end;
  begin
    select count(*) into n from public.draft_queue where league_id = l_id;
    out := out || format(E'A7 other member sees queue -> rows=%s  %s\n', n, case when n = 0 then 'PASS' else 'FAIL' end);
  exception when others then
    out := out || format(E'A7 other member sees queue -> %s FAIL (%s)\n', sqlstate, sqlerrm);
  end;

  -- ---- authenticated: an outsider ------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', x_uid, 'role', 'authenticated')::text, true);
  begin
    res := public.set_draft_queue(l_id, array['AAPL']);
    out := out || format(E'A8 non-member queue       -> %s  %s\n', res->>'reason',
      case when res->>'reason' = 'not_a_member' then 'PASS' else 'FAIL' end);
  exception when others then
    out := out || format(E'A8 non-member queue       -> %s FAIL (%s)\n', sqlstate, sqlerrm);
  end;

  -- ---- anon ----------------------------------------------------------------
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  begin
    perform * from public.get_draft_clock(l_id);
    out := out || E'N1 anon get_draft_clock  -> allowed  FAIL\n';
  exception when others then
    begin
      perform public.set_draft_queue(l_id, array['AAPL']);
      out := out || E'N1 anon set_draft_queue  -> allowed  FAIL\n';
    exception when others then
      out := out || format(E'N1 anon clock + queue    -> %s  %s\n', sqlstate,
        case when sqlerrm like 'permission denied for function%' then 'PASS' else 'FAIL (' || sqlerrm || ')' end);
    end;
  end;

  raise exception 'DRAFT PICK CLOCK EFFECT TEST RESULTS (all rolled back):%', out;
end;
$$;
