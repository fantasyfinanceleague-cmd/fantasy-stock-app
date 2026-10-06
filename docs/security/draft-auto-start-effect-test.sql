-- ============================================================================
-- DRAFT AUTO-START EFFECT TEST — run in the Supabase SQL editor AFTER `db push`
-- of 20261109000000_draft_auto_start.sql, 20261109000001_draft_status_server_only.sql
-- and 20261109000002_draft_autopick_sweep_auto_start.sql.
-- Read-only in effect: NOTHING persists.
-- ============================================================================
-- Same shape as docs/security/freeze-league-rules-effect-test.sql:
--   * ONE DO block. The SQL editor shows only the LAST statement's output and a
--     failing statement aborts the transaction, so every case runs in its own
--     BEGIN/EXCEPTION sub-block and records its outcome, and the block ENDS BY
--     RAISING — rolling back the fixtures and every write, and putting the
--     result table in the editor's error panel. Never add a `commit`.
--   * Cases run in privilege order (postgres fixture/owner, then
--     authenticated via set_config(..., true), the mechanism PostgREST uses).
--     Nothing switches back UP; switches are made OUTSIDE the sub-blocks.
--   * Fixture leagues are named __AUTOSTART_*__ with random invite codes.
--   * supabase/tests/draft_auto_start.pglite.test.ts runs THIS file verbatim on
--     real Postgres and requires every line to PASS (C1 reads SKIP there: PGlite
--     has no pg_cron).
--
-- SUPERSEDES two lines of docs/security/freeze-league-rules-effect-test.sql:
-- after 20261109000001 its R7 (a user-session completing UPDATE -> 1 row) and
-- D1 (expects 'league_draft_status_locked') are refused with
-- 'draft_status_server_only' instead. That file is the record of the
-- 20261104000000 release; do not re-run it as a gate after this one.
--
-- EXPECTED OUTPUT (the final "ERROR:" text): every line ends in PASS.
--   G1  4 functions: postgres + service_role only, DEFINER where expected,
--       search_path pinned                                          PASS
--   G2  draft_start_blocks: RLS on, no anon/authenticated grant,
--       service_role SELECT-only                                    PASS
--   G3  both leagues triggers enabled; freeze fn is server-only     PASS
--   G4  draft_start_grace() = 15 minutes                            PASS
--   C1  the cron command guards on BOTH overdue_draft_turns() and
--       due_draft_starts()                                          PASS
--   D1  due_draft_starts: lists the due league, not the future or
--       the missed one                                              PASS
--   D2  a blocked attempt backs the due league off                  PASS
--   S1  start_league_draft: past the grace -> missed                PASS
--   S2  start_league_draft: before draft_date -> not_due            PASS
--   S3  start_league_draft: 3 members -> blocked                    PASS
--   S4  start_league_draft: stale expectation -> changed, no flip   PASS
--   S5  start_league_draft: exact expectation -> started, order
--       locked, clock anchored, block row cleared                   PASS
--   S6  start_league_draft again -> already_started                 PASS
--   S7  a pending roster reconfirmation (#126's gate) -> blocked,
--       no flip                                                     PASS
--   U1  commissioner PATCH draft_status -> draft_status_server_only PASS
--   U2  commissioner same-value patch + rename -> 1 row             PASS
--   U3  commissioner INSERT of an in_progress league -> refused     PASS
--   U4  commissioner INSERT of a not_started league -> 1 row        PASS
--   U5  authenticated cannot EXECUTE start_league_draft             PASS
--   U6  authenticated cannot read draft_start_blocks                PASS
-- ============================================================================
do $$
declare
  c_uid    text := gen_random_uuid()::text;   -- the fixture commissioner
  l_due    uuid;   -- draft_date 1 minute ago, 4 members
  l_future uuid;   -- draft_date 5 hours out
  l_missed uuid;   -- draft_date 20 minutes ago
  l_small  uuid;   -- draft_date 1 minute ago, 3 members
  l_recon  uuid;   -- draft_date 1 minute ago, 4 members, a roster confirmation owed
  r        jsonb;
  v_expect jsonb;
  n        int;
  acl      text;
  st       text;
  out      text := E'\n';
begin
  -- ---- G: catalog -----------------------------------------------------------
  select string_agg(proname || ':' || coalesce(proacl::text, 'NULL') || ':' || prosecdef::text
                    || ':' || coalesce(array_to_string(proconfig, ','), 'NOCONFIG'), ' ') into acl
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and proname in ('draft_start_grace', 'note_draft_start_blocked', 'due_draft_starts', 'start_league_draft')
     and (proacl is null
          or proacl::text ~ '(anon|authenticated)='
          or proacl::text ~ '(^|[{,])=X'
          or proacl::text !~ 'service_role=X'
          or not coalesce(proconfig @> array['search_path=public, pg_temp'], false)
          or (proname in ('note_draft_start_blocked', 'start_league_draft')) <> prosecdef);
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and proname in ('draft_start_grace', 'note_draft_start_blocked', 'due_draft_starts', 'start_league_draft');
  out := out || format(E'G1 fn grants/secdef/path   %s (found %s/4)  %s\n', coalesce(acl, 'ok'), n,
    case when acl is null and n = 4 then 'PASS' else 'FAIL' end);

  select coalesce(relacl::text, 'NULL') into acl from pg_class where oid = 'public.draft_start_blocks'::regclass;
  out := out || format(E'G2 draft_start_blocks rls=%s acl=%s  %s\n',
    (select relrowsecurity from pg_class where oid = 'public.draft_start_blocks'::regclass), acl,
    case when (select relrowsecurity from pg_class where oid = 'public.draft_start_blocks'::regclass)
          and acl !~ '(anon|authenticated)=' and acl ~ 'service_role=r/' then 'PASS' else 'FAIL' end);

  select count(*) into n from pg_trigger
   where tgname in ('trg_leagues_freeze_rules', 'trg_leagues_insert_not_started') and tgenabled = 'O';
  out := out || format(E'G3 triggers %s/2, freeze fn server-only=%s  %s\n', n,
    (select position('draft_status_server_only' in prosrc) > 0 from pg_proc
      where proname = 'enforce_league_rules_frozen_after_draft_start'),
    case when n = 2 and (select position('draft_status_server_only' in prosrc) > 0 from pg_proc
                          where proname = 'enforce_league_rules_frozen_after_draft_start')
         then 'PASS' else 'FAIL' end);

  out := out || format(E'G4 grace = %s  %s\n', public.draft_start_grace(),
    case when public.draft_start_grace() = interval '15 minutes' then 'PASS' else 'FAIL' end);

  -- ---- C: the cron (prod only; PGlite has no pg_cron) -------------------------
  if to_regclass('cron.job') is null then
    out := out || E'C1 cron: no pg_cron here  SKIP\n';
  else
    execute $q$ select command from cron.job where jobname = 'draft_autopick_sweep' $q$ into acl;
    out := out || format(E'C1 cron guards overdue=%s due=%s  %s\n',
      coalesce(position('public.overdue_draft_turns()' in acl) > 0, false),
      coalesce(position('public.due_draft_starts()' in acl) > 0, false),
      case when position('public.overdue_draft_turns()' in coalesce(acl, '')) > 0
            and position('public.due_draft_starts()' in coalesce(acl, '')) > 0 then 'PASS' else 'FAIL' end);
  end if;

  -- ---- fixture (as the editor's own role: auth.uid() IS NULL, exempt) -------
  insert into public.leagues (name, commissioner_id, invite_code, num_participants, num_rounds, num_weeks,
                              league_type, playoff_teams, stake_mode, budget_amount, draft_status, draft_date)
  values ('__AUTOSTART_DUE__', c_uid, 'AST-' || gen_random_uuid(), 8, 6, 11, 'matchup', 4, 'budget_cap', 250,
          'not_started', now() - interval '1 minute')
  returning id into l_due;
  insert into public.leagues (name, commissioner_id, invite_code, num_participants, num_rounds, num_weeks,
                              league_type, playoff_teams, stake_mode, budget_amount, draft_status, draft_date)
  values ('__AUTOSTART_FUTURE__', c_uid, 'AST-' || gen_random_uuid(), 8, 6, 11, 'matchup', 4, 'budget_cap', 250,
          'not_started', now() + interval '5 hours')
  returning id into l_future;
  insert into public.leagues (name, commissioner_id, invite_code, num_participants, num_rounds, num_weeks,
                              league_type, playoff_teams, stake_mode, budget_amount, draft_status, draft_date)
  values ('__AUTOSTART_MISSED__', c_uid, 'AST-' || gen_random_uuid(), 8, 6, 11, 'matchup', 4, 'budget_cap', 250,
          'not_started', now() - interval '20 minutes')
  returning id into l_missed;
  insert into public.leagues (name, commissioner_id, invite_code, num_participants, num_rounds, num_weeks,
                              league_type, playoff_teams, stake_mode, budget_amount, draft_status, draft_date)
  values ('__AUTOSTART_SMALL__', c_uid, 'AST-' || gen_random_uuid(), 8, 6, 11, 'matchup', 2, 'budget_cap', 250,
          'not_started', now() - interval '1 minute')
  returning id into l_small;
  insert into public.leagues (name, commissioner_id, invite_code, num_participants, num_rounds, num_weeks,
                              league_type, playoff_teams, stake_mode, budget_amount, draft_status, draft_date)
  values ('__AUTOSTART_RECONFIRM__', c_uid, 'AST-' || gen_random_uuid(), 8, 6, 11, 'matchup', 4, 'budget_cap', 250,
          'not_started', now() - interval '1 minute')
  returning id into l_recon;
  insert into public.league_members (league_id, user_id)
  select l, u from unnest(array[l_due, l_future, l_missed, l_recon]) l,
                   unnest(array[c_uid, gen_random_uuid()::text, gen_random_uuid()::text, gen_random_uuid()::text]) u;
  insert into public.league_members (league_id, user_id)
  select l_small, u from unnest(array[c_uid, gen_random_uuid()::text, gen_random_uuid()::text]) u;
  insert into public.league_draft_slots (league_id, slot_index, slot_count, price_min, price_max)
  values (l_due, 0, 3, null, 50.50), (l_due, 1, 3, 50.50, null);

  -- ---- D: due_draft_starts ----------------------------------------------------
  begin
    select count(*) filter (where league_id = l_due), count(*) filter (where league_id in (l_future, l_missed))
      into n, st from public.due_draft_starts();
    out := out || format(E'D1 due lists due=%s future/missed=%s  %s\n', n, st,
      case when n = 1 and st = '0' then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'D1 raised %s  FAIL\n', sqlerrm);
  end;

  begin
    perform public.note_draft_start_blocked(l_due, 'feasibility_unavailable', '[{"code":"feasibility_unavailable"}]'::jsonb);
    select count(*) into n from public.due_draft_starts() where league_id = l_due;
    out := out || format(E'D2 after a block, due lists it %s time(s)  %s\n', n, case when n = 0 then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'D2 raised %s  FAIL\n', sqlerrm);
  end;

  -- ---- S: start_league_draft --------------------------------------------------
  begin
    r := public.start_league_draft(l_missed, '{}'::jsonb);
    out := out || format(E'S1 missed league -> %s  %s\n', r->>'status', case when r->>'status' = 'missed' then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'S1 raised %s  FAIL\n', sqlerrm);
  end;

  begin
    r := public.start_league_draft(l_future, '{}'::jsonb);
    out := out || format(E'S2 future league -> %s  %s\n', r->>'status', case when r->>'status' = 'not_due' then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'S2 raised %s  FAIL\n', sqlerrm);
  end;

  begin
    r := public.start_league_draft(l_small, '{}'::jsonb);
    out := out || format(E'S3 3-member league -> %s/%s  %s\n', r->>'status', r->>'reason',
      case when r->>'status' = 'blocked' and r->>'reason' = 'not_enough_members' then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'S3 raised %s  FAIL\n', sqlerrm);
  end;

  -- The expectation, built exactly as buildStartExpect sends it (numerics by value).
  v_expect := jsonb_build_object(
    'members', 4, 'stake_mode', 'budget_cap', 'budget_amount', 250, 'num_rounds', 6,
    'allow_undraftable', (select allow_undraftable from public.leagues where id = l_due),
    'league_type', 'matchup', 'playoff_teams', 4,
    'slots', (select jsonb_agg(jsonb_build_object('id', s.id::text, 'slot_index', s.slot_index,
                'slot_count', s.slot_count, 'price_min', s.price_min, 'price_max', s.price_max,
                'category_id', s.category_id::text) order by s.slot_index, s.id)
                from public.league_draft_slots s where s.league_id = l_due));

  begin
    r := public.start_league_draft(l_due, jsonb_set(v_expect, '{playoff_teams}', '3'));
    select draft_status into st from public.leagues where id = l_due;
    out := out || format(E'S4 stale expectation -> %s, draft_status=%s  %s\n', r->>'status', st,
      case when r->>'status' = 'changed' and st = 'not_started' then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'S4 raised %s  FAIL\n', sqlerrm);
  end;

  begin
    r := public.start_league_draft(l_due, v_expect);
    select l.draft_status || '/' || (l.draft_started_at is not null)::text || '/'
           || coalesce((select m.state from public.league_draft_order_meta m where m.league_id = l.id), 'none') || '/'
           || (select count(*) from public.draft_start_blocks b where b.league_id = l.id)::text
      into st from public.leagues l where l.id = l_due;
    out := out || format(E'S5 exact expectation -> %s (status/anchored/order/blocks = %s)  %s\n', r->>'status', st,
      case when r->>'status' = 'started' and st = 'in_progress/true/locked/0' then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'S5 raised %s  FAIL\n', sqlerrm);
  end;

  begin
    r := public.start_league_draft(l_due, v_expect);
    out := out || format(E'S6 second start -> %s  %s\n', r->>'status',
      case when r->>'status' = 'already_started' then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'S6 raised %s  FAIL\n', sqlerrm);
  end;

  begin
    insert into public.league_roster_reconfirm (league_id, departed, members_before)
    values (l_recon, '[{"user_id":"x","name":"Sam"}]'::jsonb, 5);
    r := public.start_league_draft(l_recon, jsonb_build_object(
      'members', 4, 'stake_mode', 'budget_cap', 'budget_amount', 250, 'num_rounds', 6,
      'allow_undraftable', (select allow_undraftable from public.leagues where id = l_recon),
      'league_type', 'matchup', 'playoff_teams', 4, 'slots', '[]'::jsonb));
    select draft_status into st from public.leagues where id = l_recon;
    out := out || format(E'S7 reconfirm owed -> %s/%s, draft_status=%s  %s\n', r->>'status', r->>'reason', st,
      case when r->>'status' = 'blocked' and r->>'reason' = 'roster_reconfirm_required' and st = 'not_started'
           then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'S7 raised %s  FAIL\n', sqlerrm);
  end;

  -- ---- U: user sessions (the fixture commissioner) ----------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', c_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  begin
    update public.leagues set draft_status = 'in_progress' where id = l_future;
    out := out || E'U1 commissioner PATCH draft_status was NOT refused  FAIL\n';
  exception when others then
    out := out || format(E'U1 commissioner PATCH draft_status -> %s  %s\n', split_part(sqlerrm, ':', 1),
      case when sqlerrm like 'draft_status_server_only:%' then 'PASS' else 'FAIL' end);
  end;

  begin
    update public.leagues set draft_status = 'not_started', name = '__AUTOSTART_FUTURE_RENAMED__' where id = l_future;
    get diagnostics n = row_count;
    out := out || format(E'U2 same-value patch + rename -> %s row(s)  %s\n', n, case when n = 1 then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'U2 raised %s  FAIL\n', sqlerrm);
  end;

  begin
    insert into public.leagues (name, commissioner_id, invite_code, num_participants, draft_status)
    values ('__AUTOSTART_BAD__', c_uid, 'AST-' || gen_random_uuid(), 8, 'in_progress');
    out := out || E'U3 INSERT in_progress was NOT refused  FAIL\n';
  exception when others then
    out := out || format(E'U3 INSERT in_progress -> %s  %s\n', split_part(sqlerrm, ':', 1),
      case when sqlerrm like 'draft_status_server_only:%' then 'PASS' else 'FAIL' end);
  end;

  begin
    insert into public.leagues (name, commissioner_id, invite_code, num_participants, draft_status)
    values ('__AUTOSTART_NEW__', c_uid, 'AST-' || gen_random_uuid(), 8, 'not_started');
    get diagnostics n = row_count;
    out := out || format(E'U4 INSERT not_started -> %s row(s)  %s\n', n, case when n = 1 then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'U4 raised %s  FAIL\n', sqlerrm);
  end;

  begin
    r := public.start_league_draft(l_future, '{}'::jsonb);
    out := out || E'U5 authenticated EXECUTEd start_league_draft  FAIL\n';
  exception when insufficient_privilege then out := out || E'U5 authenticated EXECUTE denied  PASS\n';
            when others then out := out || format(E'U5 raised %s  FAIL\n', sqlerrm);
  end;

  begin
    select count(*) into n from public.draft_start_blocks;
    out := out || format(E'U6 authenticated read draft_start_blocks (%s rows)  FAIL\n', n);
  exception when insufficient_privilege then out := out || E'U6 authenticated SELECT denied  PASS\n';
            when others then out := out || format(E'U6 raised %s  FAIL\n', sqlerrm);
  end;

  raise exception '%', out;
end;
$$;
