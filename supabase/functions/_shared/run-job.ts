/**
 * runJob: every cron handler's run is bracketed by exactly one 'running' write and
 * exactly one terminal write, by construction.
 *
 * THE DEFECT THIS REMOVES (CLAUDE.md "Success signals" #6): process-week-results
 * wrote 'running', then had two early returns that wrote no terminal status, so
 * its row stayed 'running' forever on its commonest path. The fix at the time was
 * a comment saying "every return must write a terminal status first". A comment is
 * not a guarantee: the next early return can forget it.
 *
 * Here the handler body cannot return a response WITHOUT a terminal outcome: its
 * return type is JobRun, { outcome, response }, so a new early return that omits
 * the outcome fails to compile, and one that supplies it is written by this
 * function and nowhere else. A throw routes to `onThrow`, which must also produce
 * an outcome (the snapshot jobs schedule their retry there).
 *
 * What is NOT here, deliberately:
 *   - the auth check and the missing-config guard run BEFORE runJob. A caller who
 *     fails auth must not be able to forge or spam status rows, and there is no
 *     client to write with before config exists. "No row by T+30m" is the
 *     monitoring signal for did-not-run.
 *   - the retry policy. onThrow owns it; this wrapper only guarantees the write.
 *
 * Status writes are telemetry: a writer that throws is swallowed (logged) so the
 * handler's response is exactly what the body produced.
 */

import type { JobStatusValue } from './job-status.ts';

export interface JobOutcome {
  /** A terminal state. 'running' is not an outcome, so it cannot be returned. */
  status: Exclude<JobStatusValue, 'running'>;
  /** Passed to the writer as the attempt number. */
  attempt: number;
  /** Error text, or the success detail (the writer prefixes work=N). */
  message?: string;
  /** Rows/league-weeks the run changed. Drives the same-day no-op rule. */
  work?: number;
}

export interface JobRun<R> {
  outcome: JobOutcome;
  response: R;
}

export type JobStatusWriter = (
  status: JobStatusValue,
  attempt: number,
  message?: string,
  work?: number,
) => Promise<unknown>;

export async function runJob<R>(args: {
  attempt: number;
  write: JobStatusWriter;
  body: () => Promise<JobRun<R>>;
  onThrow: (e: unknown) => Promise<JobRun<R>>;
}): Promise<R> {
  const { attempt, write, body, onThrow } = args;

  const safeWrite: JobStatusWriter = async (status, a, message, work) => {
    try {
      return await write(status, a, message, work);
    } catch (e) {
      console.error(`cron_job_status '${status}' write threw:`, e);
    }
  };

  await safeWrite('running', attempt);

  let run: JobRun<R>;
  try {
    run = await body();
  } catch (e) {
    try {
      run = await onThrow(e);
    } catch (e2) {
      // The failure handler itself failed. Still leave a terminal row, then let
      // the platform turn the rethrow into a 500.
      await safeWrite('failed', attempt, String(e2));
      throw e2;
    }
  }

  await safeWrite(run.outcome.status, run.outcome.attempt, run.outcome.message, run.outcome.work);
  return run.response;
}
