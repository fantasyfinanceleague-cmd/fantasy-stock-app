-- ============================================================================
-- DRAFT ORDER MODES EFFECT TEST — run in the Supabase SQL editor AFTER `db push`
-- of 20261013000000_draft_order_modes.sql. Read-only in effect: NOTHING persists.
-- ============================================================================
-- Same shape as docs/security/draft-pick-clock-effect-test.sql:
--   * The SQL editor shows only the LAST statement's output and a failing
--     statement aborts the transaction, so every case runs in its own
--     BEGIN/EXCEPTION sub-block and records its outcome, and the block ENDS BY
--     RAISING — rolling back the fixture and every write, and putting the
--     result table in the editor's error panel.
--   * Role/claims switch with set_config(..., true), the mechanism PostgREST
--     uses, so auth.uid(), RLS and EXECUTE grants behave as for a real call.
--     Cases run in privilege order (postgres fixture, service_role,
--     authenticated, anon): nothing depends on switching back UP.
--   * now() is frozen for the whole transaction, so time is expressed through
--     each fixture league's draft_date (5h away = open; 30 min away = inside
--     the finalize hour). Real elapsed-time behaviour is proven on real
--     Postgres by supabase/tests/draft_order_modes.pglite.test.ts, which runs
--     THIS file too.
--   * Grant cases match the "permission denied" MESSAGE, not only SQLSTATE
--     42501 (a function's own raise can share that code).
--
-- EXPECTED OUTPUT (the final "ERROR:" text): every line ends in PASS.
--   G1  get_draft_order / set_draft_order: authenticated only       PASS
--   G2  finalize_due_draft_orders / draft_order_notify_due: service  PASS
--   G3  every internal / trigger function: no API role              PASS
--   G4  order tables: no anon; no client or service_role writes     PASS
--   B1  every started league has a LOCKED order                     PASS (count shown)
--   B2  every in_progress order is an exact permutation of members  PASS (count shown)
--   F1  random league: nothing generated before draft_date - 1h     PASS
--   F2  locked order: a direct write is refused (even postgres)     PASS
--   S1  service_role cannot write league_draft_order                PASS
--   S2  service_role runs finalize_due_draft_orders                 PASS
--   A1  member reads a random order before the reveal: hidden       PASS
--   A2  member read inside the hour reveals + finalizes             PASS
--   A3  a second read returns the SAME order                        PASS
--   A4  one "order is set" notice per human, owner-only             PASS
--   A5  manual: first read seeds an open order                      PASS
--   A6  manual: a member cannot save the order                      PASS
--   A7  manual: a non-permutation is refused                        PASS
--   A8  manual: the commissioner saves a permutation                PASS
--   A9  manual inside the hour: save refused ('finalized')          PASS
--   A10 mode change inside the hour: draft_order_reveal_passed      PASS
--   A11 manual -> random before the hour discards the manual order  PASS
--   A12 mid-draft leave refused (draft_in_progress)                 PASS
--   A13 outsider: not_a_member, and sees no order rows              PASS
--   N1  anon cannot call get_draft_order / set_draft_order          PASS
-- Any FAIL line is a real finding: stop and report it.
-- ============================================================================
do $$
declare
  c_uid  text := gen_random_uuid()::text;   -- commissioner
  a_uid  text := gen_random_uuid()::text;
  b_uid  text := gen_random_uuid()::text;
  d_uid  text := gen_random_uuid()::text;
  x_uid  text := gen_random_uuid()::text;   -- outsider
  l_rand uuid;   -- random, draft 30 min away (inside the finalize hour)
  l_far  uuid;   -- random, draft 5h away
  l_man  uuid;   -- manual, draft 5h away
  l_manf uuid;   -- manual, draft 30 min away
  l_live uuid;   -- started
  res    jsonb;
  res2   jsonb;
  acl    text;
  n      int;
  n2     int;
  out    text := E'\n';
begin
  -- ---- G: grants -------------------------------------------------------------
  select string_agg(proname || '=' || coalesce(proacl::text, 'NULL'), ' ') into acl
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and proname in ('get_draft_order', 'set_draft_order')
     and (proacl::text !~ 'authenticated=X' or proacl::text ~ '(anon|service_role)=' or proacl::text ~ '(^|[{,])=X');
  out := out || format(E'G1 client RPC grants       %s  %s\n', coalesce(acl, 'ok'), case when acl is null then 'PASS' else 'FAIL' end);

  select string_agg(proname || '=' || coalesce(proacl::text, 'NULL'), ' ') into acl
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and proname in ('finalize_due_draft_orders', 'draft_order_notify_due')
     and (proacl::text !~ 'service_role=X' or proacl::text ~ '(anon|authenticated)=' or proacl::text ~ '(^|[{,])=X');
  out := out || format(E'G2 service RPC grants      %s  %s\n', coalesce(acl, 'ok'), case when acl is null then 'PASS' else 'FAIL' end);

  select count(*), string_agg(proname || '=' || coalesce(proacl::text, 'NULL'), ' ') into n, acl
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public'
     and proname in ('_draft_order_is_due', '_draft_order_materialize', '_draft_order_notify_members',
                     '_draft_order_finalize', '_draft_order_sync', '_draft_order_matches_members',
                     '_draft_order_reconcile', 'enforce_league_draft_order_rows', 'enforce_league_draft_order_meta',
                     'enforce_leagues_draft_order_mode', 'lock_draft_order_on_start', 'sync_draft_order_on_member_change')
     and (proacl is null or proacl::text ~ '(anon|authenticated|service_role)=' or proacl::text ~ '(^|[{,])=X');
  out := out || format(E'G3 internal fn grants      %s  %s\n', coalesce(acl, 'ok'), case when n = 0 then 'PASS' else 'FAIL' end);

  select string_agg(relname || '=' || coalesce(relacl::text, 'NULL'), ' ') into acl
    from pg_class
   where relname in ('league_draft_order', 'league_draft_order_meta', 'league_notifications')
     and relnamespace = 'public'::regnamespace
     and (relacl::text ~ 'anon=' or relacl::text ~ 'authenticated=[^/]*[awdDxtm]' or relacl::text ~ 'service_role=[^/]*[awdDxtm]'
          or relacl::text !~ 'authenticated=r/' or relacl::text !~ 'service_role=r/');
  out := out || format(E'G4 table grants            %s  %s\n', coalesce(acl, 'ok'), case when acl is null then 'PASS' else 'FAIL' end);

  -- ---- B: the backfill / start invariant over REAL prod data ----------------
  select count(*) into n from public.leagues l
   where coalesce(l.draft_status, 'not_started') <> 'not_started'
     and not exists (select 1 from public.league_draft_order_meta m where m.league_id = l.id and m.state = 'locked');
  out := out || format(E'B1 started w/o locked order = %s (started = %s)  %s\n', n,
    (select count(*) from public.leagues where coalesce(draft_status, 'not_started') <> 'not_started'),
    case when n = 0 then 'PASS' else 'FAIL' end);

  select count(*) into n from public.leagues l
   where l.draft_status = 'in_progress' and not public._draft_order_matches_members(l.id);
  out := out || format(E'B2 in_progress order != members = %s (in_progress = %s)  %s\n', n,
    (select count(*) from public.leagues where draft_status = 'in_progress'),
    case when n = 0 then 'PASS' else 'FAIL' end);

  -- ---- fixture (as the editor's own role) -----------------------------------
  insert into public.leagues (name, commissioner_id, invite_code, num_participants, draft_status, draft_date)
  values ('__ORDER_RAND__', c_uid, 'ORD-' || gen_random_uuid(), 8, 'not_started', now() + interval '30 minutes')
  returning id into l_rand;
  insert into public.leagues (name, commissioner_id, invite_code, num_participants, draft_status, draft_date)
  values ('__ORDER_FAR__', c_uid, 'ORD-' || gen_random_uuid(), 8, 'not_started', now() + interval '5 hours')
  returning id into l_far;
  insert into public.leagues (name, commissioner_id, invite_code, num_participants, draft_status, draft_date, draft_order_mode)
  values ('__ORDER_MAN__', c_uid, 'ORD-' || gen_random_uuid(), 8, 'not_started', now() + interval '5 hours', 'manual')
  returning id into l_man;
  insert into public.leagues (name, commissioner_id, invite_code, num_participants, draft_status, draft_date, draft_order_mode)
  values ('__ORDER_MANF__', c_uid, 'ORD-' || gen_random_uuid(), 8, 'not_started', now() + interval '5 hours', 'manual')
  returning id into l_manf;
  insert into public.leagues (name, commissioner_id, invite_code, num_participants, draft_status, draft_date)
  values ('__ORDER_LIVE__', c_uid, 'ORD-' || gen_random_uuid(), 8, 'not_started', now() + interval '5 hours')
  returning id into l_live;
  insert into public.league_members (league_id, user_id, role)
  select l, u, case when u = c_uid then 'commissioner' else 'member' end
    from unnest(array[l_rand, l_far, l_man, l_manf, l_live]) l,
         unnest(array[c_uid, a_uid, b_uid, d_uid]) u;

  -- F1: l_rand is inside the hour with 4 members, so the join trigger already
  -- finalized it; l_far (5h out) must have NOTHING — a random order does not
  -- exist before draft_date - 1h.
  select count(*) into n from public.league_draft_order_meta where league_id = l_far;
  out := out || format(E'F1 random, 5h out: meta rows = %s  %s\n', n, case when n = 0 then 'PASS' else 'FAIL' end);

  -- The manual-finalize league: seed it (as if its commissioner opened it)
  -- while 5h out, THEN move its draft inside the hour.
  perform public._draft_order_sync(l_manf, true);
  update public.leagues set draft_date = now() + interval '30 minutes' where id = l_manf;

  update public.leagues set draft_status = 'in_progress' where id = l_live;
  begin
    update public.league_draft_order set position = position where league_id = l_live;
    out := out || E'F2 locked order direct write -> accepted  FAIL\n';
  exception when others then
    out := out || format(E'F2 locked order direct write -> %s  %s\n', sqlstate,
      case when sqlerrm like 'draft_order_locked%' then 'PASS' else 'FAIL (' || sqlerrm || ')' end);
  end;

  -- ---- service_role ---------------------------------------------------------
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  begin
    insert into public.league_draft_order (league_id, position, user_id) values (l_far, 1, x_uid);
    out := out || E'S1 service_role order INSERT -> accepted  FAIL\n';
  exception when others then
    out := out || format(E'S1 service_role order INSERT -> %s  %s\n', sqlstate,
      case when sqlerrm like 'permission denied%' then 'PASS' else 'FAIL (' || sqlerrm || ')' end);
  end;
  begin
    n := public.finalize_due_draft_orders();
    out := out || format(E'S2 finalize_due_draft_orders -> %s  PASS\n', n);
  exception when others then
    out := out || format(E'S2 finalize_due_draft_orders -> %s FAIL (%s)\n', sqlstate, sqlerrm);
  end;

  -- ---- authenticated: member A ---------------------------------------------
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', a_uid, 'role', 'authenticated')::text, true);

  res := public.get_draft_order(l_far);
  out := out || format(E'A1 before reveal          -> revealed=%s order=%s  %s\n', res->>'revealed', res->'order',
    case when (res->>'ok')::boolean and not (res->>'revealed')::boolean and res->'order' = 'null'::jsonb
          and (res->>'finalize_at')::timestamptz = now() + interval '4 hours' then 'PASS' else 'FAIL ' || res::text end);

  res := public.get_draft_order(l_rand);
  out := out || format(E'A2 inside the hour        -> revealed=%s finalized=%s n=%s  %s\n',
    res->>'revealed', res->>'finalized', jsonb_array_length(coalesce(res->'order', '[]')),
    case when (res->>'revealed')::boolean and (res->>'finalized')::boolean and not (res->>'locked')::boolean
          and jsonb_array_length(res->'order') = 4 then 'PASS' else 'FAIL ' || res::text end);
  res2 := public.get_draft_order(l_rand);
  out := out || format(E'A3 second read same order -> %s\n', case when res2->'order' = res->'order' then 'PASS' else 'FAIL' end);

  select count(*) into n from public.league_notifications where league_id = l_rand;
  out := out || format(E'A4 own notice rows        -> %s  %s\n', n, case when n = 1 then 'PASS' else 'FAIL' end);

  res := public.set_draft_order(l_man, array[a_uid, b_uid, c_uid, d_uid]);
  out := out || format(E'A6 member saves order     -> %s  %s\n', res->>'reason',
    case when res->>'reason' = 'not_commissioner' then 'PASS' else 'FAIL' end);

  begin
    delete from public.league_members where league_id = l_live and user_id = a_uid;
    out := out || E'A12 mid-draft leave       -> accepted  FAIL\n';
  exception when others then
    out := out || format(E'A12 mid-draft leave       -> %s  %s\n', sqlstate,
      case when sqlerrm like 'draft_in_progress%' then 'PASS' else 'FAIL (' || sqlerrm || ')' end);
  end;

  -- ---- authenticated: the commissioner --------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', c_uid, 'role', 'authenticated')::text, true);
  res := public.get_draft_order(l_man);
  out := out || format(E'A5 manual first read      -> state=%s can_edit=%s n=%s  %s\n',
    res->>'state', res->>'can_edit_order', jsonb_array_length(coalesce(res->'order', '[]')),
    case when res->>'state' = 'open' and (res->>'can_edit_order')::boolean and jsonb_array_length(res->'order') = 4
         then 'PASS' else 'FAIL ' || res::text end);

  res := public.set_draft_order(l_man, array[a_uid, a_uid, c_uid, d_uid]);
  out := out || format(E'A7 duplicate id           -> %s  %s\n', res->>'reason',
    case when res->>'reason' = 'not_a_permutation' then 'PASS' else 'FAIL' end);

  res := public.set_draft_order(l_man, array[d_uid, b_uid, a_uid, c_uid]);
  out := out || format(E'A8 commissioner saves     -> ok=%s  %s\n', res->>'ok',
    case when (res->>'ok')::boolean
          and (select array_agg(user_id order by position) from public.league_draft_order where league_id = l_man)
              = array[d_uid, b_uid, a_uid, c_uid] then 'PASS' else 'FAIL ' || res::text end);

  res := public.set_draft_order(l_manf, array[d_uid, b_uid, a_uid, c_uid]);
  out := out || format(E'A9 save inside the hour   -> %s  %s\n', res->>'reason',
    case when res->>'reason' = 'finalized' then 'PASS' else 'FAIL ' || res::text end);

  begin
    update public.leagues set draft_order_mode = 'random' where id = l_manf;
    out := out || E'A10 mode change in hour   -> accepted  FAIL\n';
  exception when others then
    out := out || format(E'A10 mode change in hour   -> %s  %s\n', sqlstate,
      case when sqlerrm like 'draft_order_reveal_passed%' then 'PASS' else 'FAIL (' || sqlerrm || ')' end);
  end;

  begin
    update public.leagues set draft_order_mode = 'random' where id = l_man;
    select count(*) into n from public.league_draft_order where league_id = l_man;
    out := out || format(E'A11 manual -> random       -> rows=%s  %s\n', n, case when n = 0 then 'PASS' else 'FAIL' end);
  exception when others then
    out := out || format(E'A11 manual -> random       -> %s FAIL (%s)\n', sqlstate, sqlerrm);
  end;

  -- ---- authenticated: an outsider ------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', x_uid, 'role', 'authenticated')::text, true);
  res := public.get_draft_order(l_rand);
  select count(*) into n from public.league_draft_order where league_id = l_rand;
  select count(*) into n2 from public.league_notifications where league_id = l_rand;
  out := out || format(E'A13 outsider              -> %s rows=%s notices=%s  %s\n', res->>'reason', n, n2,
    case when res->>'reason' = 'not_a_member' and n = 0 and n2 = 0 then 'PASS' else 'FAIL' end);

  -- ---- anon ----------------------------------------------------------------
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  begin
    perform public.get_draft_order(l_rand);
    out := out || E'N1 anon get_draft_order  -> allowed  FAIL\n';
  exception when others then
    begin
      perform public.set_draft_order(l_man, array[c_uid]);
      out := out || E'N1 anon set_draft_order  -> allowed  FAIL\n';
    exception when others then
      out := out || format(E'N1 anon get/set order     -> %s  %s\n', sqlstate,
        case when sqlerrm like 'permission denied for function%' then 'PASS' else 'FAIL (' || sqlerrm || ')' end);
    end;
  end;

  raise exception 'DRAFT ORDER MODES EFFECT TEST RESULTS (all rolled back):%', out;
end;
$$;
