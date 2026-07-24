-- ============================================================================
-- LOCKDOWN sweep: remaining SECURITY DEFINER functions with false-closed grants
-- ============================================================================
-- Systemic follow-up to 20260718000001. A full inventory of SECURITY DEFINER
-- functions found THREE more carrying the default anon=X / authenticated=X grants
-- (Supabase's ALTER DEFAULT PRIVILEGES; see 20260718000001 header) despite being
-- intended for service_role / owner only. None was ever explicitly revoked, so
-- all three are anon-callable over PostgREST today.
--
-- Intended reachability verified by tracing callers (no client .rpc calls; the
-- cron edge functions call them via the admin client = SB_SECRET_KEY_INTERNAL =
-- service_role). Idempotent: REVOKE of an absent grant is a no-op.
-- ----------------------------------------------------------------------------

-- complete_league_season(uuid, text, text) — records champion + snapshots final
-- standings + sets season_status='completed'. Called ONLY by process-week-results
-- (cron, service_role) at process-week-results/index.ts:747,791. Anon-callable
-- today = forge a champion and force ANY league to 'completed' (destructive
-- integrity). service_role ONLY.
REVOKE ALL ON FUNCTION complete_league_season(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_league_season(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION complete_league_season(uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION complete_league_season(uuid, text, text) TO service_role;

-- schedule_snapshot_retry(text, int) — schedules a pg_cron retry of a snapshot
-- job. Called ONLY by snapshot-week-end/start (cron, service_role) at
-- snapshot-week-end/index.ts:90, snapshot-week-start/index.ts:122. Anon-callable
-- today = schedule arbitrary cron entries. service_role ONLY.
REVOKE ALL ON FUNCTION schedule_snapshot_retry(text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION schedule_snapshot_retry(text, int) FROM anon;
REVOKE ALL ON FUNCTION schedule_snapshot_retry(text, int) FROM authenticated;
GRANT EXECUTE ON FUNCTION schedule_snapshot_retry(text, int) TO service_role;

-- trigger_week_end_snapshot() — MANUAL recovery helper. SECURITY DEFINER; reads
-- the `cron_apikey` vault secret and net.http_post()s to the snapshot-week-end
-- edge function. No client and no automated caller (grep found none) — it is run
-- by a human in the SQL editor as `postgres` (owner, bypasses grants). Anon-
-- callable today = force a vault-key-authenticated snapshot run with no auth.
-- Strip ALL client roles; grant to no one (owner runs it directly). If an
-- automated service_role path is ever added, grant service_role then.
REVOKE ALL ON FUNCTION trigger_week_end_snapshot() FROM PUBLIC;
REVOKE ALL ON FUNCTION trigger_week_end_snapshot() FROM anon;
REVOKE ALL ON FUNCTION trigger_week_end_snapshot() FROM authenticated;
