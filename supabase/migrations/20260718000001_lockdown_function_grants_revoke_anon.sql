-- ============================================================================
-- LOCKDOWN follow-up: strip lingering explicit anon/authenticated EXECUTE grants
-- ============================================================================
-- Discovered while verifying 20260718000000: REVOKE ... FROM PUBLIC does NOT
-- remove the per-role grants Supabase adds by default. Supabase runs
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public
--     GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
-- so every function created in `public` is born with explicit anon=X,
-- authenticated=X, service_role=X entries IN ADDITION to the built-in PUBLIC=X.
-- REVOKE ... FROM PUBLIC only clears the PUBLIC entry; the explicit anon=X and
-- authenticated=X survive. Proven on prod: start_new_league_season still showed
-- anon=X/postgres after 20260718000000's REVOKE ... FROM PUBLIC.
--
-- Consequence: the "revoke from public" lockdowns in 20260716000000
-- (join_league_by_code, check_and_bump_rate_limit) and 20260712000000
-- (is_member, is_commissioner) likely LEFT anon/authenticated able to EXECUTE.
-- For the two service_role-only RPCs that is a real authz bypass — e.g. a client
-- could call join_league_by_code directly with a forged p_user_id.
--
-- This migration re-asserts the intended reachability EXPLICITLY per role.
-- Idempotent: REVOKE of an absent grant is a no-op; GRANT of a present one too.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- start_new_league_season(uuid) — reachable by: authenticated (mobile client
-- calls it directly via supabase.rpc) + internal commissioner gate. NOT anon.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION start_new_league_season(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION start_new_league_season(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION start_new_league_season(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- join_league_by_code(text, text) — service_role ONLY. The edge function calls
-- it with the secret key (service_role) and injects the JWT-verified user id.
-- anon/authenticated MUST NOT execute it, or a client forges p_user_id.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION join_league_by_code(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION join_league_by_code(text, text) FROM anon;
REVOKE ALL ON FUNCTION join_league_by_code(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION join_league_by_code(text, text) TO service_role;

-- ----------------------------------------------------------------------------
-- check_and_bump_rate_limit(text, text, int, int) — service_role ONLY. Called
-- by preview-league / join-league via the secret key. No client should bump it.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION check_and_bump_rate_limit(text, text, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION check_and_bump_rate_limit(text, text, int, int) FROM anon;
REVOKE ALL ON FUNCTION check_and_bump_rate_limit(text, text, int, int) FROM authenticated;
GRANT EXECUTE ON FUNCTION check_and_bump_rate_limit(text, text, int, int) TO service_role;

-- ----------------------------------------------------------------------------
-- is_member(uuid) / is_commissioner(uuid) — authenticated KEEPS execute: the B1
-- RLS policies call these and are evaluated as the querying (authenticated)
-- role. anon never evaluates those policies (they are TO authenticated), so anon
-- does not need them. Strip anon for tidiness / least privilege.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION is_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION is_member(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION is_member(uuid) TO authenticated;

REVOKE ALL ON FUNCTION is_commissioner(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION is_commissioner(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION is_commissioner(uuid) TO authenticated;
