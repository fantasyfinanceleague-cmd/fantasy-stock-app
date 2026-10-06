/**
 * cron_job_status I/O shared by every cron handler.
 *
 * Two layers:
 *   updateJobStatus  the RAW upsert primitive (moved verbatim from
 *                    process-week-results/job-status.ts, which re-exports it).
 *                    Always writes. Pinned by that directory's job-status.test.ts.
 *   writeJobStatus   the layer handlers use: reads today's row, applies the
 *                    same-day overwrite rule (job-status.ts), then upserts.
 *
 * WHY writeJobStatus EXISTS: cron_job_status is one row per job per day. Since the
 * 22:00Z and Saturday heals (20261019000000) process-week-results runs three times
 * a week against ONE row. Its writer upserted unconditionally, so the 22:00Z no-op
 * heal wrote 'running', then "no pending matchups", over the 21:15Z run's
 * "processed N" (or its 'failed'). The snapshot jobs had the rule; this function
 * did not (success-signals family, CLAUDE.md).
 *
 * Contracts (CLAUDE.md "Success signals" #5, #6):
 *   - supabase-js resolves `.upsert()` / `.select()` to { data, error } and does
 *     NOT throw on a Postgres error. Both results are checked.
 *   - A status write is telemetry. It NEVER throws, so it cannot change a
 *     handler's HTTP response or turn a 200 into the catch block's 500.
 *   - The return value says what happened ('written' | 'kept' | 'error'), so a
 *     caller or test can tell a kept no-op from a rejected write.
 */

import {
  decideJobStatusWrite,
  successMessage,
  type JobStatusValue,
  type StoredJobStatus,
} from './job-status.ts';

/** Must match the CHECK constraint on cron_job_status.status. */
export type JobStatus = JobStatusValue;

// Minimal structural slice of the supabase-js client the raw upsert touches.
export interface JobStatusClient {
  from(table: string): {
    upsert(
      row: Record<string, unknown>,
      opts: { onConflict: string },
    ): PromiseLike<{ error: { message?: string } | null }>;
  };
}

// The slice writeJobStatus needs: the upsert above plus the same-day read.
export interface JobStatusRwClient {
  from(table: string): {
    upsert(
      row: Record<string, unknown>,
      opts: { onConflict: string },
    ): PromiseLike<{ error: { message?: string } | null }>;
    select(columns: string): {
      eq(col: string, val: string): {
        eq(col: string, val: string): {
          maybeSingle(): PromiseLike<{
            data: StoredJobStatus | null;
            error: { message?: string } | null;
          }>;
        };
      };
    };
    // Only used to settle a stranded 'running' row (see writeJobStatus).
    update(values: Record<string, unknown>): {
      eq(col: string, val: string): {
        eq(col: string, val: string): {
          eq(col: string, val: string): {
            select(columns: string): PromiseLike<{
              data: unknown[] | null;
              error: { message?: string } | null;
            }>;
          };
        };
      };
    };
  };
}

/**
 * Upsert today's row for `jobName`. Returns true only if the database accepted
 * the write. Never throws.
 *
 * `message` goes in `error_message`, the only free-text column. On 'failed' it is
 * the error; on 'success' it is a run summary.
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

export type JobStatusWriteResult = 'written' | 'kept' | 'error';

/**
 * Write a status through the same-day overwrite rule. `work` is the run's own
 * count of things it changed; a success's message is stored as "work=N <detail>"
 * so a later no-op run can recognise it as evidence (job-status.ts).
 *
 * 'kept' = the rule declined the write because the existing same-day row is
 * evidence a no-op must not replace. That is logged, not an error.
 */
export async function writeJobStatus(
  supabase: JobStatusRwClient,
  jobName: string,
  status: JobStatus,
  attemptNumber: number,
  opts: { message?: string; work?: number } = {},
  now: Date = new Date(),
): Promise<JobStatusWriteResult> {
  const today = now.toISOString().split('T')[0];
  const message = status === 'success'
    ? successMessage(opts.work ?? 0, opts.message ?? '')
    : opts.message;

  let existing: StoredJobStatus | null = null;
  let readFailed = false;
  try {
    const { data, error } = await supabase
      .from('cron_job_status')
      .select('status, error_message')
      .eq('job_name', jobName)
      .eq('run_date', today)
      .maybeSingle();
    if (error) {
      readFailed = true;
      console.error(`Failed to read cron_job_status ${jobName} ${today}:`, error);
    } else {
      existing = data;
    }
  } catch (e) {
    readFailed = true;
    console.error(`Failed to read cron_job_status ${jobName} ${today} (transport):`, e);
  }

  if (!decideJobStatusWrite(existing, readFailed, { status, work: opts.work })) {
    // A failed READ must not leave the row at 'running' (success-signals #6): that is
    // byte-identical to a hung run. Settle it with an UPDATE that can only ever replace
    // a 'running' row, so it cannot destroy evidence it never saw.
    if (readFailed && status === 'success') {
      return await settleRunningRow(supabase, jobName, today, attemptNumber, message, now);
    }
    console.log(
      `cron_job_status ${jobName} ${today}: no-op '${status}' (work=${opts.work ?? 0}) kept existing ${existing?.status ?? 'unknown'} row`,
    );
    return 'kept';
  }
  const ok = await updateJobStatus(supabase, jobName, status, attemptNumber, message, now);
  return ok ? 'written' : 'error';
}

/**
 * Replace a same-day 'running' row with a terminal success, and nothing else. Used only
 * when today's row could not be read, so we cannot tell a trivial row from evidence:
 * the status='running' filter makes the UPDATE a no-op against anything but a row this
 * run (or a hung one) left behind. 'written' = a running row was settled; 'kept' = the
 * row was something else (or absent) and is untouched; 'error' = the update failed.
 */
async function settleRunningRow(
  supabase: JobStatusRwClient,
  jobName: string,
  today: string,
  attemptNumber: number,
  message: string | undefined,
  now: Date,
): Promise<JobStatusWriteResult> {
  try {
    const { data, error } = await supabase
      .from('cron_job_status')
      .update({
        status: 'success',
        attempt_number: attemptNumber,
        error_message: message || null,
        updated_at: now.toISOString(),
      })
      .eq('job_name', jobName)
      .eq('run_date', today)
      .eq('status', 'running')
      .select('status');
    if (error) {
      console.error(`Failed to settle running cron_job_status ${jobName} ${today}:`, error);
      return 'error';
    }
    return (data ?? []).length > 0 ? 'written' : 'kept';
  } catch (e) {
    console.error(`Failed to settle running cron_job_status ${jobName} ${today} (transport):`, e);
    return 'error';
  }
}
