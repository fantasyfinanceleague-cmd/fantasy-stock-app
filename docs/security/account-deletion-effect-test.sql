-- ============================================================================
-- ACCOUNT DELETION EFFECT TEST: run in the Supabase SQL editor AFTER `db push`
-- of 20261125000000-09 (plan docs/plans/2026-10-21-account-deletion.md, W2).
-- It does not depend on W3's 20261125000010 cron (it never reads cron.job).
-- Read-only in effect: NOTHING persists (the block ends by RAISING, which rolls
-- back every fixture: auth.users rows, leagues, the ledger row, vault entries).
-- ============================================================================
-- Same shape as frozen-leaver-names-effect-test.sql:
--   * The editor shows only the last statement's output, so every case records
--     a line and the block ends with RAISE. The FIRST line of the message is the
--     verdict: 'ACCOUNT DELETION EFFECT TEST: PASS (n/n lines PASS) ...' or FAIL.
--   * Role/claims switch with set_config(..., true), the way PostgREST does, so
--     auth.uid() and EXECUTE grants behave as for a real call. Switches happen
--     OUTSIDE the per-case begin/exception blocks.
--   * Fixtures set league_members.role and leagues.league_type EXPLICITLY.
--   * supabase/tests/account_deletion.pglite.test.ts runs THIS file on the whole
--     migration chain and requires the PASS verdict.
--
-- Cast: A deletes their account. B and C are leaguemates; E takes A's seat.
--   LM  a mid-season matchup league A commissions; B joined before C
--   LP  a pre-draft league B commissions; A is a member
--   LA  a finished league C commissions; A left it after the season (hidden,
--       frozen name) and was its champion
--
-- EXPECTED OUTPUT: the verdict line, then every line ends in PASS.
--   G1  trades has NO foreign key to auth.users                           PASS
--   G2  league_members.deleted_at + freeze trigger fires on it            PASS
--   G3  deleted_manager_label() = 'Former manager', never a username       PASS
--   G4  19 service-only functions: definer, path pinned, service_role only PASS
--   G5  8 internals: owner only; authenticated: the 3 client RPCs          PASS
--   G6  account_deletions: RLS on, no policies, no API-role privilege      PASS
--   G7  policies: insert_self needs deleted_at null; invites kind = invite PASS
--   G8  notification kinds include seat_taken_over (and every old kind)    PASS
--   G9  join resolvers read kind = 'invite' only; guess limiter locked     PASS
--   S1  scrub refuses without a ledger row                                 PASS
--   S2  scrub: LM -> B commissioner; LP -> A gone, reconfirm = label       PASS
--   S3  scrub: A's seats in LM + LA deleted, frozen_* NULL; profile gone    PASS
--   S4  scrub re-run: no new notice, nothing changes                       PASS
--   V1  B, get_league_display_names(LM/LA): A = the label                  PASS
--   V2  B, get_visible_profiles([A]): (A, label, NULL avatar)              PASS
--   P1  takeover_preview: A's seat record 1-0, league name, nothing else   PASS
--   T1  B makes a takeover code; E takes the seat; every row moves         PASS
--   T2  a second taker gets 'taken'                                        PASS
--   T3  join_league_by_code treats a takeover code as unknown              PASS
--   K1  Vault: stash, read back, revoke drops the secret (owner privileges) PASS
--   D1  auth delete: trades survive; mark_done -> 'done'                   PASS
--   N1  anon/authenticated cannot execute the service-only functions       PASS
-- Any FAIL line is a real finding: stop and report it.
-- ============================================================================
do $$
declare
  sfx    text := substr(md5(random()::text), 1, 10);
  a_uid  uuid := gen_random_uuid();
  b_uid  uuid := gen_random_uuid();
  c_uid  uuid := gen_random_uuid();
  e_uid  uuid := gen_random_uuid();
  f_uid  uuid := gen_random_uuid();
  lm     uuid;
  lp     uuid;
  la     uuid;
  lbl    text;
  acl    text;
  got    text;
  got2   text;
  res    jsonb;
  res2   jsonb;
  code   text;
  n      int;
  n2     int;
  out    text := '';
  svc_fns constant text[] := array['scrub_deleted_manager', 'take_over_team', 'heal_account_deletions',
    'account_deletion_open', 'account_deletion_cancel', 'account_deletion_set_apple',
    'account_deletion_stash_apple_token', 'account_deletion_apple_token', 'account_deletion_apple_revoked',
    'account_deletion_fail', 'account_deletion_mark_done', 'leave_league', 'transfer_commissioner',
    'account_deletion_apple_unrevoked', 'takeover_preview', 'heal_account_deletions_due',
    'join_league_by_code', 'invite_preview_lookup', 'unclocked_deleted_seat_turns'];
begin
  -- ---- G: catalog -------------------------------------------------------------
  select count(*) into n from pg_constraint
   where conrelid = 'public.trades'::regclass and contype = 'f' and confrelid = 'auth.users'::regclass;
  out := out || format(E'G1 trades FKs to auth.users = %s  %s\n', n, case when n = 0 then 'PASS' else 'FAIL' end);

  select pg_get_triggerdef(oid) into got from pg_trigger where tgname = 'trg_league_members_freeze_leaver';
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'league_members' and column_name = 'deleted_at';
  out := out || format(E'G2 deleted_at col=%s trigger-on-deleted_at=%s  %s\n', n, coalesce(got ~ 'deleted_at', false),
    case when n = 1 and got ~ 'deleted_at' then 'PASS' else 'FAIL' end);

  lbl := public.deleted_manager_label();
  out := out || format(E'G3 label=%L username-shaped=%s  %s\n', lbl, lbl ~ '^[A-Za-z0-9_]{3,20}$',
    case when lbl = 'Former manager' and lbl !~ '^[A-Za-z0-9_]{3,20}$' then 'PASS' else 'FAIL' end);

  select string_agg(proname || '=' || coalesce(proacl::text, 'NULL'), ' ') into acl
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and proname = any(svc_fns)
     and (not prosecdef or coalesce(proconfig::text, '') !~ 'search_path=public, pg_temp'
          or coalesce(proacl::text, '') !~ 'service_role=X'
          or coalesce(proacl::text, '') ~ '(anon|authenticated)=' or coalesce(proacl::text, '{=X}') ~ '(^|[{,])=X');
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and proname = any(svc_fns);
  out := out || format(E'G4 service-only (%s/%s fns) %s  %s\n', n, cardinality(svc_fns), coalesce(acl, 'ok'),
    case when n = cardinality(svc_fns) and acl is null then 'PASS' else 'FAIL' end);

  select string_agg(proname || '=' || coalesce(proacl::text, 'NULL'), ' ') into acl
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public'
     and ((proname in ('_leave_league_before_draft', 'league_participant_display_name',
                       'league_members_freeze_leaver', 'enforce_league_draft_order_rows',
                       '_takeover_check', '_account_deletion_settle_apple', '_account_deletion_apple_rank',
                       'takeover_guess_try_lock')
           and coalesce(proacl::text, '') ~ '(anon|authenticated|service_role)=|(^|[{,])=X')
       or (proname in ('get_visible_profiles', 'create_takeover_invite', 'renew_league')
           and (coalesce(proacl::text, '') !~ 'authenticated=X'
                or coalesce(proacl::text, '') ~ '(anon|service_role)=|(^|[{,])=X'))
       or (proname = 'deleted_manager_label'
           and (coalesce(proacl::text, '') ~ 'anon=|(^|[{,])=X' or coalesce(proacl::text, '') !~ 'authenticated=X')));
  out := out || format(E'G5 internals owner-only, client RPCs authenticated-only: %s  %s\n', coalesce(acl, 'ok'),
    case when acl is null then 'PASS' else 'FAIL' end);

  select count(*) into n from pg_policies where tablename = 'account_deletions';
  select coalesce(relacl::text, 'NULL') into acl from pg_class where oid = 'public.account_deletions'::regclass;
  out := out || format(E'G6 account_deletions rls=%s policies=%s acl=%s  %s\n',
    (select relrowsecurity from pg_class where oid = 'public.account_deletions'::regclass), n, acl,
    case when (select relrowsecurity from pg_class where oid = 'public.account_deletions'::regclass) and n = 0
          and acl !~ '(anon|authenticated|service_role)=' and acl !~ '(^|[{,])=' then 'PASS' else 'FAIL' end);

  select with_check into got from pg_policies where tablename = 'league_members' and policyname = 'league_members_insert_self';
  select with_check into got2 from pg_policies where tablename = 'league_invites' and policyname = 'league_invites_insert_commissioner';
  out := out || format(E'G7 insert_self deleted_at=%s invites kind=%s  %s\n',
    coalesce(got ~ 'deleted_at IS NULL', false), coalesce(got2 ~ 'kind = ''invite''', false),
    case when got ~ 'hidden_at IS NULL' and got ~ 'deleted_at IS NULL' and got2 ~ 'kind = ''invite''' then 'PASS' else 'FAIL' end);

  select pg_get_constraintdef(oid) into got from pg_constraint where conname = 'league_notifications_kind_check';
  select count(*) into n from unnest(array['draft_order_set', 'renewal_invite', 'renewal_reply', 'renewal_nudge',
    'renewal_removed', 'season_set', 'member_left', 'commissioner_transferred', 'draft_room_open', 'draft_started',
    'draft_at_risk', 'draft_at_risk_reminder', 'draft_postponed', 'draft_time_set', 'seat_taken_over']) k
   where got ~ ('''' || k || '''');
  out := out || format(E'G8 notification kinds present %s/15  %s\n', n, case when n = 15 then 'PASS' else 'FAIL' end);

  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and proname in ('join_league_by_code', 'invite_preview_lookup')
     and prosrc ~ 'kind = ''invite''';
  select coalesce(relacl::text, 'NULL') into acl from pg_class where oid = 'public.takeover_guess_limits'::regclass;
  out := out || format(E'G9 join resolvers invite-only %s/2; guess limiter rls=%s acl=%s  %s\n', n,
    (select relrowsecurity from pg_class where oid = 'public.takeover_guess_limits'::regclass), acl,
    case when n = 2 and (select relrowsecurity from pg_class where oid = 'public.takeover_guess_limits'::regclass)
          and acl !~ '(anon|authenticated|service_role)=' and acl !~ '(^|[{,])=' then 'PASS' else 'FAIL' end);

  -- ---- fixture (the editor's own role) -------------------------------------------
  insert into auth.users (id, email, created_at, updated_at, aud, role, instance_id)
  select u, 'fixture-' || u || '@account-deletion-test.invalid', now(), now(), 'authenticated', 'authenticated',
         '00000000-0000-0000-0000-000000000000'
    from unnest(array[a_uid, b_uid, c_uid, e_uid, f_uid]) u;
  insert into public.user_profiles (id, username, avatar) values
    (a_uid, 'fxa_' || sfx, 'A1'), (b_uid, 'fxb_' || sfx, 'B1'), (c_uid, 'fxc_' || sfx, 'C1'),
    (e_uid, 'fxe_' || sfx, 'E1'), (f_uid, 'fxf_' || sfx, 'F1')
    on conflict (id) do update set username = excluded.username, avatar = excluded.avatar;
  insert into public.push_tokens (user_id, token) values (a_uid, 'ExponentPushToken[fixture-' || sfx || ']');

  insert into public.leagues (name, commissioner_id, invite_code, num_participants, league_type, num_weeks, playoff_teams)
  values ('__ACCTDEL_LM__', a_uid::text, 'AD' || upper(substr(sfx, 1, 8)), 4, 'matchup', 4, 2) returning id into lm;
  insert into public.league_members (league_id, user_id, role, joined_at) values
    (lm, a_uid::text, 'commissioner', now() - interval '3 hours'),
    (lm, c_uid::text, 'member',       now() - interval '1 hour'),
    (lm, b_uid::text, 'member',       now() - interval '2 hours'),
    (lm, 'bot-1',     'member',       now() - interval '150 minutes');
  update public.leagues set draft_status = 'in_progress', draft_started_at = now() where id = lm;
  update public.leagues set draft_status = 'completed', league_start_date = now() - interval '7 days',
                            league_end_date = now() + interval '21 days' where id = lm;
  insert into public.matchups (league_id, week_number, team1_user_id, team2_user_id, team1_gain, team2_gain, winner_user_id)
  values (lm, 1, a_uid::text, b_uid::text, 5, 3, a_uid::text), (lm, 1, c_uid::text, 'bot-1', 1, 2, 'bot-1');
  insert into public.league_standings (league_id, user_id, wins, losses) values
    (lm, a_uid::text, 1, 0), (lm, b_uid::text, 0, 1), (lm, c_uid::text, 0, 1), (lm, 'bot-1', 1, 0);
  insert into public.drafts (league_id, user_id, symbol, entry_price, quantity, round, pick_number)
  values (lm, a_uid::text, 'AAPL', 100, 1, 1, 1);
  insert into public.trades (league_id, user_id, symbol, action, quantity, price, total_value)
  values (lm, a_uid, 'AAPL', 'sell', 1, 110, 110);

  insert into public.leagues (name, commissioner_id, invite_code, num_participants, league_type)
  values ('__ACCTDEL_LP__', b_uid::text, 'AP' || upper(substr(sfx, 1, 8)), 4, 'duration') returning id into lp;
  insert into public.league_members (league_id, user_id, role) values
    (lp, b_uid::text, 'commissioner'), (lp, a_uid::text, 'member');

  insert into public.leagues (name, commissioner_id, invite_code, num_participants, league_type, num_weeks, playoff_teams)
  values ('__ACCTDEL_LA__', c_uid::text, 'AA' || upper(substr(sfx, 1, 8)), 4, 'matchup', 1, 2) returning id into la;
  insert into public.league_members (league_id, user_id, role) values
    (la, c_uid::text, 'commissioner'), (la, a_uid::text, 'member'), (la, b_uid::text, 'member');
  update public.leagues set draft_status = 'completed', draft_started_at = now(), season_status = 'completed' where id = la;
  insert into public.league_seasons (league_id, season_number, completed_at, champion_user_id, runner_up_user_id)
  values (la, 1, now(), a_uid::text, b_uid::text);
  insert into public.matchups (league_id, week_number, team1_user_id, team2_user_id, team1_gain, team2_gain, winner_user_id)
  values (la, 1, a_uid::text, b_uid::text, 9, 1, a_uid::text);
  insert into public.trades (league_id, user_id, symbol, action, quantity, price, total_value)
  values (la, a_uid, 'MSFT', 'buy', 1, 10, 10);
  update public.league_members set hidden_at = now() where league_id = la and user_id = a_uid::text;

  -- ---- S: the scrub, as the edge function calls it --------------------------------
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  begin
    res := public.scrub_deleted_manager(a_uid);
    out := out || format(E'S1 scrub without ledger -> %s  %s\n', res,
      case when res ->> 'reason' = 'no_ledger' then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'S1 scrub without ledger -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;
  begin
    res := public.account_deletion_open(a_uid, false);
    res := public.scrub_deleted_manager(a_uid);
    select commissioner_id into got from public.leagues where id = lm;
    select r.departed -> 0 ->> 'name' into got2 from public.league_roster_reconfirm r where r.league_id = lp;
    select count(*) into n from public.league_members where league_id = lp and user_id = a_uid::text;
    out := out || format(E'S2 LM commissioner=%s LP member rows=%s reconfirm name=%s  %s\n',
      case when got = b_uid::text then 'B' else got end, n, got2,
      case when res ->> 'status' = 'scrubbed' and got = b_uid::text and n = 0 and got2 = lbl then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'S2 scrub -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;
  begin
    select count(*) into n from public.league_members
     where user_id = a_uid::text and league_id in (lm, la) and deleted_at is not null
       and frozen_username is null and frozen_avatar is null and frozen_at is null;
    select count(*) into n2 from public.user_profiles where id = a_uid;
    n2 := n2 + (select count(*) from public.push_tokens where user_id = a_uid);
    -- The stage as the scrub reported it: service_role has no table access to the
    -- ledger (by design; G6), so it cannot read the row itself.
    out := out || format(E'S3 deleted seats=%s/2 profile+tokens left=%s stage=%s  %s\n', n, n2, res ->> 'stage',
      case when n = 2 and n2 = 0 and res ->> 'stage' = 'scrubbed' then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'S3 seats -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;
  begin
    select count(*) into n from public.league_notifications where league_id in (lm, lp, la);
    res := public.scrub_deleted_manager(a_uid);
    select count(*) into n2 from public.league_notifications where league_id in (lm, lp, la);
    out := out || format(E'S4 re-run notices %s -> %s, successions=%s left=%s  %s\n', n, n2,
      res -> 'successions', res -> 'left',
      case when n = n2 and res -> 'successions' = '[]'::jsonb and res -> 'left' = '[]'::jsonb
                and res -> 'seats_marked' = '[]'::jsonb then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'S4 re-run -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;

  -- ---- V: what a leaguemate sees ---------------------------------------------------
  reset role;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', b_uid, 'role', 'authenticated')::text, true);
  begin
    select display_name into got from public.get_league_display_names(lm) where user_id = a_uid::text;
    select display_name into got2 from public.get_league_display_names(la) where user_id = a_uid::text;
    out := out || format(E'V1 LM=%s LA=%s  %s\n', got, got2,
      case when got = lbl and got2 = lbl then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'V1 display names -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;
  begin
    select username || '/' || coalesce(avatar, '<null>') into got
      from public.get_visible_profiles(array[a_uid::text]) where id = a_uid;
    out := out || format(E'V2 visible A = %s  %s\n', got, case when got = lbl || '/<null>' then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'V2 visible -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;
  begin
    res := public.create_takeover_invite(lm, a_uid::text);
    code := res ->> 'code';
  exception when others then out := out || format(E'T1 create code -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;

  -- ---- T: the takeover, as join-league calls it ----------------------------------
  reset role;
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  begin
    res := public.takeover_preview(code, e_uid);
    out := out || format(E'P1 preview ok=%s league=%s record=%s-%s keys=%s  %s\n', res ->> 'ok', res ->> 'league_name',
      res ->> 'wins', res ->> 'losses', (select string_agg(k, ',' order by k) from jsonb_object_keys(res) k),
      case when res ->> 'ok' = 'true' and res ->> 'league_name' = '__ACCTDEL_LM__' and (res ->> 'wins')::numeric = 1
                and (res ->> 'losses')::numeric = 0
                and (select string_agg(k, ',' order by k) from jsonb_object_keys(res) k) = 'league_name,losses,ok,rank,wins'
           then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'P1 preview -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;
  begin
    select count(*) into n from public.matchups where league_id = lm and (team1_user_id = a_uid::text or team2_user_id = a_uid::text);
    res := public.take_over_team(code, e_uid);
    select (select count(*) from public.matchups where league_id = lm and (team1_user_id = e_uid::text or team2_user_id = e_uid::text))
         + (select count(*) from public.league_standings where league_id = lm and user_id = e_uid::text)
         + (select count(*) from public.drafts where league_id = lm and user_id = e_uid::text)
         + (select count(*) from public.trades where league_id = lm and user_id = e_uid)
         + (select count(*) from public.league_members where league_id = lm and user_id = e_uid::text and deleted_at is null)
      into n2;
    out := out || format(E'T1 takeover=%s rows moved=%s (expect %s) old left=%s  %s\n', res ->> 'status', n2, n + 4,
      (select count(*) from public.league_members where league_id = lm and user_id = a_uid::text),
      case when res ->> 'status' = 'taken_over' and n2 = n + 4
                and not exists (select 1 from public.league_members where league_id = lm and user_id = a_uid::text)
           then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'T1 takeover -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;
  begin
    res2 := public.take_over_team(code, f_uid);
    out := out || format(E'T2 second taker -> %s  %s\n', res2 ->> 'reason',
      case when res2 ->> 'reason' = 'taken' then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'T2 second taker -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;

  begin
    res := public.join_league_by_code(code, f_uid::text);
    out := out || format(E'T3 takeover code via join_league_by_code -> %s  %s\n', res ->> 'reason',
      case when res ->> 'reason' = 'invalid_code' then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'T3 join with takeover code -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;

  -- ---- D: the auth delete -----------------------------------------------------------
  reset role;
  perform set_config('request.jwt.claims', '', true);
  -- ---- K: the Vault round-trip, as the OWNER (the definer functions run as it; this
  -- proves it may write and delete vault.secrets in THIS project; PGlite only has a stub) -------
  begin
    res  := public.account_deletion_stash_apple_token(a_uid, 'fixture-refresh-' || sfx);
    got  := public.account_deletion_apple_token(a_uid) ->> 'token';
    res2 := public.account_deletion_apple_revoked(a_uid);
    select count(*) into n from vault.secrets where name = 'apple_revoke:' || a_uid::text;
    out := out || format(E'K1 vault stash=%s read=%s revoked=%s left=%s  %s\n', res ->> 'apple_revoke',
      got = 'fixture-refresh-' || sfx, res2 ->> 'apple_revoke', n,
      case when res ->> 'apple_revoke' = 'pending' and got = 'fixture-refresh-' || sfx
                and res2 ->> 'apple_revoke' = 'done' and n = 0 then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'K1 vault round-trip -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;

  begin
    select count(*) into n from public.trades where user_id = a_uid;
    delete from auth.users where id = a_uid;
    select count(*) into n2 from public.trades where user_id = a_uid;
    res := public.account_deletion_mark_done(a_uid);
    out := out || format(E'D1 trades %s -> %s, mark_done=%s  %s\n', n, n2, res ->> 'stage',
      case when n = 1 and n2 = 1 and res ->> 'stage' = 'done' then 'PASS' else 'FAIL' end);
  exception when others then out := out || format(E'D1 auth delete -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;

  select string_agg(f, ' ') into acl from unnest(svc_fns) f
   where has_function_privilege('anon', (select p.oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
                                          where s.nspname = 'public' and p.proname = f limit 1), 'execute')
      or has_function_privilege('authenticated', (select p.oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
                                                   where s.nspname = 'public' and p.proname = f limit 1), 'execute');
  out := out || format(E'N1 anon/authenticated can execute: %s  %s\n', coalesce(acl, 'none'),
    case when acl is null then 'PASS' else 'FAIL' end);

  -- Deliberate: rolls back every fixture and shows the result.
  raise exception E'ACCOUNT DELETION EFFECT TEST: % (all rolled back)\n%',
    case when out ~ 'FAIL' then 'FAIL' else 'PASS' end
      || format(' (%s/22 lines PASS)', (select count(*) from regexp_matches(out, 'PASS\n', 'g'))), out;
end;
$$;
