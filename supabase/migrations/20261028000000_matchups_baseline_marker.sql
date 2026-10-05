-- S9 (snapshot jobs hardening): a baseline-completion marker on matchups.
--
-- snapshot-week-start sets matchups.baseline_completed_at for a league-week ONLY
-- after that week's week_snapshots rows have committed (or, when nothing was held
-- at the open, after confirming that). It is never set at the window rewrite, and a
-- run that aborts on a price leaves it NULL.
--
-- Why it exists: zero week_snapshots rows is ambiguous. "Week-start ran and found
-- nothing held" and "week-start never ran" look the same. snapshot-week-end refuses
-- the second when the week has holdings, because closing it would score a partial
-- portfolio. The marker tells them apart. A season restart deletes the matchups
-- rows, so a stale marker from an earlier season cannot carry over.
--
-- Writes: service_role only. Clients never wrote matchups (the only writers are
-- service-role code paths; see 20261002000000), and RLS grants them SELECT only.
-- Supabase's default privileges would still give anon and authenticated table-level
-- write grants, so they are revoked explicitly here.

ALTER TABLE public.matchups ADD COLUMN IF NOT EXISTS baseline_completed_at timestamptz;

REVOKE INSERT, UPDATE, DELETE ON public.matchups FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.matchups FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.matchups FROM authenticated;
GRANT INSERT, UPDATE, DELETE ON public.matchups TO service_role;
