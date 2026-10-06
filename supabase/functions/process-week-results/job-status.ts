/**
 * cron_job_status messages for process-week-results, and the re-export of its
 * writer primitive (now in ../_shared/job-status-io.ts), so the write's failure
 * handling stays pinned by hermetic tests (see job-status.test.ts). No Deno APIs;
 * the client is passed in, so a stub stands in for supabase-js.
 *
 * Two contracts, both learned the hard way (CLAUDE.md "Success signals"):
 *
 * 1. supabase-js resolves `.upsert()` to { data, error } and does NOT throw on
 *    a Postgres error (#5). The previous writer awaited the upsert and
 *    discarded the result, so a rejected write (e.g. a status value outside
 *    the CHECK constraint) was invisible. We destructure and check `error`;
 *    the try/catch only covers transport failures.
 *
 * 2. The status write is ops telemetry, not part of the scoring result. It
 *    NEVER throws — a failed write is logged and reported via the boolean
 *    return, and the caller's HTTP response is unchanged. A throw here would
 *    have turned the no-pending 200 into the catch block's 500, or recursed
 *    into a second failed status write.
 */

// The raw upsert primitive and its types live in _shared/job-status-io.ts (shared
// with the other cron handlers); re-exported so this module's tests, which pin the
// writer's failure handling, keep importing from here. The handler itself writes
// through writeJobStatus + runJob (index.ts), which add the same-day overwrite rule.
//
// There is no distinct "nothing to do" status in the CHECK constraint; the
// no-pending path writes 'success' and says so in the message (see
// noPendingMessage / scoredMessage).
export { updateJobStatus } from '../_shared/job-status-io.ts';
export type { JobStatus, JobStatusClient } from '../_shared/job-status-io.ts';

/**
 * Suffix for season transitions (playoff start / non-playoff completion) that
 * were refused. Every refusal writes nothing, so the heal pass retries it next
 * run. Empty when there were none, so a clean run's message is unchanged.
 */
function transitionsSuffix(transitionsRefused: number): string {
  return transitionsRefused > 0
    ? `; ${transitionsRefused} season transitions refused (see skipped[]; retried next run)`
    : '';
}

/** Summary for the common weekly path: the run completed with nothing to score. */
export function noPendingMessage(transitionsRefused = 0): string {
  return 'processed 0 matchups: no pending matchups' + transitionsSuffix(transitionsRefused);
}

/**
 * Summary for a run that reached scoring. `refusedCount` is the number of
 * eligibility refusals in the handler's skipped[] — whole league-weeks (batch guards) and single matchups
 * (per-matchup guard) refused by the eligibility guards, left pending. A
 * success row with a nonzero refused count is NOT a clean week (CLAUDE.md
 * "Success signals" #4).
 */
export function scoredMessage(processedCount: number, refusedCount: number, transitionsRefused = 0): string {
  return `processed ${processedCount} matchups; ${refusedCount} refused by eligibility guards (batches or matchups, left pending)` +
    transitionsSuffix(transitionsRefused);
}
