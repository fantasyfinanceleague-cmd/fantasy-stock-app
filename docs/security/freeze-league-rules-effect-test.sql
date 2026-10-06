-- ============================================================================
-- FREEZE LEAGUE RULES EFFECT TEST — run in the Supabase SQL editor AFTER
-- `db push` of 20261104000000_freeze_league_rules_after_draft_start.sql.
-- Read-only in effect: NOTHING persists.
-- ============================================================================
-- Same shape as docs/security/draft-order-modes-effect-test.sql:
--   * The SQL editor shows only the LAST statement's output and a failing
--     statement aborts the transaction, so every case runs in its own
--     BEGIN/EXCEPTION sub-block and records its outcome, and the block ENDS BY
--     RAISING — rolling back the fixtures and every write, and putting the
--     result table in the editor's error panel. Never add a `commit`.
--   * Role/claims switch with set_config(..., true), the mechanism PostgREST
--     uses, so auth.uid() and RLS behave as for a real call. Cases run in
--     privilege order (postgres fixture, service_role, authenticated): nothing
--     depends on switching back UP. Switches are made OUTSIDE the per-case
--     sub-blocks (a case that raises rolls back its subtransaction, which
--     would also revert a switch made inside it).
--   * Fixture leagues are named __FREEZE_*__ with random invite codes. Their
--     draft_date is 5h out, so the draft-order triggers never finalize them.
--   * supabase/tests/freeze_league_rules.pglite.test.ts runs THIS file
--     verbatim on real Postgres and requires every line to PASS.
--
-- EXPECTED OUTPUT (the final "ERROR:" text): every line ends in PASS.
--   G1  both triggers present and enabled                           PASS
--   G2  both functions: no PUBLIC/anon/authenticated EXECUTE,
--       slots fn SECURITY DEFINER, search_path pinned               PASS
--   V1  service_role: slot UPDATE on a completed league -> 1 row    PASS
--   V2  service_role: num_rounds change on a completed league       PASS
--   P1  commissioner, pre-draft: slot UPDATE -> 1 row               PASS
--   P2  commissioner, pre-draft: num_rounds change -> 1 row         PASS
--   S1  commissioner, completed: slot INSERT -> league_slots_locked PASS
--   S2  commissioner, completed: slot UPDATE -> league_slots_locked PASS
--   S3  commissioner, completed: slot DELETE -> league_slots_locked PASS
--   R1  commissioner, completed: num_rounds -> league_rules_locked  PASS
--   R2  commissioner, completed: num_weeks  -> league_rules_locked  PASS
--   R3  commissioner, completed: same-value settings patch + rename
--       (the league-settings.tsx shape) -> 1 row                    PASS
--   D1  commissioner, completed -> not_started
--       -> league_draft_status_locked                               PASS
-- ============================================================================
do $$
declare
  c_uid   text := gen_random_uuid()::text;   -- the fixture commissioner
  m_uid   text := gen_random_uuid()::text;   -- a fixture member
  l_open  uuid;                              -- not_started
  l_done  uuid;                              -- completed
  s_open  uuid;
  s_done  uuid;
  n       int;
  acl     text;
  out     text := E'\n';
begin
  -- ---- G: catalog -----------------------------------------------------------
  select count(*) into n from pg_trigger
   where tgname in ('trg_league_draft_slots_freeze', 'trg_leagues_freeze_rules') and tgenabled = 'O';
  out := out || format(E'G1 triggers present+enabled = %s/2  %s\n', n, case when n = 2 then 'PASS' else 'FAIL' end);

  select string_agg(proname || ':' || coalesce(proacl::text, 'NULL') || ':' || prosecdef::text
                    || ':' || coalesce(array_to_string(proconfig, ','), 'NOCONFIG'), ' ') into acl
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and proname in ('enforce_league_draft_slots_frozen', 'enforce_league_rules_frozen_after_draft_start')
     and (proacl is null
          or proacl::text ~ '(anon|authenticated)='
          or proacl::text ~ '(^|[{,])=X'
          or not coalesce(proconfig @> array['search_path=public, pg_temp'], false)
          or (proname = 'enforce_league_draft_slots_frozen') <> prosecdef);
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and proname in ('enforce_league_draft_slots_frozen', 'enforce_league_rules_frozen_after_draft_start');
  out := out || format(E'G2 fn grants/secdef/path   %s (found %s/2)  %s\n', coalesce(acl, 'ok'), n,
    case when acl is null and n = 2 then 'PASS' else 'FAIL' end);

  -- ---- fixture (as the editor's own role: auth.uid() IS NULL, exempt) -------
  insert into public.leagues (name, commissioner_id, invite_code, num_participants, num_rounds, num_weeks,
                              draft_status, draft_date)
  values ('__FREEZE_OPEN__', c_uid, 'FRZ-' || gen_random_uuid(), 8, 6, 11, 'not_started', now() + interval '5 hours')
  returning id into l_open;
  insert into public.leagues (name, commissioner_id, invite_code, num_participants, num_rounds, num_weeks,
                              draft_status, draft_date)
  values ('__FREEZE_DONE__', c_uid, 'FRZ-' || gen_random_uuid(), 8, 6, 11, 'not_started', now() + interval '5 hours')
  returning id into l_done;
  insert into public.league_members (league_id, user_id, role)
  select l, u, case when u = c_uid then 'commissioner' else 'member' end
    from unnest(array[l_open, l_done]) l, unnest(array[c_uid, m_uid]) u;
  insert into public.league_draft_slots (league_id, slot_index, slot_count, price_min, price_max)
  values (l_open, 0, 6, null, null) returning id into s_open;
  insert into public.league_draft_slots (league_id, slot_index, slot_count, price_min, price_max)
  values (l_done, 0, 3, null, 50) returning id into s_done;
  insert into public.league_draft_slots (league_id, slot_index, slot_count, price_min, price_max)
  values (l_done, 1, 3, 50, null);
  update public.leagues set draft_status = 'completed' where id = l_done;

  -- ---- V: service_role keeps full rights -------------------------------------
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  begin
    update public.league_draft_slots set slot_count = 2 where id = s_done;
    get diagnostics n = row_count;
    out := out || format(E'V1 service slot UPDATE (completed) rows=%s  %s\n', n, case when n = 1 then 'PASS' else 'FAIL' end);
  exception when others then
    out := out || format(E'V1 service slot UPDATE (completed) -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;
  begin
    update public.leagues set num_rounds = 7 where id = l_done;
    get diagnostics n = row_count;
    out := out || format(E'V2 service num_rounds (completed) rows=%s  %s\n', n, case when n = 1 then 'PASS' else 'FAIL' end);
  exception when others then
    out := out || format(E'V2 service num_rounds (completed) -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;

  -- ---- the commissioner (authenticated, real RLS) ----------------------------
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', c_uid, 'role', 'authenticated')::text, true);

  begin
    update public.league_draft_slots set slot_count = 5 where id = s_open;
    get diagnostics n = row_count;
    out := out || format(E'P1 pre-draft slot UPDATE rows=%s  %s\n', n, case when n = 1 then 'PASS' else 'FAIL' end);
  exception when others then
    out := out || format(E'P1 pre-draft slot UPDATE -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;
  begin
    update public.leagues set num_rounds = 5 where id = l_open;
    get diagnostics n = row_count;
    out := out || format(E'P2 pre-draft num_rounds rows=%s  %s\n', n, case when n = 1 then 'PASS' else 'FAIL' end);
  exception when others then
    out := out || format(E'P2 pre-draft num_rounds -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;

  begin
    insert into public.league_draft_slots (league_id, slot_index, slot_count) values (l_done, 9, 1);
    out := out || E'S1 completed slot INSERT -> allowed  FAIL\n';
  exception when others then
    out := out || format(E'S1 completed slot INSERT -> %s  %s\n', sqlstate,
      case when sqlstate = '42501' and sqlerrm like 'league_slots_locked:%' then 'PASS' else 'FAIL (' || sqlerrm || ')' end);
  end;
  begin
    update public.league_draft_slots set price_max = 10 where id = s_done;
    get diagnostics n = row_count;
    out := out || format(E'S2 completed slot UPDATE -> allowed rows=%s  FAIL\n', n);
  exception when others then
    out := out || format(E'S2 completed slot UPDATE -> %s  %s\n', sqlstate,
      case when sqlstate = '42501' and sqlerrm like 'league_slots_locked:%' then 'PASS' else 'FAIL (' || sqlerrm || ')' end);
  end;
  begin
    delete from public.league_draft_slots where league_id = l_done;
    get diagnostics n = row_count;
    out := out || format(E'S3 completed slot DELETE -> allowed rows=%s  FAIL\n', n);
  exception when others then
    out := out || format(E'S3 completed slot DELETE -> %s  %s\n', sqlstate,
      case when sqlstate = '42501' and sqlerrm like 'league_slots_locked:%' then 'PASS' else 'FAIL (' || sqlerrm || ')' end);
  end;

  begin
    update public.leagues set num_rounds = 9 where id = l_done;
    get diagnostics n = row_count;
    out := out || format(E'R1 completed num_rounds -> allowed rows=%s  FAIL\n', n);
  exception when others then
    out := out || format(E'R1 completed num_rounds -> %s  %s\n', sqlstate,
      case when sqlstate = '42501' and sqlerrm like 'league_rules_locked:%(num_rounds)' then 'PASS' else 'FAIL (' || sqlerrm || ')' end);
  end;
  begin
    update public.leagues set num_weeks = 14 where id = l_done;
    get diagnostics n = row_count;
    out := out || format(E'R2 completed num_weeks -> allowed rows=%s  FAIL\n', n);
  exception when others then
    out := out || format(E'R2 completed num_weeks -> %s  %s\n', sqlstate,
      case when sqlstate = '42501' and sqlerrm like 'league_rules_locked:%(num_weeks)' then 'PASS' else 'FAIL (' || sqlerrm || ')' end);
  end;
  begin
    -- The league-settings.tsx patch with every rule at its CURRENT value (num_rounds is 7 after V2).
    update public.leagues l
       set name = '__FREEZE_DONE_RENAMED__', num_participants = l.num_participants, num_rounds = l.num_rounds,
           allow_undraftable = l.allow_undraftable, stake_mode = l.stake_mode,
           notional_per_slot = l.notional_per_slot, budget_amount = l.budget_amount
     where l.id = l_done;
    get diagnostics n = row_count;
    out := out || format(E'R3 completed same-value patch rows=%s  %s\n', n, case when n = 1 then 'PASS' else 'FAIL' end);
  exception when others then
    out := out || format(E'R3 completed same-value patch -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;

  begin
    update public.leagues set draft_status = 'not_started' where id = l_done;
    get diagnostics n = row_count;
    out := out || format(E'D1 completed -> not_started -> allowed rows=%s  FAIL\n', n);
  exception when others then
    out := out || format(E'D1 completed -> not_started -> %s  %s\n', sqlstate,
      case when sqlstate = '42501' and sqlerrm like 'league_draft_status_locked:%' then 'PASS' else 'FAIL (' || sqlerrm || ')' end);
  end;

  raise exception 'FREEZE LEAGUE RULES EFFECT TEST RESULTS (all rolled back):%', out;
end;
$$;
