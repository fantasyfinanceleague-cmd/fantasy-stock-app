-- ============================================================================
-- LOCKDOWN sweep, deferred decision: get_real_user_ids(text[]) — drop anon
-- ============================================================================
-- Follow-up to the 20260718000000-000002 SECURITY DEFINER grant audit. That
-- sweep blanket-revoked anon on functions carrying Supabase's DEFAULT-PRIVILEGE
-- anon=X artifact (ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE TO anon; see the
-- 20260718000001 header). get_real_user_ids was deliberately EXCLUDED from that
-- blanket pass because its anon grant is NOT the default artifact -- it is an
-- EXPLICIT `grant execute ... to anon;` written by hand in
-- 20250122000000_check_real_users.sql:16. An intentional grant warranted a
-- decision, not an auto-revoke. This migration is that decision: revoke it.
--
-- WHY anon is unnecessary (verified 2026-07-24):
--   * The function filters a caller-supplied list of user_ids down to those that
--     exist in auth.users -- a real/bot membership signal, no PII (no email,
--     name, or metadata crosses the boundary). SECURITY DEFINER is what lets it
--     read auth.users past RLS at all.
--   * Sole call site: apps/web/src/pages/DraftPage.jsx:315
--     supabase.rpc('get_real_user_ids', ...), inside an effect guarded by
--     `if (!authUser?.id) return;` and behind the <Protected> route. No anon
--     (logged-out) code path -- web, mobile, or edge function -- invokes it.
--   * It is a confirmation oracle over random v4 UUIDs (unguessable keyspace),
--     returning one low-value bit per supplied id. Fine for `authenticated`;
--     no reason to expose it pre-auth. authenticated grant intentionally KEPT.
--
-- Idempotent: REVOKE of an absent grant is a no-op; GRANT of a present one too.
-- ----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION get_real_user_ids(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_real_user_ids(text[]) FROM anon;
GRANT EXECUTE ON FUNCTION get_real_user_ids(text[]) TO authenticated;
