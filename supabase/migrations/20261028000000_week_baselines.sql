-- S9 (snapshot jobs hardening): a durable baseline-completion marker, one row per
-- league-week, written by snapshot-week-start when that week's baseline is COMPLETE:
-- rows written for every holder at the open, or nothing held at the open (zero rows
-- is then correct).
--
-- Why it exists: zero week_snapshots rows for a holder is ambiguous. "Week-start ran
-- and found nothing held" and "week-start never ran" look the same. week-end must
-- refuse the second when a holder held at the open (its mid-week rows would score a
-- partial portfolio), and must NOT refuse the first (every holder bought mid-week;
-- cc26857). The marker, checked against this week's open, tells them apart.
--
-- Access mirrors cron_job_status: service_role only (RLS + explicit per-role
-- revokes, because Supabase's default grants would otherwise apply).

CREATE TABLE IF NOT EXISTS public.week_baselines (
  league_id uuid NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  week_number integer NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  open_at timestamptz NOT NULL,
  open_session_date date NOT NULL,
  participants integer NOT NULL DEFAULT 0,
  rows_written integer NOT NULL DEFAULT 0,
  PRIMARY KEY (league_id, week_number)
);

ALTER TABLE public.week_baselines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_only" ON public.week_baselines;
CREATE POLICY "service_role_only" ON public.week_baselines
  FOR ALL TO service_role
  USING (auth.role() = 'service_role');

REVOKE ALL ON public.week_baselines FROM PUBLIC;
REVOKE ALL ON public.week_baselines FROM anon;
REVOKE ALL ON public.week_baselines FROM authenticated;
GRANT ALL ON public.week_baselines TO service_role;
