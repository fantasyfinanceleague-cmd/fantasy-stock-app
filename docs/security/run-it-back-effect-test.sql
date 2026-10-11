-- ============================================================================
-- Run it back phase 1: EFFECT TEST (run AFTER db push, in the SQL editor)
-- ============================================================================
-- Runs as the editor's role (postgres), switches to the commissioner's JWT, and
-- ALWAYS ends in RAISE, so the whole block rolls back: nothing is left behind.
-- The verdict is the error text: 'RUN IT BACK EFFECT TEST: PASS ...'.
--
-- It picks a completed matchup league whose commissioner id is UUID-shaped (never
-- a bot-* id) and that has no successor yet. Prefer a real test league.
--
-- PASS requires: the verdict starts with 'PASS', and nothing was persisted
-- (the RAISE rolls the block back).
-- ============================================================================
DO $$
DECLARE
  v_league    uuid;
  v_comm      text;
  v_res       jsonb;
  v_new       uuid;
  v_pending   int;
  v_gate_msg  text := 'NO ERROR';
  v_lin_msg   text := 'NO ERROR';
  v_acl_anon  boolean;
  v_acl_auth  boolean;
  v_acl_svc   boolean;
  v_verdict   text;
BEGIN
  SELECT l.id, l.commissioner_id INTO v_league, v_comm
  FROM leagues l
  WHERE l.league_type = 'matchup' AND l.season_status = 'completed'
    AND l.commissioner_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND NOT EXISTS (SELECT 1 FROM leagues n WHERE n.previous_league_id = l.id)
  ORDER BY l.created_at DESC
  LIMIT 1;
  IF v_league IS NULL THEN
    RAISE EXCEPTION 'RUN IT BACK EFFECT TEST: SETUP FAIL -- no completed league with a UUID-shaped commissioner and no successor';
  END IF;

  -- The commissioner's own JWT (the same mechanism the F1 effect test uses).
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comm, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_comm, true);

  v_res := public.renew_league(v_league);
  v_new := (v_res->>'league_id')::uuid;

  -- The gate: a draft date cannot be set while anyone is pending (as the commissioner).
  BEGIN
    UPDATE leagues SET draft_date = now() + interval '5 days' WHERE id = v_new;
    v_gate_msg := 'NO ERROR';
  EXCEPTION WHEN OTHERS THEN
    v_gate_msg := SQLERRM;
  END;

  -- The lineage guard: a direct write may not clear the predecessor link.
  BEGIN
    UPDATE leagues SET previous_league_id = NULL WHERE id = v_new;
    v_lin_msg := 'NO ERROR';
  EXCEPTION WHEN OTHERS THEN
    v_lin_msg := SQLERRM;
  END;

  PERFORM set_config('role', 'postgres', true);

  -- Read as the editor's role: no API role may read the replies table.
  SELECT count(*) INTO v_pending FROM league_renewal_responses
    WHERE league_id = v_new AND status = 'pending';

  SELECT has_function_privilege('anon', 'public.renew_league(uuid)', 'EXECUTE'),
         has_function_privilege('authenticated', 'public.renew_league(uuid)', 'EXECUTE'),
         has_function_privilege('service_role', 'public.renew_league(uuid)', 'EXECUTE')
    INTO v_acl_anon, v_acl_auth, v_acl_svc;

  v_verdict := format(
    'status=%s invited=%s pending=%s | gate=[%s] | lineage=[%s] | renew_league: anon=%s authenticated=%s service_role=%s',
    v_res->>'status', v_res->>'invited', v_pending, v_gate_msg, v_lin_msg, v_acl_anon, v_acl_auth, v_acl_svc);

  IF v_res->>'status' = 'renewed'
     AND v_gate_msg LIKE 'renewal_replies_pending%'
     AND v_lin_msg LIKE 'renewal_lineage_locked%'
     AND v_acl_anon = false AND v_acl_auth = true AND v_acl_svc = false THEN
    RAISE EXCEPTION 'RUN IT BACK EFFECT TEST: PASS -- % (league % commissioner %; rolled back)', v_verdict, v_league, v_comm;
  END IF;
  RAISE EXCEPTION 'RUN IT BACK EFFECT TEST: FAIL -- % (league % commissioner %; rolled back)', v_verdict, v_league, v_comm;
END $$;
