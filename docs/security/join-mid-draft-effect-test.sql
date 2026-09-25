-- ============================================================================
-- JOIN-MID-DRAFT EFFECT TEST — run in the Supabase SQL editor AFTER `db push`
-- of 20260930000000_join_league_refuse_mid_draft.sql. Read-only in effect:
-- NOTHING persists. Same shape as docs/security/f1-f6-effect-test.sql.
-- ============================================================================
-- Why this shape:
--   * join_league_by_code is SECURITY DEFINER (owned by postgres) so it
--     bypasses RLS regardless of caller — the thing worth exercising here is
--     the FUNCTION'S OWN logic (draft_status branch, precedence vs. the other
--     refusal reasons, and that a refusal does not mutate state), plus that
--     the GRANT/REVOKE on the function itself is actually enforced at call
--     time (case H), not just visible in pg_proc.proacl.
--   * The SQL editor shows only the LAST statement's output, and a failing
--     statement aborts a transaction. So every case runs in its own
--     BEGIN/EXCEPTION sub-block (a savepoint) and records its outcome, and the
--     block ENDS BY RAISING — which rolls back the fixture and every write,
--     and puts the result table in the editor's error panel.
--   * num_participants=4 to satisfy the CHECK (between 4 and 16) added in
--     20250819185319 — 2 (used by the older f1-f6 fixture) is no longer valid.
--
-- EXPECTED OUTPUT (the final "ERROR:" text):
--   A  not_started, room             -> ok=true,  row inserted     PASS
--   B  in_progress                   -> draft_started, no row      PASS
--   C  completed                     -> draft_started, no row      PASS
--   D  existing member, in_progress  -> already_member (not draft_started) PASS
--   E  invite code, in_progress      -> draft_started, invite still pending PASS
--   F  full, not_started             -> league_full (unchanged)    PASS
--   G  season completed              -> season_completed (unchanged, beats draft_status) PASS
--   H  authenticated role forbidden  -> 42501 insufficient_privilege PASS
-- Any FAIL line is a real finding: stop and report it.
-- ============================================================================
do $$
declare
  c_uid  text := gen_random_uuid()::text;   -- fixture commissioner (all leagues)
  m_uid  text := gen_random_uuid()::text;   -- existing member (case D)
  j_uid  text := gen_random_uuid()::text;   -- joining user (cases A/B/C/E/F/G/H)
  l_a    uuid;  -- not_started, room for one more
  l_b    uuid;  -- in_progress
  l_c    uuid;  -- completed
  l_d    uuid;  -- in_progress, j_uid already a member
  l_e    uuid;  -- in_progress, joined via league_invites code (not leagues.invite_code)
  l_f    uuid;  -- not_started, already at capacity (4/4)
  l_g    uuid;  -- season_status = completed
  inv_e  uuid;
  code_a text := 'JMDA-' || substr(gen_random_uuid()::text, 1, 8);
  code_b text := 'JMDB-' || substr(gen_random_uuid()::text, 1, 8);
  code_c text := 'JMDC-' || substr(gen_random_uuid()::text, 1, 8);
  code_d text := 'JMDD-' || substr(gen_random_uuid()::text, 1, 8);
  code_e text := 'JMDE-INVITE-' || substr(gen_random_uuid()::text, 1, 8);
  code_e_league text := 'JMDE-' || substr(gen_random_uuid()::text, 1, 8);
  code_f text := 'JMDF-' || substr(gen_random_uuid()::text, 1, 8);
  code_g text := 'JMDG-' || substr(gen_random_uuid()::text, 1, 8);
  res    jsonb;
  n      int;
  out    text := E'\n';

begin
  -- ---- fixture (as the editor's own role; bypasses RLS) ---------------------
  insert into public.leagues (name, commissioner_id, invite_code, num_participants, draft_status)
  values ('__JMD_A__', c_uid, code_a, 4, 'not_started') returning id into l_a;
  insert into public.league_members (league_id, user_id, role) values (l_a, c_uid, 'commissioner');

  insert into public.leagues (name, commissioner_id, invite_code, num_participants, draft_status)
  values ('__JMD_B__', c_uid, code_b, 4, 'in_progress') returning id into l_b;
  insert into public.league_members (league_id, user_id, role) values (l_b, c_uid, 'commissioner');

  insert into public.leagues (name, commissioner_id, invite_code, num_participants, draft_status)
  values ('__JMD_C__', c_uid, code_c, 4, 'completed') returning id into l_c;
  insert into public.league_members (league_id, user_id, role) values (l_c, c_uid, 'commissioner');

  insert into public.leagues (name, commissioner_id, invite_code, num_participants, draft_status)
  values ('__JMD_D__', c_uid, code_d, 4, 'in_progress') returning id into l_d;
  insert into public.league_members (league_id, user_id, role) values
    (l_d, c_uid, 'commissioner'), (l_d, j_uid, 'member');   -- j_uid already joined before draft started

  insert into public.leagues (name, commissioner_id, invite_code, num_participants, draft_status)
  values ('__JMD_E__', c_uid, code_e_league, 4, 'in_progress') returning id into l_e;
  insert into public.league_members (league_id, user_id, role) values (l_e, c_uid, 'commissioner');
  insert into public.league_invites (league_id, inviter_id, invited_identifier, code, status)
  values (l_e, c_uid, 'jmd-test@example.invalid', code_e, 'pending') returning id into inv_e;

  insert into public.leagues (name, commissioner_id, invite_code, num_participants, draft_status)
  values ('__JMD_F__', c_uid, code_f, 4, 'not_started') returning id into l_f;
  insert into public.league_members (league_id, user_id, role) values
    (l_f, c_uid, 'commissioner'), (l_f, gen_random_uuid()::text, 'member'),
    (l_f, gen_random_uuid()::text, 'member'), (l_f, gen_random_uuid()::text, 'member');  -- 4/4, full

  insert into public.leagues (name, commissioner_id, invite_code, num_participants, draft_status, season_status)
  values ('__JMD_G__', c_uid, code_g, 4, 'not_started', 'completed') returning id into l_g;
  insert into public.league_members (league_id, user_id, role) values (l_g, c_uid, 'commissioner');

  -- ---- become service_role (the only role with EXECUTE; matches the
  --      join-league edge function's admin client) --------------------------
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);

  -- A: not_started, room -> ok, row inserted.
  begin
    res := join_league_by_code(code_a, j_uid);
    select count(*) into n from public.league_members where league_id = l_a and user_id = j_uid;
    out := out || format(E'A  not_started        -> %s rows=%s  %s\n', res, n,
      case when (res->>'ok')::boolean = true and n = 1 then 'PASS' else 'FAIL' end);
  exception when others then
    out := out || format(E'A  not_started        -> %s FAIL (%s)\n', sqlstate, sqlerrm);
  end;

  -- B: in_progress -> draft_started, no row.
  begin
    res := join_league_by_code(code_b, j_uid);
    select count(*) into n from public.league_members where league_id = l_b and user_id = j_uid;
    out := out || format(E'B  in_progress        -> %s rows=%s  %s\n', res, n,
      case when res->>'reason' = 'draft_started' and n = 0 then 'PASS' else 'FAIL' end);
  exception when others then
    out := out || format(E'B  in_progress        -> %s FAIL (%s)\n', sqlstate, sqlerrm);
  end;

  -- C: completed -> draft_started, no row. (Confirms 'completed' is refused
  --    too, not just 'in_progress' -- see migration header comment.)
  begin
    res := join_league_by_code(code_c, j_uid);
    select count(*) into n from public.league_members where league_id = l_c and user_id = j_uid;
    out := out || format(E'C  draft completed    -> %s rows=%s  %s\n', res, n,
      case when res->>'reason' = 'draft_started' and n = 0 then 'PASS' else 'FAIL' end);
  exception when others then
    out := out || format(E'C  draft completed    -> %s FAIL (%s)\n', sqlstate, sqlerrm);
  end;

  -- D: j_uid already a member of an in_progress league -> already_member, NOT
  --    draft_started (already_member must win -- an existing member re-
  --    submitting the code mid-draft still gets the idempotent-success path).
  begin
    res := join_league_by_code(code_d, j_uid);
    out := out || format(E'D  existing member    -> %s  %s\n', res,
      case when res->>'reason' = 'already_member' then 'PASS' else 'FAIL' end);
  exception when others then
    out := out || format(E'D  existing member    -> %s FAIL (%s)\n', sqlstate, sqlerrm);
  end;

  -- E: league_invites-code path, in_progress -> draft_started, AND the
  --    invite is NOT consumed (still 'pending' -- refusal happens before the
  --    UPDATE league_invites SET status='accepted').
  begin
    res := join_league_by_code(code_e, j_uid);
    out := out || format(E'E  invite, in_progress -> %s  %s\n', res,
      case when res->>'reason' = 'draft_started'
             and (select status from public.league_invites where id = inv_e) = 'pending'
           then 'PASS' else 'FAIL' end);
  exception when others then
    out := out || format(E'E  invite, in_progress -> %s FAIL (%s)\n', sqlstate, sqlerrm);
  end;

  -- F: not_started but at capacity -> league_full (unchanged precedence:
  --    draft_started check passes since draft hasn't started, so it correctly
  --    falls through to the capacity check).
  begin
    res := join_league_by_code(code_f, j_uid);
    out := out || format(E'F  full, not_started  -> %s  %s\n', res,
      case when res->>'reason' = 'league_full' then 'PASS' else 'FAIL' end);
  exception when others then
    out := out || format(E'F  full, not_started  -> %s FAIL (%s)\n', sqlstate, sqlerrm);
  end;

  -- G: season_status = 'completed' -> season_completed, even though
  --    draft_status = 'not_started' here (season_completed is checked BEFORE
  --    draft_status in the function body, so it must win).
  begin
    res := join_league_by_code(code_g, j_uid);
    out := out || format(E'G  season completed   -> %s  %s\n', res,
      case when res->>'reason' = 'season_completed' then 'PASS' else 'FAIL' end);
  exception when others then
    out := out || format(E'G  season completed   -> %s FAIL (%s)\n', sqlstate, sqlerrm);
  end;

  -- ---- become authenticated (a real client, publishable-key shape) ---------
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', j_uid, 'role', 'authenticated')::text, true);

  -- H: EXECUTE is revoked from authenticated -> must be refused at the
  --    call itself (42501), not merely absent from pg_proc.proacl. This is
  --    the call-time counterpart to the proacl verification query in the
  --    migration file -- CLAUDE.md: "verify with the proacl query, never
  --    assume revoke-from-public closed it" applies doubly to a function
  --    whose grants were only RE-ASSERTED (not newly added) by this change.
  begin
    res := join_league_by_code(code_a, j_uid);
    out := out || format(E'H  authenticated call -> %s  FAIL (should have been refused)\n', res);
  exception when others then
    out := out || format(E'H  authenticated call -> %s %s\n', sqlstate,
      case when sqlstate = '42501' then 'PASS' else 'FAIL (' || sqlerrm || ')' end);
  end;

  -- Deliberate: rolls back the fixture and every write above, and displays `out`.
  raise exception 'JOIN-MID-DRAFT EFFECT TEST RESULTS (all rolled back):%', out;
end;
$$;
