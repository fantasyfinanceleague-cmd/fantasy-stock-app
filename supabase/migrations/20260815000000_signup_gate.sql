-- Server-side signup gate (backend-signup-gate).
--
-- WHY: today the pause is client-only (apps/web/src/App.jsx APP_PAUSED). Anyone can
-- bypass it by editing the bundle and calling supabase.auth.signUp() directly, and
-- mobile has no gate at all. This moves the security boundary server-side: while
-- paused, GoTrue itself refuses NEW account creation via a Before User Created auth
-- hook. Sign-in is untouched (the hook fires only on user CREATION), so existing
-- accounts keep full access.
--
-- The pause state lives in a DB row (public.app_config.signups_paused), flippable by
-- Giorgio with a single UPDATE — no code deploy. An allowlist lets specific emails
-- through while paused (invited testers), also without a deploy.
--
-- ============================================================================
-- HUMAN ACTION (Giorgio) — this migration is AUTHORED, NOT APPLIED.
-- ============================================================================
--   1. Review, then `supabase db push`.
--   2. Enable the hook: Dashboard -> Authentication -> Hooks (Beta) ->
--      "Before User Created" -> Postgres -> schema public, function
--      restrict_new_signups.  (This is the toggle that makes the gate live;
--      the function does nothing until GoTrue is told to call it.)
--   3. Verify the grant took (per CLAUDE.md — REVOKE FROM PUBLIC does NOT clear
--      Supabase's default anon/authenticated grants; confirm the proacl):
--        SELECT proname, proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--        WHERE n.nspname='public' AND proname='restrict_new_signups';
--      -> proacl must show supabase_auth_admin=X and NOT anon=X / authenticated=X.
--   4. Effect-verify the gate (not the push output): with signups_paused=true, a
--      signup with a non-allowlisted email must be refused; signInWithPassword for
--      an existing user must still succeed.
--   5. To LAUNCH (open signups):  UPDATE public.app_config SET signups_paused = false;
--      To allow a tester while paused:
--        INSERT INTO public.signup_allowlist (email) VALUES (lower('them@example.com'));
--
-- NOTE: the client APP_PAUSED flag remains, but only as landing-page UX — it is no
-- longer the security boundary. The two flags are independent: APP_PAUSED=false with
-- signups_paused=true is the "existing users in, new signups closed" state.

-- ---------------------------------------------------------------------------
-- 1. Pause flag: single-row typed config table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_config (
  -- id is a constant TRUE so the table can hold at most one row.
  id             boolean     PRIMARY KEY DEFAULT true CHECK (id),
  signups_paused boolean     NOT NULL DEFAULT true,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.app_config IS
  'Single-row server config. signups_paused gates the Before User Created auth hook. Admin/definer-only (RLS on, no client policies).';

-- Seed the one row (paused by default — matches the current pre-launch state).
INSERT INTO public.app_config (id, signups_paused) VALUES (true, true)
  ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Allowlist: emails permitted to sign up even while paused. Store lowercased.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.signup_allowlist (
  email    text        PRIMARY KEY CHECK (email = lower(email)),
  note     text,
  added_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.signup_allowlist IS
  'Emails allowed to sign up while signups_paused=true. Lowercased. Admin/definer-only.';

-- ---------------------------------------------------------------------------
-- 3. RLS: both tables are admin/definer-only. RLS ON with NO policies denies all
--    client (anon/authenticated) access; the SECURITY DEFINER hook (owned by the
--    table owner) bypasses RLS, and service_role/dashboard manage the rows.
-- ---------------------------------------------------------------------------
ALTER TABLE public.app_config       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signup_allowlist ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 4. The Before User Created hook function.
--    Contract (Supabase docs): input jsonb { metadata, user }, email at
--    event->'user'->>'email'. Return {} to ALLOW; return
--    { "error": { "message": ..., "http_code": ... } } to REFUSE (message is
--    propagated to the client). SECURITY DEFINER + pinned search_path so it reads
--    the config tables as owner without exposing them to clients, and so unqualified
--    names never resolve via the caller's path (CLAUDE.md definer footgun).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.restrict_new_signups(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email  text := lower(nullif(event -> 'user' ->> 'email', ''));
  v_paused boolean;
BEGIN
  SELECT signups_paused INTO v_paused FROM public.app_config WHERE id = true;

  -- Fail CLOSED: if the config row is missing/unreadable, treat as paused. A gate
  -- that errs should refuse a signup, never wave one through during a pause.
  IF v_paused IS NULL THEN
    v_paused := true;
  END IF;

  -- Open: allow everyone.
  IF NOT v_paused THEN
    RETURN '{}'::jsonb;
  END IF;

  -- Paused but explicitly allowlisted: allow.
  IF v_email IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.signup_allowlist a WHERE a.email = v_email) THEN
    RETURN '{}'::jsonb;
  END IF;

  -- Paused, not allowlisted: refuse with a clear, user-facing message.
  RETURN jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'Stockpile is not open for new signups yet — check back soon. Existing accounts can still sign in.'
    )
  );
END;
$$;

COMMENT ON FUNCTION public.restrict_new_signups(jsonb) IS
  'Before User Created auth hook: refuses new signups while app_config.signups_paused, except allowlisted emails. Wire in Dashboard -> Auth -> Hooks.';

-- ---------------------------------------------------------------------------
-- 5. Grants. GoTrue calls the hook as supabase_auth_admin, which needs EXECUTE
--    (and USAGE on the schema). Everyone else is revoked — including Supabase's
--    default anon/authenticated grants, which REVOKE FROM PUBLIC alone does NOT
--    clear (CLAUDE.md), so revoke them explicitly.
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.restrict_new_signups(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.restrict_new_signups(jsonb) FROM anon, authenticated, PUBLIC;
