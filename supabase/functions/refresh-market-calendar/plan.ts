/**
 * refresh-market-calendar plan.ts — pure validation of the Alpaca /v2/calendar
 * response before it is written to public.market_calendar. No DB, no Alpaca,
 * no Deno runtime APIs — same hermetic pattern as
 * ../snapshot-week-start/plan.ts and ../enrich-symbols/price-batch.ts. Run
 * from repo root with
 *   deno test supabase/functions/refresh-market-calendar/plan.test.ts
 *
 * WHY THIS EXISTS (CLAUDE.md "success signals are unreliable" #1, #7): a
 * 401/5xx/timeout from Alpaca must never be written as "no trading days in
 * this window" — that would read to market_session_status() as N straight
 * holidays. A sparse-but-200 response (Alpaca changed its shape, or
 * returned a truncated/error-envelope body with a 200 status) is the same
 * risk with no HTTP error code to catch it at all. Every response is
 * validated against a plausible session density BEFORE it ever reaches
 * apply_market_calendar; a rejection here is a no-op for the caller — the
 * previous coverage window, and therefore every previously-written date, is
 * left untouched.
 */

export interface RawCalendarDay {
  date?: unknown;
  open?: unknown;
  close?: unknown;
}

export interface CalendarSession {
  session_date: string; // YYYY-MM-DD
  open_et: string;      // HH:MM, 24h, ET wall-clock (Alpaca's own units)
  close_et: string;     // HH:MM
}

export type PlanResult =
  | { ok: true; sessions: CalendarSession[] }
  | { ok: false; reason: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/**
 * Minimum sessions expected per 30 calendar days of the requested window. US
 * equities trade roughly 21-22 days/month; 15 leaves headroom for an
 * unusually holiday-dense month (e.g. one spanning both Thanksgiving week and
 * a year-end) without masking a truly broken/sparse response.
 */
const MIN_SESSIONS_PER_30_DAYS = 15;

function daysBetween(fromIso: string, throughIso: string): number {
  const from = new Date(fromIso + 'T00:00:00Z').getTime();
  const through = new Date(throughIso + 'T00:00:00Z').getTime();
  return Math.round((through - from) / 86_400_000) + 1;
}

/**
 * Validates and normalizes Alpaca's calendar response into the shape
 * apply_market_calendar expects. Rejects (does not write) on:
 *   - an invalid requested window;
 *   - a non-array body (an Alpaca error envelope, an HTML error page, a
 *     reshaped response, etc. — anything that isn't the documented array);
 *   - any row missing or malforming its date/open/close fields;
 *   - a session count implausibly low for the requested window.
 */
export function planCalendarUpdate(
  raw: unknown,
  fromIso: string,
  throughIso: string,
): PlanResult {
  if (!DATE_RE.test(fromIso) || !DATE_RE.test(throughIso) || throughIso < fromIso) {
    return { ok: false, reason: 'invalid_window' };
  }
  if (!Array.isArray(raw)) {
    return { ok: false, reason: 'non_array_response' };
  }

  const sessions: CalendarSession[] = [];
  for (const row of raw as RawCalendarDay[]) {
    const d = row?.date;
    const o = row?.open;
    const c = row?.close;
    if (typeof d !== 'string' || !DATE_RE.test(d)) {
      return { ok: false, reason: 'malformed_row_date' };
    }
    if (typeof o !== 'string' || !TIME_RE.test(o)) {
      return { ok: false, reason: 'malformed_row_open' };
    }
    if (typeof c !== 'string' || !TIME_RE.test(c)) {
      return { ok: false, reason: 'malformed_row_close' };
    }
    if (c <= o) {
      return { ok: false, reason: 'malformed_row_open_after_close' };
    }
    // A row outside the window we actually asked Alpaca for (wrong account,
    // a shifted/misparsed response, etc.) must never be written — the whole
    // point of this planner is that apply_market_calendar's DELETE only ever
    // targets THIS run's own [fromIso, throughIso] slice, so a stray
    // out-of-window row would never be cleaned up by any future run.
    if (d < fromIso || d > throughIso) {
      return { ok: false, reason: 'row_outside_requested_window' };
    }
    sessions.push({ session_date: d, open_et: o, close_et: c });
  }

  const windowDays = daysBetween(fromIso, throughIso);
  const minExpected = Math.floor((windowDays / 30) * MIN_SESSIONS_PER_30_DAYS);
  if (sessions.length < minExpected) {
    return { ok: false, reason: `sparse_response:${sessions.length}_of_min_${minExpected}` };
  }

  return { ok: true, sessions };
}
