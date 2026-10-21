// heal-account-deletions: the hourly heal for interrupted account deletions.
// Plan: docs/plans/2026-10-21-account-deletion.md §"Heal pass". The decisions live
// in run.ts (hermetically tested); this file wires the real clients.
//
// CRON ONLY: verify_jwt=false at the gateway, so the constant-time apikey check
// (_shared/cron-auth.ts, against SB_SECRET_KEY_CRON, failing closed) is the ENTIRE
// auth boundary. The cron posts here only WHERE heal_account_deletions_due()
// (20261125000010), so an idle hour makes no edge call.
//
// Exactly one 'running' and one terminal cron_job_status write, by construction
// (_shared/run-job.ts). The auth check and the missing-config guard run BEFORE
// runJob, so a caller who fails auth cannot forge or spam status rows.
//
// SUCCESS SIGNALS (CLAUDE.md): net.http_post is async, so cron.job_run_details
// says 'succeeded' on enqueue whatever the function answered. This cron sets
// timeout_milliseconds := 180000 (20261125000010), so net._http_response holds the
// function's real reply (or the gateway's 504) for about 6 hours, but it only says the
// function ANSWERED. The trustworthy check is the DATA: account_deletions rows reaching 'done'.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { makeLedgerDeps } from '../_shared/account-deletion-db.ts';
import { appleConfigFromEnv, revokeAppleToken } from '../_shared/apple-revoke.ts';
import { isAuthorized } from '../_shared/cron-auth.ts';
import { writeJobStatus, type JobStatusRwClient } from '../_shared/job-status-io.ts';
import { type JobRun, runJob } from '../_shared/run-job.ts';
import { type HealDeps, type HttpResult, runHeal } from './run.ts';

const JOB_NAME = 'heal-account-deletions';

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

/** A stable 12-hex-char tag for a user id: greppable in logs without logging the id. */
async function hashId(userId: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(userId));
  return Array.from(new Uint8Array(d)).slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (!isAuthorized(req)) return json({ error: 'Unauthorized' }, 401);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
  const SECRET_KEY = Deno.env.get('SB_SECRET_KEY_INTERNAL') ?? '';
  if (!SUPABASE_URL || !SECRET_KEY) {
    console.error('SUPABASE_URL/SB_SECRET_KEY_INTERNAL not configured');
    return json({ ok: false, reason: 'server_config_error' }, 500);
  }
  const admin = createClient(SUPABASE_URL, SECRET_KEY);
  const apple = appleConfigFromEnv((k) => Deno.env.get(k));

  return await runJob<Response>({
    attempt: 1,
    // Cast: checking the full supabase-js client against the writer's narrow slice
    // trips TS2589 (excessively deep); the writer's tests pin the slice.
    write: async (status, attempt, message, work) => {
      await writeJobStatus(admin as unknown as JobStatusRwClient, JOB_NAME, status, attempt, { message, work });
    },
    onThrow: async (e): Promise<JobRun<Response>> => {
      console.error('heal-account-deletions unhandled:', e instanceof Error ? e.name : 'error');
      return {
        outcome: { status: 'failed', attempt: 1, message: `unhandled: ${e instanceof Error ? e.name : 'error'}` },
        response: json({ ok: false, reason: 'unhandled' }, 500),
      };
    },
    body: async (): Promise<JobRun<Response>> => {
      const deps: HealDeps = {
        ...makeLedgerDeps(admin),
        appleConfigured: apple !== null,
        revokeAppleToken: (token) => revokeAppleToken(apple!, token),
        hashId,
      };
      const run: JobRun<HttpResult> = await runHeal(deps);
      return { outcome: run.outcome, response: json(run.response.body, run.response.status) };
    },
  });
});
