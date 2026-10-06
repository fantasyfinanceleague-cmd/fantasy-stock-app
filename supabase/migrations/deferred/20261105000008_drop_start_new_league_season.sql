-- ============================================================================
-- DROP: start_new_league_season — HELD in deferred/ (not in the db push path)
-- ============================================================================
-- Phase 0 of Run it back (20261105000007_lock_start_new_league_season.sql)
-- revoked EXECUTE from every API role, so the function is already
-- unreachable. This file removes it outright. Precondition and verification:
-- supabase/migrations/deferred/README.md, section for this file.
--
-- Why it is held rather than applied with the revoke:
--   * the 1.0.0 / 1.1.0 mobile builds still render the "Start New Season"
--     button (apps/mobile/app/league-settings.tsx). After the revoke they get
--     a 42501 error alert; after a DROP they would get a PGRST202 "function not
--     found" alert instead. Both fail closed, but the revoke keeps the function
--     restorable (owner-only EXECUTE) until no shipped client calls it;
--   * nothing server-side calls it (grep supabase/functions, scripts).
--
-- One overload exists (uuid). IF EXISTS keeps a re-run harmless.
-- ============================================================================

DROP FUNCTION IF EXISTS public.start_new_league_season(uuid);
