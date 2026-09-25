/**
 * cron_job_status writer for process-week-results.
 *
 * Extracted from index.ts so the write's failure handling is pinned by
 * hermetic tests (see job-status.test.ts). No Deno APIs; the client is
 * passed in, so a stub stands in for supabase-js.
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

// Must match the CHECK constraint on cron_job_status.status
// (20260116000000_matchup_scoring_redesign.sql). There is no distinct
// "nothing to do" value; the no-pending path writes 'success' and says so in
// the message (see noPendingMessage / scoredMessage).
export type JobStatus = 'running' | 'success' | 'failed' | 'retrying';

// Minimal structural slice of the supabase-js client this writer touches.
export interface JobStatusClient {
  from(table: string): {
    upsert(
      row: Record<string, unknown>,
      opts: { onConflict: string },
    ): PromiseLike<{ error: { message?: string } | null }>;
  };
}

/**
 * Upsert today's row for `jobName`. Returns true only if the database
 * accepted the write. Never throws.
 *
 * `message` is stored in the `error_message` column — the only free-text
 * column the table has. On 'failed' it is the error; on 'success' it is a run
 * summary. Both success paths ALWAYS write a summary, so the column's
 * presence/absence is never a discriminator — read `status` for the outcome
 * and the text for what happened.
 */
export async function updateJobStatus(
  supabase: JobStatusClient,
  jobName: string,
  status: JobStatus,
  attemptNumber: number,
  message?: string,
  now: Date = new Date(),
): Promise<boolean> {
  const today = now.toISOString().split('T')[0];

  try {
    const { error } = await supabase
      .from('cron_job_status')
      .upsert({
        job_name: jobName,
        run_date: today,
        status,
        attempt_number: attemptNumber,
        error_message: message || null,
        updated_at: now.toISOString(),
      }, {
        onConflict: 'job_name,run_date',
      });

    if (error) {
      console.error(`Failed to write job status '${status}' for ${jobName}:`, error);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`Failed to write job status '${status}' for ${jobName} (transport):`, e);
    return false;
  }
}

/** Summary for the common weekly path: the run completed with nothing to score. */
export function noPendingMessage(): string {
  return 'processed 0 matchups: no pending matchups';
}

/**
 * Summary for a run that reached scoring. `refusedCount` is the length of the
 * handler's skipped[] — whole league-weeks (batch guards) and single matchups
 * (per-matchup guard) refused by the eligibility guards, left pending. A
 * success row with a nonzero refused count is NOT a clean week (CLAUDE.md
 * "Success signals" #4).
 */
export function scoredMessage(processedCount: number, refusedCount: number): string {
  return `processed ${processedCount} matchups; ${refusedCount} refused by eligibility guards (batches or matchups, left pending)`;
}
