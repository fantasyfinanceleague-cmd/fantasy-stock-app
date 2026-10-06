/**
 * Which cron_job_status writes may land on a same-day row.
 *
 * S-STATUS — THE DEFECT: cron_job_status is one row per job per day (unique
 * job_name, run_date) and every run upserts it. The 22:00Z heal ran after Friday's
 * 21:15Z run and overwrote its "processed N" result with a no-op 'success', so the
 * evidence of the one run that did work was lost (success-signals family, CLAUDE.md).
 *
 * THE RULE (narrow, no migration; the per-run run-log table is deferred):
 *   - failed / retrying are ALWAYS written. A failure must never be hidden.
 *   - success with work > 0 is ALWAYS written. It is the new evidence.
 *   - a success (any work) DOES overwrite a same-day 'retrying'. 'retrying' means
 *     "a retry is scheduled", not a final result, so a later attempt that completes
 *     cleanly must clear it (S3). A failed row is final and is never cleared by a
 *     no-op.
 *   - running and success with work = 0 (intermediate, or a no-op) are otherwise
 *     written ONLY when the existing same-day row is itself trivial: no row, a
 *     'running' row, or a success that recorded work = 0. A no-op never replaces
 *     evidence of earlier work or of a failure. Such a run is logged, not written.
 *
 * A pre-existing success row carries no work= marker, and is therefore NOT trivial.
 * That keeps Friday's already-written success safe from a no-op heal.
 *
 * Pure: no DB. See job-status.test.ts.
 */

export type JobStatusValue = 'running' | 'success' | 'failed' | 'retrying';

export interface StoredJobStatus {
  status: JobStatusValue;
  error_message: string | null;
}

/** Parse the work count from a message written as "work=N ...". null if absent. */
export function workFromMessage(message: string | null | undefined): number | null {
  const m = /^work=(\d+)\b/.exec(message ?? '');
  return m ? Number(m[1]) : null;
}

/** The message a successful run records, so its work count survives later no-op runs. */
export function successMessage(work: number, detail = ''): string {
  return `work=${work}${detail ? ` ${detail}` : ''}`;
}

export function shouldWriteJobStatus(
  existing: StoredJobStatus | null,
  next: { status: JobStatusValue; work?: number },
): boolean {
  if (next.status === 'failed' || next.status === 'retrying') return true;
  if (next.status === 'success' && (next.work ?? 0) > 0) return true;
  // S3: a clean success clears a scheduled-retry marker, whatever its work count.
  if (next.status === 'success' && existing?.status === 'retrying') return true;
  // running, or a success that did no work: only over a trivial same-day row.
  if (!existing) return true;
  if (existing.status === 'running') return true;
  return existing.status === 'success' && workFromMessage(existing.error_message) === 0;
}

/**
 * The write decision when the same-day row may not have been readable.
 *
 * A failed read must not let a trivial write overwrite evidence, so when the read
 * failed only the writes the rule ALWAYS accepts go through: failed, retrying, and
 * a success with work. (The snapshot handlers inline this same expression.)
 */
export function decideJobStatusWrite(
  existing: StoredJobStatus | null,
  readFailed: boolean,
  next: { status: JobStatusValue; work?: number },
): boolean {
  if (readFailed) {
    return next.status === 'failed' || next.status === 'retrying' ||
      (next.status === 'success' && (next.work ?? 0) > 0);
  }
  return shouldWriteJobStatus(existing, next);
}
