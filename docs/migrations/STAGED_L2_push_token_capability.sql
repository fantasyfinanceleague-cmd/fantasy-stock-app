-- ============================================================================
-- STAGED — NOT A LIVE MIGRATION. Do NOT place in supabase/migrations/ yet.
-- L2: expo_push_token is a bearer capability readable by every authenticated user
-- ============================================================================
-- Staged in docs/ deliberately: `supabase db push` applies ALL pending files, so
-- a file sitting in supabase/migrations/ can be applied by an unrelated push
-- before its prerequisites ship. security-reviewer flagged exactly that hazard,
-- and this repo has the precedent (STAGED_drop_i7_league_invites_accept.sql).
-- The LOCATION is the control; the ⛔ comment is only documentation.
--
-- ---------------------------------------------------------------------------
-- THE FINDING: the token is a CAPABILITY, not an identifier.
--
-- apps/mobile/lib/notifications.ts sendPushNotification() POSTs to
--   https://exp.host/--/api/v2/push/send
-- with NO Authorization header, NO access token, NO secret — the body is just
-- `{ to: <token>, title, body, data }`. Possession is sufficient to push an
-- arbitrary titled / bodied / deep-linked notification to that device. Verified
-- by reading the function, not assumed.
--
-- Every authenticated user could read every other user's token, because
-- user_profiles' SELECT policy is table-wide (`TO authenticated USING (true)`
-- after 20260728000001). Item 2 closed ANON; it explicitly did not close this.
-- Net live capability: any logged-in user can push arbitrary notifications to
-- any other user's phone — a spam and phishing primitive.
--
-- WHY ROW-SCOPING IS THE WRONG SHAPE: tightening the profile SELECT policy to
-- self-only would break league member displays — username/avatar are read
-- cross-user by matchup.tsx:258, league.tsx:263, leagues.tsx:96, draft.tsx:92,
-- LeagueCarousel:75, useHomeData:326, player-portfolio:122 and web
-- UserProfilesContext:26. Cross-user read of username/avatar is a product
-- requirement. Only the token column is a capability.
--
-- ===========================================================================
-- ⚠️ WHY THE FIRST DRAFT OF THIS FILE WAS WRONG — READ BEFORE CHOOSING
--
-- It started as a column-level revoke:
--   REVOKE SELECT (expo_push_token) ON user_profiles FROM authenticated, anon;
-- That closes the PostgREST vector and nothing else. security-reviewer found,
-- and I then confirmed directly, that it leaves the leak fully open on web:
--
--   * user_profiles IS in the supabase_realtime publication
--     (20251210100000_create_user_profiles.sql:50).
--   * apps/web/src/context/UserProfilesContext.jsx:98-115 subscribes with
--     { event: '*', table: 'user_profiles' } and NO column filter — Realtime has
--     no column-selection mechanism at all. The client only USES username and
--     avatar from the payload, but the payload is the whole row.
--   * Realtime authorizes by RLS ONLY. It is architecturally blind to column
--     privileges, because the payload is built from the logical-replication
--     stream, not from a PostgREST SELECT that Postgres could reject. With the
--     SELECT policy at USING (true), every authenticated subscriber passes.
--   * savePushToken() UPDATEs expo_push_token on essentially every app open, and
--     Postgres ships the full NEW row for every INSERT/UPDATE change event
--     regardless of REPLICA IDENTITY (that setting governs only the OLD image).
--
-- So a column revoke would have produced a change that READS as a fix, PASSES a
-- PostgREST-based test, and still broadcasts every token to every connected web
-- session. Recorded because the failure mode is this repo's recurring one: the
-- mechanism looked right and the verification would have been run against the
-- wrong vector.
-- ===========================================================================
--
-- ---------------------------------------------------------------------------
-- RECOMMENDED: move the token to an owner-scoped table.
--
-- Decisive reason, not tidiness: RLS — not column grants — governs Realtime
-- authorization. An owner-only-RLS table that is NOT in the supabase_realtime
-- publication structurally cannot leak through either vector, so the PostgREST
-- hole and the Realtime hole close together instead of needing two separate
-- mitigations. It also removes the profile.tsx:61 `select('*')` blocker
-- entirely, since the column is no longer on a table that call site reads.
--
-- PHASE 1 — must ship FIRST (no SQL; edge function + client):
--   A `send-notification` edge function, verify_jwt = true, that:
--     (a) resolves the caller from the JWT;
--     (b) AUTHORIZES TARGET — caller and target share a league. This check does
--         not exist today in ANY form: any user can currently push to any other
--         user, leaguemate or not.
--     (c) AUTHORIZES CONTENT — takes a CLOSED notification_type enum (e.g.
--         'draft_turn') and derives title/body/data SERVER-SIDE from verified
--         state. It must NOT accept caller-supplied title/body: authorizing only
--         the target still lets any user push arbitrary phishing content to a
--         legitimate leaguemate, which is the primitive the finding is about.
--     (d) reads the token with the service_role admin client and POSTs to Expo.
--   notifyDraftTurn keeps its signature and calls the function, so
--   draft.tsx:273 needs no change.
--
-- PHASE 2 — the SQL below, only after phase 1 has shipped and been verified.
-- ---------------------------------------------------------------------------

-- Owner-scoped token store. Deliberately NOT added to supabase_realtime.
CREATE TABLE IF NOT EXISTS push_tokens (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

-- Owner-only, all operations. service_role bypasses RLS and is how the
-- send-notification edge function reads tokens — no policy needed for it.
CREATE POLICY "own token select" ON push_tokens
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own token insert" ON push_tokens
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own token update" ON push_tokens
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own token delete" ON push_tokens
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Backfill from the old column. notifications_enabled STAYS on user_profiles —
-- it is a preference flag, not a capability, and profile.tsx renders it.
INSERT INTO push_tokens (user_id, token)
SELECT id, expo_push_token
FROM user_profiles
WHERE expo_push_token IS NOT NULL
ON CONFLICT (user_id) DO UPDATE SET token = EXCLUDED.token, updated_at = now();

-- Drop the capability off the broadcast surface. THIS is the line that actually
-- closes the Realtime vector — while the column exists on a published table, a
-- revoke does not stop it being broadcast.
ALTER TABLE user_profiles DROP COLUMN IF EXISTS expo_push_token;

-- ============================================================================
-- VERIFICATION (human-run, after phase 1 + this)
--   1. Column gone from the published table:
--      SELECT column_name FROM information_schema.columns
--      WHERE table_name='user_profiles' AND column_name='expo_push_token';
--      -- expect: zero rows
--   2. push_tokens is NOT published (the Realtime vector):
--      SELECT tablename FROM pg_publication_tables
--      WHERE pubname='supabase_realtime' AND tablename='push_tokens';
--      -- expect: zero rows
--   3. Owner-only read holds: as authenticated user A,
--      `select * from push_tokens` returns ONLY A's row, never B's.
--   4. Realtime no longer carries a token: subscribe as a NON-OWNER web client,
--      trigger a token write for another user, inspect the payload — expect no
--      token field at all. This is the test the column-revoke approach would
--      have passed vacuously; run it explicitly.
--   5. End-to-end: a real draft turn still delivers a notification, and its
--      title/body come from the server-side enum, not the client.
-- ============================================================================
