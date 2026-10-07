-- ============================================================================
-- DRAFT AUTO-START EFFECT TEST — run in the Supabase SQL editor AFTER `db push`
-- of 20261111000000-03 (auto-start, draft_status server-only + draft time
-- guard, the sweep cron, the draft-order-notify cron).
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
--     real Postgres and requires every line to PASS (C1/C2 read SKIP there:
--     PGlite has no pg_cron).
--
-- SUPERSEDES two lines of docs/security/freeze-league-rules-effect-test.sql:
-- after 20261111000001 its R7 (a user-session completing UPDATE -> 1 row) and
-- D1 (expects 'league_draft_status_locked') are refused with
-- 'draft_status_server_only' instead. That file is the record of the
-- 20261104000000 release; do not re-run it as a gate after this one.
--
-- EXPECTED OUTPUT (the final "ERROR:" text): every line ends in PASS.
--   G1  every auto-start function: postgres + service_role only, DEFINER
--       where expected, search_path pinned                           PASS
--   G2  draft_start_watch + draft_postponements: RLS on, no client
--       grant, service_role SELECT-only                              PASS
--   G3  the four leagues triggers + the notifications trigger enabled;
--       the freeze fn is server-only                                 PASS
--   G4  draft_start_policy(): room 1h, gate 30s, reminder 2h, 55 min,
--       quarter hours                                                PASS
--   G5  the kind CHECK admits the six new kinds and keeps #126's     PASS
--   C1  the sweep cron guards on overdue + draft_auto_start_work_due PASS
--   C2  the notify cron guards on draft_room_notices_due(), 180000ms PASS
--   W1  a blocked league -> the commissioner gets ONE at-risk notice PASS
--   W2  a gate-window clear verdict clears the gate                  PASS
--   P1  postpone: row + date cleared + every human told              PASS
--   P2  a new draft time ends a postponement (the reschedule trigger) PASS
--   T1  ...and tells every human member once (draft_time_set)        PASS
--   R1  open_due_draft_rooms: order finalized, one room-open notice
--       per human                                                    PASS
--   S1  start_league_draft: the room never opened -> room_not_open   PASS
--   S2  start_league_draft: stale expectation -> changed, no flip    PASS
--   S3  start_league_draft: opened room + exact expectation ->
--       started, order locked, draft_started notices                 PASS
--   S4  a pending roster confirmation (#126's gate) -> blocked       PASS
--   N1  a draft_order_set row is in-app only (push skipped)          PASS
--   U1  commissioner PATCH draft_status -> draft_status_server_only  PASS
--   U2  commissioner off-grid draft time -> draft_time_invalid       PASS
--   U3  commissioner draft time 20 min out -> draft_time_too_soon    PASS
--   U4  commissioner moves the time once the room is open -> locked  PASS
--   U5  commissioner sets a new time on a postponed league -> 1 row  PASS
--   U6  authenticated cannot EXECUTE start_league_draft              PASS
--   U7  authenticated cannot read draft_postponements                PASS
-- ============================================================================
do $$
declare
  c_uid    text := gen_random_uuid()::text;   -- the fixture commissioner
  l_watch  uuid;   -- 5 h out, 3 humans: blocked (not enough members)
  l_gate   uuid;   -- in the gate window (T-1h-12s), clear
  l_post   uuid;   -- postponed in the gate window
  l_post2  uuid;   -- postponed, then rescheduled by the owner
  l_room   uuid;   -- the room's time has come, gate cleared
  l_start  uuid;   -- its time just passed
  l_recon  uuid;   -- its time just passed, a roster confirmation owed
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
     and proname in ('draft_start_policy', '_draft_start_inputs', 'draft_watch_due', 'record_draft_watch',
                     'postpone_league_draft', 'due_draft_starts', 'start_league_draft', 'open_due_draft_rooms',
                     'draft_room_notices_due', 'draft_notice_context', 'draft_auto_start_work_due')
     and (proacl is null
          or proacl::text ~ '(anon|authenticated)='
          or proacl::text ~ '(^|[{,])=X'
          or proacl::text !~ 'service_role=X'
          or not coalesce(proconfig @> array['search_path=public, pg_temp'], false)
          or (proname in ('record_draft_watch', 'postpone_league_draft', 'start_league_draft',
                          'open_due_draft_rooms', 'draft_notice_context')) <> prosecdef);
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and proname in ('draft_start_policy', '_draft_start_inputs', 'draft_watch_due', 'record_draft_watch',
                     'postpone_league_draft', 'due_draft_starts', 'start_league_draft', 'open_due_draft_rooms',
                     'draft_room_notices_due', 'draft_notice_context', 'draft_auto_start_work_due');
  out := out || format(E'G1 fn grants/secdef/path   %s (found %s/11)  %s\n', coalesce(acl, 'ok'), n,
    case when acl is null and n = 11 then 'PASS' else 'FAIL' end);

  select string_agg(relname || ':' || relrowsecurity::text || ':' || coalesce(relacl::text, 'NULL'), ' ') into acl
    from pg_class
   where oid in ('public.draft_start_watch'::regclass, 'public.draft_postponements'::regclass)
     and (not relrowsecurity or relacl is null or relacl::text ~ '(anon|authenticated)='
          or relacl::text !~ 'service_role=r/');
  out := out || format(E'G2 state tables rls/grants  %s  %s\n', coalesce(acl, 'ok'), case when acl is null then 'PASS' else 'FAIL' end);

  select count(*) into n from pg_trigger
   where tgname in ('trg_leagues_freeze_rules', 'trg_leagues_insert_not_started', 'trg_leagues_draft_time',
                    'trg_leagues_draft_rescheduled', 'trg_league_notifications_order_set_in_app')
     and tgenabled = 'O';
  out := out || format(E'G3 triggers %s/5, freeze fn server-only=%s  %s\n', n,
    (select position('draft_status_server_only' in prosrc) > 0 from pg_proc
      where proname = 'enforce_league_rules_frozen_after_draft_start'),
    case when n = 5 and (select position('draft_status_server_only' in prosrc) > 0 from pg_proc
                          where proname = 'enforce_league_rules_frozen_after_draft_start')
         then 'PASS' else 'FAIL' end);

  r := public.draft_start_policy();
  out := out || format(E'G4 policy %s  %s\n', r,
    case when r = '{"room_lead_s":3600,"gate_lead_s":30,"reminder_lead_s":7200,"refresh_s":300,"horizon_s":86400,"min_lead_s":3300,"step_minutes":15}'::jsonb
         then 'PASS' else 'FAIL' end);

  select pg_get_constraintdef(oid) into acl from pg_constraint where conname = 'league_notifications_kind_check';
  out := out || format(E'G5 kind check has new kinds + member_left  %s\n',
    case when acl like '%draft_room_open%' and acl like '%draft_started%' and acl like '%draft_at_risk%'
          and acl like '%draft_at_risk_reminder%' and acl like '%draft_postponed%' and acl like '%draft_time_set%'
          and acl like '%member_left%' then 'PASS' else 'FAIL' end);

  -- ---- C: the crons (prod only; PGlite has no pg_cron) -------------------------
  if to_regclass('cron.job') is null then
    out := out || E'C1 cron: no pg_cron here  SKIP\n';
    out := out || E'C2 cron: no pg_cron here  SKIP\n';
  else
    execute $q$ select command from cron.job where jobname = 'draft_autopick_sweep' $q$ into acl;
    out := out || format(E'C1 sweep guards overdue + auto-start work  %s\n',
      case when position('public.overdue_draft_turns()' in coalesce(acl, '')) > 0
            and position('public.draft_auto_start_work_due()' in coalesce(acl, '')) > 0 then 'PASS' else 'FAIL' end);
    execute $q$ select command from cron.job where jobname = 'draft_order_notify' $q$ into acl;
    out := out || format(E'C2 notify guards room notices, 180000 ms  %s\n',
      case when position('public.draft_room_notices_due()' in coalesce(acl, '')) > 0
            and position('timeout_milliseconds := 180000' in coalesce(acl, '')) > 0 then 'PASS' else 'FAIL' end);
  end if;

  -- ---- fixture (as the editor's own role: auth.uid() IS NULL, exempt) -------
  insert into public.leagues (name, commissioner_id, invite_code, num_participants, num_rounds, num_weeks,
                              league_type, playoff_teams, stake_mode, budget_amount, draft_date)
  values ('__AUTOSTART_WATCH__', c_uid, 'AST-' || gen_random_uuid(), 8, 6, 11, 'matchup', 2, 'budget_cap', 250,
          now() + interval '5 hours') returning id into l_watch;
  insert into public.leagues (name, commissioner_id, invite_code, num_participants, num_rounds, num_weeks,
                              league_type, playoff_teams, stake_mode, budget_amount, draft_date)
  values ('__AUTOSTART_GATE__', c_uid, 'AST-' || gen_random_uuid(), 8, 6, 11, 'matchup', 4, 'budget_cap', 250,
          now() + interval '60 minutes 12 seconds') returning id into l_gate;
  insert into public.leagues (name, commissioner_id, invite_code, num_participants, num_rounds, num_weeks,
                              league_type, playoff_teams, stake_mode, budget_amount, draft_date)
  values ('__AUTOSTART_POSTPONE__', c_uid, 'AST-' || gen_random_uuid(), 8, 6, 11, 'matchup', 4, 'budget_cap', 250,
          now() + interval '60 minutes 12 seconds') returning id into l_post;
  insert into public.leagues (name, commissioner_id, invite_code, num_participants, num_rounds, num_weeks,
                              league_type, playoff_teams, stake_mode, budget_amount, draft_date)
  values ('__AUTOSTART_POSTPONE_2__', c_uid, 'AST-' || gen_random_uuid(), 8, 6, 11, 'matchup', 4, 'budget_cap', 250,
          now() + interval '3 hours') returning id into l_post2;
  insert into public.leagues (name, commissioner_id, invite_code, num_participants, num_rounds, num_weeks,
                              league_type, playoff_teams, stake_mode, budget_amount, draft_date)
  values ('__AUTOSTART_ROOM__', c_uid, 'AST-' || gen_random_uuid(), 8, 6, 11, 'matchup', 4, 'budget_cap', 250,
          now() + interval '59 minutes') returning id into l_room;
  insert into public.leagues (name, commissioner_id, invite_code, num_participants, num_rounds, num_weeks,
                              league_type, playoff_teams, stake_mode, budget_amount, draft_date)
  values ('__AUTOSTART_START__', c_uid, 'AST-' || gen_random_uuid(), 8, 6, 11, 'matchup', 4, 'budget_cap', 250,
          now() - interval '1 minute') returning id into l_start;
  insert into public.leagues (name, commissioner_id, invite_code, num_participants, num_rounds, num_weeks,
                              league_type, playoff_teams, stake_mode, budget_amount, draft_date)
  values ('__AUTOSTART_RECONFIRM__', c_uid, 'AST-' || gen_random_uuid(), 8, 6, 11, 'matchup', 4, 'budget_cap', 250,
          now() - interval '1 minute') returning id into l_recon;
  insert into public.league_members (league_id, user_id)
  select l, u from unnest(array[l_gate, l_post, l_post2, l_room, l_start, l_recon]) l,
                   unnest(array[c_uid, gen_random_uuid()::text, gen_random_uuid()::text, 'bot-1']) u;
  insert into public.league_members (league_id, user_id)
  select l_watch, u from unnest(array[c_uid, gen_random_uuid()::text, gen_random_uuid()::text]) u;

  -- ---- W: the watch -------------------------------------------------------------
  begin
    r := public.record_draft_watch(l_watch, (select draft_date from public.leagues where id = l_watch),
           public._draft_start_inputs(l_watch), true, '[{"code":"not_enough_members"}]'::jsonb, false);
    r := public.record_draft_watch(l_watch, (select draft_date from public.leagues where id = l_watch),
           public._draft_start_inputs(l_watch), true, '[{"code":"not_enough_members"}]'::jsonb, false);
    select count(*) into n from public.league_notifications where league_id = l_watch and kind = 'draft_at_risk' and user_id = c_uid;
    out := out || format(E'W1 blocked twice -> %s at-risk notice(s) to the commissioner  %s\n', n, case when n = 1 then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'W1 raised %s  FAIL\n', sqlerrm);
  end;

  begin
    r := public.record_draft_watch(l_gate, (select draft_date from public.leagues where id = l_gate),
           public._draft_start_inputs(l_gate), false, '[]'::jsonb, true);
    out := out || format(E'W2 gate window, clear -> gate_cleared=%s  %s\n', r->>'gate_cleared',
      case when (r->>'gate_cleared')::boolean then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'W2 raised %s  FAIL\n', sqlerrm);
  end;

  -- ---- P: postpone ----------------------------------------------------------------
  begin
    r := public.postpone_league_draft(l_post, (select draft_date from public.leagues where id = l_post),
           'room_open', 'not_enough_members', '[{"code":"not_enough_members"}]'::jsonb, null);
    select (select draft_date is null from public.leagues where id = l_post)::text || '/'
           || (select count(*) from public.draft_postponements where league_id = l_post)::text || '/'
           || (select count(*) from public.league_notifications where league_id = l_post and kind = 'draft_postponed')::text
      into st;
    out := out || format(E'P1 postpone -> %s (date cleared/row/notices = %s)  %s\n', r->>'status', st,
      case when r->>'status' = 'postponed' and st = 'true/1/3' then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'P1 raised %s  FAIL\n', sqlerrm);
  end;

  begin
    r := public.postpone_league_draft(l_post2, (select draft_date from public.leagues where id = l_post2),
           'start', 'start_failed', '[{"code":"start_failed"}]'::jsonb, null);
    update public.leagues set draft_date = date_trunc('hour', now()) + interval '2 days' where id = l_post2;
    out := out || format(E'P2 rescheduled -> postponed=%s  %s\n',
      exists (select 1 from public.draft_postponements where league_id = l_post2),
      case when r->>'status' = 'postponed'
            and not exists (select 1 from public.draft_postponements where league_id = l_post2) then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'P2 raised %s  FAIL\n', sqlerrm);
  end;

  begin
    select count(*) into n from public.league_notifications
     where league_id = l_post2 and kind = 'draft_time_set' and push_status = 'pending';
    out := out || format(E'T1 new time -> %s draft_time_set notice(s) (3 humans, bot skipped)  %s\n', n,
      case when n = 3 then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'T1 raised %s  FAIL\n', sqlerrm);
  end;

  -- ---- R: the room opens ------------------------------------------------------------
  begin
    r := public.record_draft_watch(l_room, (select draft_date from public.leagues where id = l_room),
           public._draft_start_inputs(l_room), false, '[]'::jsonb, true);
    perform public.open_due_draft_rooms();
    select coalesce((select state from public.league_draft_order_meta where league_id = l_room), 'none') || '/'
           || (select count(*) from public.league_notifications where league_id = l_room and kind = 'draft_room_open')::text
      into st;
    out := out || format(E'R1 room opens -> order/notices = %s  %s\n', st, case when st = 'finalized/3' then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'R1 raised %s  FAIL\n', sqlerrm);
  end;

  -- ---- S: start_league_draft ------------------------------------------------------------
  begin
    r := public.start_league_draft(l_start, public._draft_start_inputs(l_start));
    out := out || format(E'S1 no room opened -> %s  %s\n', r->>'status', case when r->>'status' = 'room_not_open' then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'S1 raised %s  FAIL\n', sqlerrm);
  end;

  -- The room opened for l_start and l_recon's (past) times: as the order finalize + gate would have.
  insert into public.draft_start_watch (league_id, draft_date, inputs_sig, blocked, gate_cleared_at, room_opened_at)
  select id, draft_date, 'effect-test', false, now(), now() from public.leagues where id in (l_start, l_recon);
  perform public._draft_order_sync(l_start, true);   -- after the gate: the order is set only once it cleared
  v_expect := public._draft_start_inputs(l_start);

  begin
    r := public.start_league_draft(l_start, jsonb_set(v_expect, '{playoff_teams}', '3'));
    select draft_status into st from public.leagues where id = l_start;
    out := out || format(E'S2 stale expectation -> %s, draft_status=%s  %s\n', r->>'status', st,
      case when r->>'status' = 'changed' and st = 'not_started' then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'S2 raised %s  FAIL\n', sqlerrm);
  end;

  begin
    r := public.start_league_draft(l_start, v_expect);
    select l.draft_status || '/' || coalesce((select m.state from public.league_draft_order_meta m where m.league_id = l.id), 'none')
           || '/' || (select count(*) from public.league_notifications x where x.league_id = l.id and x.kind = 'draft_started')::text
      into st from public.leagues l where l.id = l_start;
    out := out || format(E'S3 opened room + exact expectation -> %s (%s)  %s\n', r->>'status', st,
      case when r->>'status' = 'started' and st = 'in_progress/locked/3' then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'S3 raised %s  FAIL\n', sqlerrm);
  end;

  begin
    insert into public.league_roster_reconfirm (league_id, departed, members_before)
    values (l_recon, '[{"user_id":"x","name":"Sam"}]'::jsonb, 5);
    r := public.start_league_draft(l_recon, public._draft_start_inputs(l_recon));
    select draft_status into st from public.leagues where id = l_recon;
    out := out || format(E'S4 reconfirm owed -> %s/%s, draft_status=%s  %s\n', r->>'status', r->>'reason', st,
      case when r->>'status' = 'blocked' and r->>'reason' = 'roster_reconfirm_required' and st = 'not_started'
           then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'S4 raised %s  FAIL\n', sqlerrm);
  end;

  begin
    insert into public.league_notifications (league_id, user_id, kind) values (l_watch, c_uid, 'draft_order_set');
    select push_status into st from public.league_notifications where league_id = l_watch and kind = 'draft_order_set';
    out := out || format(E'N1 draft_order_set push_status=%s  %s\n', st, case when st = 'skipped' then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'N1 raised %s  FAIL\n', sqlerrm);
  end;

  -- ---- U: user sessions (the fixture commissioner) ----------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', c_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  begin
    update public.leagues set draft_status = 'in_progress' where id = l_watch;
    out := out || E'U1 commissioner PATCH draft_status was NOT refused  FAIL\n';
  exception when others then
    out := out || format(E'U1 commissioner PATCH draft_status -> %s  %s\n', split_part(sqlerrm, ':', 1),
      case when sqlerrm like 'draft_status_server_only:%' then 'PASS' else 'FAIL' end);
  end;

  begin
    update public.leagues set draft_date = date_trunc('hour', now()) + interval '1 day 7 minutes' where id = l_watch;
    out := out || E'U2 off-grid time was NOT refused  FAIL\n';
  exception when others then
    out := out || format(E'U2 off-grid time -> %s  %s\n', split_part(sqlerrm, ':', 1),
      case when sqlerrm like 'draft_time_invalid:%' then 'PASS' else 'FAIL' end);
  end;

  begin
    update public.leagues set draft_date = date_trunc('minute', now() + interval '20 minutes')
                                         - make_interval(mins => extract(minute from now() + interval '20 minutes')::int % 15)
     where id = l_watch;
    out := out || E'U3 a time < 55 min out was NOT refused  FAIL\n';
  exception when others then
    out := out || format(E'U3 20 minutes out -> %s  %s\n', split_part(sqlerrm, ':', 1),
      case when sqlerrm like 'draft_time_too_soon:%' then 'PASS' else 'FAIL' end);
  end;

  begin
    update public.leagues set draft_date = date_trunc('hour', now()) + interval '2 days' where id = l_room;
    out := out || E'U4 moving the time after the room opened was NOT refused  FAIL\n';
  exception when others then
    out := out || format(E'U4 room open -> %s  %s\n', split_part(sqlerrm, ':', 1),
      case when sqlerrm like 'draft_time_locked:%' then 'PASS' else 'FAIL' end);
  end;

  begin
    update public.leagues set draft_date = date_trunc('hour', now()) + interval '2 days' where id = l_post;
    get diagnostics n = row_count;
    out := out || format(E'U5 new time on a postponed league -> %s row(s)  %s\n', n, case when n = 1 then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'U5 raised %s  FAIL\n', sqlerrm);
  end;

  begin
    r := public.start_league_draft(l_watch, '{}'::jsonb);
    out := out || E'U6 authenticated EXECUTEd start_league_draft  FAIL\n';
  exception when insufficient_privilege then out := out || E'U6 authenticated EXECUTE denied  PASS\n';
            when others then out := out || format(E'U6 raised %s  FAIL\n', sqlerrm);
  end;

  begin
    select count(*) into n from public.draft_postponements;
    out := out || format(E'U7 authenticated read draft_postponements (%s rows)  FAIL\n', n);
  exception when insufficient_privilege then out := out || E'U7 authenticated SELECT denied  PASS\n';
            when others then out := out || format(E'U7 raised %s  FAIL\n', sqlerrm);
  end;

  raise exception '%', out;
end;
$$;
