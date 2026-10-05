-- Append-only run log for the cron jobs. cron_job_status keeps ONE row per job per
-- day (the latest status), so a later run overwrites an earlier run's evidence. A
-- no-op heal can otherwise erase the one run that did the work. This table keeps
-- every terminal run: what it decided, its work count, and whether it actually
-- wrote the status row (written = false means a no-op kept an earlier same-day row;
-- the run is still logged).
--
-- Append-only is enforced by a trigger for UPDATE, DELETE and TRUNCATE, so it holds
-- for every role. Access mirrors cron_job_status: service_role only, with explicit
-- per-role revokes, including the identity sequence.

CREATE TABLE IF NOT EXISTS public.cron_job_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_name text NOT NULL,
  run_at timestamptz NOT NULL DEFAULT now(),
  attempt_number integer NOT NULL DEFAULT 1,
  status text NOT NULL CHECK (status IN ('success', 'failed', 'retrying')),
  work integer NOT NULL DEFAULT 0,
  written boolean NOT NULL,
  message text
);

CREATE INDEX IF NOT EXISTS cron_job_runs_job_run_at_idx ON public.cron_job_runs (job_name, run_at DESC);

ALTER TABLE public.cron_job_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_only" ON public.cron_job_runs;
CREATE POLICY "service_role_only" ON public.cron_job_runs
  FOR ALL TO service_role
  USING (auth.role() = 'service_role');

REVOKE ALL ON public.cron_job_runs FROM PUBLIC;
REVOKE ALL ON public.cron_job_runs FROM anon;
REVOKE ALL ON public.cron_job_runs FROM authenticated;
-- Supabase's default privileges also grant service_role ALL; narrow it to what the job needs.
REVOKE ALL ON public.cron_job_runs FROM service_role;
GRANT SELECT, INSERT ON public.cron_job_runs TO service_role;

-- The identity column's sequence is a separate object with its own default grants.
REVOKE ALL ON SEQUENCE public.cron_job_runs_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.cron_job_runs_id_seq FROM anon;
REVOKE ALL ON SEQUENCE public.cron_job_runs_id_seq FROM authenticated;
GRANT USAGE ON SEQUENCE public.cron_job_runs_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.cron_job_runs_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'cron_job_runs is append-only (% refused)', TG_OP;
END;
$$;

REVOKE ALL ON FUNCTION public.cron_job_runs_block_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cron_job_runs_block_mutation() FROM anon;
REVOKE ALL ON FUNCTION public.cron_job_runs_block_mutation() FROM authenticated;
REVOKE ALL ON FUNCTION public.cron_job_runs_block_mutation() FROM service_role;

CREATE OR REPLACE TRIGGER cron_job_runs_append_only
  BEFORE UPDATE OR DELETE ON public.cron_job_runs
  FOR EACH ROW EXECUTE FUNCTION public.cron_job_runs_block_mutation();

CREATE OR REPLACE TRIGGER cron_job_runs_no_truncate
  BEFORE TRUNCATE ON public.cron_job_runs
  FOR EACH STATEMENT EXECUTE FUNCTION public.cron_job_runs_block_mutation();
