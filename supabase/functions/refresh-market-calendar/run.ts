/**
 * refresh-market-calendar run.ts — the handler's decision logic with its I/O
 * injected, so every exit path can be tested hermetically (run.test.ts) instead of
 * only by reading index.ts as text. No Deno APIs, no network, no DB.
 *
 * Every path returns a JobRun: an HTTP result AND the terminal cron_job_status
 * outcome, which _shared/run-job.ts writes exactly once. There is no path that
 * produces a response without one.
 *
 * Why this job gets a status row at all: the snapshot jobs abort every league whose
 * week needs the calendar when coverage is stale (week-window.ts), so a refresh
 * that silently stops is a scoring outage a week later. Its cadence is daily, so
 * the one-row-per-day table fits it (unlike enrich-symbols' 144 runs a day).
 *
 * The outcome message is the reason code the response already carries, so a
 * monitoring query on cron_job_status reads the same word as net._http_response.
 */

import { planCalendarUpdate } from './plan.ts';
import type { JobRun } from '../_shared/run-job.ts';
import type { CalendarSession } from './plan.ts';

export type FetchCalendarResult =
  | { ok: true; raw: unknown }
  | { ok: false; reason: 'alpaca_fetch_failed'; status: number }
  | { ok: false; reason: 'alpaca_fetch_error' };

export interface CalendarRunDeps {
  fetchCalendar(fromIso: string, throughIso: string): Promise<FetchCalendarResult>;
  /** supabase-js resolves an rpc to { error }; it does not throw on a Postgres error. */
  applyCalendar(
    fromIso: string,
    throughIso: string,
    sessions: CalendarSession[],
  ): Promise<{ error: { message?: string } | null }>;
}

export interface HttpResult {
  status: number;
  body: Record<string, unknown>;
}

const ATTEMPT = 1;

function failed(reason: string, http: HttpResult): JobRun<HttpResult> {
  return { outcome: { status: 'failed', attempt: ATTEMPT, message: reason }, response: http };
}

export async function runCalendarRefresh(
  deps: CalendarRunDeps,
  fromIso: string,
  throughIso: string,
): Promise<JobRun<HttpResult>> {
  const fetched = await deps.fetchCalendar(fromIso, throughIso);
  if (!fetched.ok) {
    // A fetch failure is NOT "the calendar has no sessions" (CLAUDE.md "success
    // signals" #1): it must never reach planCalendarUpdate as an empty array.
    return fetched.reason === 'alpaca_fetch_failed'
      ? failed(`alpaca_fetch_failed status=${fetched.status}`, {
        status: 502,
        body: { ok: false, reason: 'alpaca_fetch_failed', status: fetched.status },
      })
      : failed('alpaca_fetch_error', { status: 502, body: { ok: false, reason: 'alpaca_fetch_error' } });
  }

  const plan = planCalendarUpdate(fetched.raw, fromIso, throughIso);
  if (!plan.ok) {
    console.error(`Calendar plan rejected: ${plan.reason}`);
    return failed(plan.reason, { status: 502, body: { ok: false, reason: plan.reason } });
  }

  const { error } = await deps.applyCalendar(fromIso, throughIso, plan.sessions);
  if (error) {
    console.error('apply_market_calendar failed:', error);
    return failed('apply_failed', {
      status: 500,
      body: { ok: false, reason: 'apply_failed', message: error.message },
    });
  }

  return {
    outcome: {
      status: 'success',
      attempt: ATTEMPT,
      work: plan.sessions.length,
      message: `sessions ${fromIso}..${throughIso}`,
    },
    response: {
      status: 200,
      body: { ok: true, from: fromIso, through: throughIso, sessions: plan.sessions.length },
    },
  };
}
