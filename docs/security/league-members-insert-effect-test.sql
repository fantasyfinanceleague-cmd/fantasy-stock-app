-- ============================================================================
-- LEAGUE_MEMBERS INSERT-SELF EFFECT TEST — run in the Supabase SQL editor.
-- Safe to run BOTH before and after `db push` of 20261001000000 (rollback-safe
-- either way — see the shape note below). Read-only in effect: NOTHING
-- persists.
-- ============================================================================
-- Why this shape:
--   * The SQL editor shows only the LAST statement's output, and a failing
--     statement aborts a transaction. So every case runs in its own
--     BEGIN/EXCEPTION sub-block (a savepoint) and records its outcome, and the
--     block ENDS BY RAISING — which rolls back the fixture and every write,
--     and puts the result table in the editor's error panel.
--   * Role/claims are switched with set_config(..., true), the same mechanism
--     PostgREST uses, so auth.uid() and RLS behave exactly as for a real call.
--
-- EXPECTED OUTPUT, BEFORE the push of 20261001000000 (baseline — reproduces
-- the finding; run this first if you want to confirm the vulnerable state):
--   1  stranger self-insert (member)         -> rows=1   FAIL (finding)
--   1b stranger self-insert (commissioner)   -> rows=1   FAIL (finding)
--   2  creator self-insert own league        -> rows=1   PASS
--   2r creator self-insert + RETURNING       -> row returned   PASS
--   2u creator self-insert via upsert        -> rows=1   PASS
--   3  creator self-insert as 'member'       -> rows=1   FAIL (finding)
--   4  member inserts ANOTHER user           -> 42501    PASS
--   5  creator rejoins mid-draft league      -> rows=1   FAIL (finding)
--   6  member adds bot ([I6], untouched)     -> rows=1   PASS
--
-- EXPECTED OUTPUT, AFTER the push of 20261001000000:
--   1  stranger self-insert (member)         -> 42501    PASS
--   1b stranger self-insert (commissioner)   -> 42501    PASS
--   2  creator self-insert own league        -> rows=1   PASS
--   2r creator self-insert + RETURNING       -> row returned   PASS
--   2u creator self-insert via upsert        -> rows=1   PASS
--   3  creator self-insert as 'member'       -> 42501    PASS (by design)
--   4  member inserts ANOTHER user           -> 42501    PASS
--   5  creator rejoins mid-draft league      -> 42501    PASS
--   6  member adds bot ([I6], untouched)     -> rows=1   PASS
-- Any line not matching its column's expectation for the state you're
-- testing is a real finding: stop and report it.
-- ============================================================================
do $$
declare
  a_uid    text := gen_random_uuid()::text;   -- fixture creator/commissioner
  b_uid    text := gen_random_uuid()::text;   -- fixture other-league commissioner
  m_uid    text := gen_random_uuid()::text;   -- fixture member of B's league
  s_uid    text := gen_random_uuid()::text;   -- fixture stranger, no membership anywhere
  l_new    uuid;                              -- A-commissioned, not_started, no members
  l_ret    uuid;                              -- A-commissioned, not_started, no members
  l_up     uuid;                              -- A-commissioned, not_started, no members
  l_mem    uuid;                              -- A-commissioned, not_started, no members
  l_other  uuid;                              -- B-commissioned, not_started, members B+M
  l_live   uuid;                              -- A-commissioned, in_progress, A not a member
  n        int;
  ret_id   text;
  out      text := E'\n';
begin
  -- ---- fixtures (as the editor's own role; bypasses RLS) --------------------
  insert into public.leagues (name, commissioner_id, invite_code, num_participants, draft_status)
  values ('__LM_TEST_NEW__', a_uid, 'LMT-' || gen_random_uuid(), 4, 'not_started')
  returning id into l_new;

  insert into public.leagues (name, commissioner_id, invite_code, num_participants, draft_status)
  values ('__LM_TEST_RET__', a_uid, 'LMT-' || gen_random_uuid(), 4, 'not_started')
  returning id into l_ret;

  insert into public.leagues (name, commissioner_id, invite_code, num_participants, draft_status)
  values ('__LM_TEST_UP__', a_uid, 'LMT-' || gen_random_uuid(), 4, 'not_started')
  returning id into l_up;

  insert into public.leagues (name, commissioner_id, invite_code, num_participants, draft_status)
  values ('__LM_TEST_MEM__', a_uid, 'LMT-' || gen_random_uuid(), 4, 'not_started')
  returning id into l_mem;

  insert into public.leagues (name, commissioner_id, invite_code, num_participants, draft_status)
  values ('__LM_TEST_OTHER__', b_uid, 'LMT-' || gen_random_uuid(), 4, 'not_started')
  returning id into l_other;

  insert into public.leagues (name, commissioner_id, invite_code, num_participants, draft_status)
  values ('__LM_TEST_LIVE__', a_uid, 'LMT-' || gen_random_uuid(), 4, 'in_progress')
  returning id into l_live;

  insert into public.league_members (league_id, user_id, role) values
    (l_other, b_uid, 'commissioner'), (l_other, m_uid, 'member');

  -- ---- become the stranger (no membership anywhere) --------------------------
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', s_uid, 'role', 'authenticated')::text, true);

  -- 1: stranger self-inserts into someone else's league as 'member', knowing
  --    only the league UUID. This is the finding's core threat.
  begin
    insert into public.league_members (league_id, user_id, role) values (l_other, s_uid, 'member');
    get diagnostics n = row_count;
    out := out || format(E'1  stranger (member)       -> rows=%s\n', n);
  exception when others then
    out := out || format(E'1  stranger (member)       -> %s %s\n', sqlstate,
      case when sqlstate = '42501' then 'PASS' else 'FAIL (' || sqlerrm || ')' end);
  end;

  -- 1b: same, forging role='commissioner' (grants no commissioner POWERS --
  --     is_commissioner() reads leagues.commissioner_id, not this column --
  --     but still grants membership itself, and is_commissioner()-independent
  --     of it, so leaving it un-narrowed still admits membership escalation).
  begin
    insert into public.league_members (league_id, user_id, role) values (l_other, s_uid, 'commissioner');
    get diagnostics n = row_count;
    out := out || format(E'1b stranger (commissioner) -> rows=%s\n', n);
  exception when others then
    out := out || format(E'1b stranger (commissioner) -> %s %s\n', sqlstate,
      case when sqlstate = '42501' then 'PASS' else 'FAIL (' || sqlerrm || ')' end);
  end;

  -- ---- become A, the creator --------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', a_uid, 'role', 'authenticated')::text, true);

  -- 2: the legitimate create-league shape (no RETURNING) -- useLeagues.js:150,
  --    create-league.tsx:150, leagues.tsx:233 all send this.
  begin
    insert into public.league_members (league_id, user_id, role) values (l_new, a_uid, 'commissioner');
    get diagnostics n = row_count;
    out := out || format(E'2  creator self-insert     -> rows=%s  %s\n', n, case when n = 1 then 'PASS' else 'FAIL' end);
  exception when others then
    out := out || format(E'2  creator self-insert     -> %s FAIL (%s)\n', sqlstate, sqlerrm);
  end;

  -- 2r: same shape but with RETURNING, simulating a client that later chains
  --     `.select()`. Exercises the INSERT..RETURNING SELECT-policy visibility
  --     trap from 58518d4/9a2518b directly: the new WITH CHECK is a subset of
  --     the old one, and the SELECT policy's direct `user_id = auth.uid()`
  --     clause (20260811000005) does not depend on this migration.
  begin
    insert into public.league_members (league_id, user_id, role) values (l_ret, a_uid, 'commissioner')
    returning user_id into ret_id;
    out := out || format(E'2r creator + RETURNING     -> row=%s  PASS\n', ret_id);
  exception when others then
    out := out || format(E'2r creator + RETURNING     -> %s FAIL (%s)\n', sqlstate, sqlerrm);
  end;

  -- 2u: the web client's actual call is an upsert
  --     (INSERT ... ON CONFLICT (league_id, user_id) DO UPDATE). Exercises the
  --     INSERT arm of that upsert under the new policy.
  begin
    insert into public.league_members (league_id, user_id, role) values (l_up, a_uid, 'commissioner')
    on conflict (league_id, user_id) do update set role = excluded.role;
    get diagnostics n = row_count;
    out := out || format(E'2u creator upsert          -> rows=%s  %s\n', n, case when n = 1 then 'PASS' else 'FAIL' end);
  exception when others then
    out := out || format(E'2u creator upsert          -> %s FAIL (%s)\n', sqlstate, sqlerrm);
  end;

  -- 3: creator self-inserts into their OWN league as 'member' rather than
  --    'commissioner'. No legitimate call site does this (join runs as
  --    service_role, not under this policy) -- refused by design.
  begin
    insert into public.league_members (league_id, user_id, role) values (l_mem, a_uid, 'member');
    get diagnostics n = row_count;
    out := out || format(E'3  creator as member       -> rows=%s\n', n);
  exception when others then
    out := out || format(E'3  creator as member       -> %s %s\n', sqlstate,
      case when sqlstate = '42501' then 'PASS (by design)' else 'FAIL (' || sqlerrm || ')' end);
  end;

  -- 5: creator rejoins their OWN league mid-draft (l_live is 'in_progress').
  --    This is the computeDraftOrder reshuffle vector the draft_status clause
  --    closes -- e.g. a commissioner who left via [I5] re-inserting themselves.
  begin
    insert into public.league_members (league_id, user_id, role) values (l_live, a_uid, 'commissioner');
    get diagnostics n = row_count;
    out := out || format(E'5  creator rejoins mid-draft -> rows=%s\n', n);
  exception when others then
    out := out || format(E'5  creator rejoins mid-draft -> %s %s\n', sqlstate,
      case when sqlstate = '42501' then 'PASS' else 'FAIL (' || sqlerrm || ')' end);
  end;

  -- ---- become M, an existing member of B's league -----------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', m_uid, 'role', 'authenticated')::text, true);

  -- 4: a member tries to insert ANOTHER user (the stranger S) into their own
  --    league. Already refused today (user_id = auth.uid() alone blocks it);
  --    this migration does not change that -- included as a control.
  begin
    insert into public.league_members (league_id, user_id, role) values (l_other, s_uid, 'member');
    get diagnostics n = row_count;
    out := out || format(E'4  member inserts another  -> rows=%s  FAIL\n', n);
  exception when others then
    out := out || format(E'4  member inserts another  -> %s %s\n', sqlstate,
      case when sqlstate = '42501' then 'PASS' else 'FAIL (' || sqlerrm || ')' end);
  end;

  -- 6: [I6] control, untouched by this migration -- a member may still add a
  --    bot to their own league at any time. Documents the residual reshuffle
  --    vector through bots (tracked separately: see
  --    supabase/migrations/deferred/20260929000000_drop_I6_I2b.sql).
  begin
    insert into public.league_members (league_id, user_id, role) values (l_other, 'bot-' || gen_random_uuid(), 'member');
    get diagnostics n = row_count;
    out := out || format(E'6  member adds bot ([I6])  -> rows=%s  %s\n', n, case when n = 1 then 'PASS' else 'FAIL' end);
  exception when others then
    out := out || format(E'6  member adds bot ([I6])  -> %s FAIL (%s)\n', sqlstate, sqlerrm);
  end;

  -- Deliberate: rolls back the fixture and every write above, and displays `out`.
  raise exception 'LEAGUE_MEMBERS INSERT-SELF EFFECT TEST RESULTS (all rolled back):%', out;
end;
$$;
