-- ============================================================================
-- Gate user_profiles SELECT to authenticated (was PUBLIC / anon-readable)
-- ============================================================================
-- FINDING: policy "Anyone can view profiles" (20251210100000) is
-- `FOR SELECT USING (true)` with NO role restriction, so it applies to PUBLIC —
-- anon can read EVERY profile row: every username, avatar, and (since
-- 20260122000000) every expo_push_token and notifications_enabled flag.
--
-- WHY THIS MATTERS BEYOND THE ROW LEAK: migration 20260724000000 revoked anon
-- EXECUTE on get_real_user_ids — a function whose entire output is "which of
-- these UUIDs are real users". While the whole profile table is anon-readable,
-- that revoke buys nothing: the same question is answerable by selecting the
-- table directly. The two must be resolved together, and this raises the
-- profile table to match the revoke rather than lowering the revoke to match
-- the table.
--
-- CONSUMER TRACE (why gating is believed to break nothing) — every reader is
-- either post-authentication or RLS-bypassing:
--   * preview-league/index.ts:88 (join-by-code preview) reads profiles via the
--     ADMIN client (SB_SECRET_KEY_INTERNAL = service_role) -> bypasses RLS
--     entirely. The pre-auth-adjacent flow is IMMUNE to this change.
--   * apps/web: APP_PAUSED = true renders LandingPage only; every other route is
--     wrapped in <Protected>. No pre-auth profile read exists.
--   * Login.jsx:100 / login.tsx:59 are UPSERTS after `data.user` exists (session
--     established) — writes, governed by the unchanged insert/update policies.
--   * All remaining reads are inside authenticated mobile screens and hooks.
--
-- MECHANISM: anon retains the table-level SELECT grant Supabase issues by
-- default, but with no policy applicable to it, anon matches zero rows. That is
-- the same `TO authenticated` shape used by the B1 league-table policies.
-- (Contrast FUNCTION lockdowns, where a table-style approach is insufficient and
-- an explicit REVOKE ... FROM anon is required — see CLAUDE.md.)
--
-- SCOPE: SELECT only. The insert/update policies (auth.uid() = id) are correct
-- and deliberately untouched.
-- ============================================================================

DROP POLICY IF EXISTS "Anyone can view profiles" ON user_profiles;

-- Authenticated users may read all profiles: usernames and avatars are shown
-- across leagues (rosters, standings, matchups, draft board), so this stays
-- table-wide rather than per-user — it is the anon exposure being closed here,
-- not cross-user visibility between members.
CREATE POLICY "Authenticated users can view profiles"
ON user_profiles
FOR SELECT
TO authenticated
USING (true);
