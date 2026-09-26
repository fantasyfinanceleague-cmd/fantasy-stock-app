-- ============================================================================
-- F10 EFFECT TEST: run in the Supabase SQL editor AFTER `db push` of
-- 20261002000000_drop_client_schedule_insert_policies.sql. Read-only in
-- effect: NOTHING persists.
-- ============================================================================
-- Shape (same pattern as f1-f6 / join-mid-draft / league-members tests): one
-- DO block builds its own fixture league, switches role + JWT claims with
-- set_config(..., true) the way PostgREST does, runs each case in its own
-- BEGIN/EXCEPTION sub-block, then ENDS BY RAISING, which rolls everything back
-- and prints the results in the editor's error panel. Fixture uses
-- num_participants = 4 (leagues CHECK is 4..16).
--
-- EXPECTED OUTPUT after the push:
--   A  member inserts a matchup           -> 42501  PASS
--   B  member inserts a standings row     -> 42501  PASS
--   C  member can still SELECT matchups   -> ok     PASS
-- BEFORE the push (baseline), A and B report FAIL: the insert succeeds, which
-- reproduces F10.
-- ============================================================================
do $$
declare
  c_uid text := gen_random_uuid()::text;   -- fixture commissioner
  m_uid text := gen_random_uuid()::text;   -- fixture member (the attacker)
  l     uuid;
  n     int;
  out   text := E'\n';
begin
  -- fixture, as the editor's own role (bypasses RLS)
  insert into public.leagues (name, commissioner_id, invite_code, num_participants, draft_status)
  values ('__F10_TEST__', c_uid, 'F10T-' || gen_random_uuid(), 4, 'in_progress')
  returning id into l;
  insert into public.league_members (league_id, user_id, role)
  values (l, c_uid, 'commissioner'), (l, m_uid, 'member');

  -- become the member, as PostgREST would
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', m_uid, 'role', 'authenticated')::text, true);

  -- A: forge a matchup (the F10 attack)
  begin
    insert into public.matchups (league_id, week_number, team1_user_id, team2_user_id, week_start, week_end)
    values (l, 1, m_uid, c_uid, now(), now() + interval '4 days');
    out := out || E'A  member inserts a matchup           -> rows=1  FAIL (F10 still open)\n';
  exception
    when insufficient_privilege then out := out || E'A  member inserts a matchup           -> 42501  PASS\n';
    when others then out := out || format(E'A  member inserts a matchup           -> %s %s  CHECK\n', sqlstate, sqlerrm);
  end;

  -- B: write a standings row (zero-valued, the only shape F6 still allowed)
  begin
    insert into public.league_standings (league_id, user_id) values (l, m_uid);
    out := out || E'B  member inserts a standings row     -> rows=1  FAIL ([I9] still present)\n';
  exception
    when insufficient_privilege then out := out || E'B  member inserts a standings row     -> 42501  PASS\n';
    when others then out := out || format(E'B  member inserts a standings row     -> %s %s  CHECK\n', sqlstate, sqlerrm);
  end;

  -- C: reads must still work (SELECT policies are permanent)
  begin
    select count(*) into n from public.matchups where league_id = l;
    out := out || format(E'C  member can still SELECT matchups   -> ok (%s rows)  PASS\n', n);
  exception
    when others then out := out || format(E'C  member can still SELECT matchups   -> %s %s  FAIL\n', sqlstate, sqlerrm);
  end;

  -- Deliberate: rolls back the fixture and every write above, and displays `out`.
  raise exception 'F10 EFFECT TEST RESULTS (all rolled back):%', out;
end;
$$;
