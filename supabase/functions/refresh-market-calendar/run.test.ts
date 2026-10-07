/**
 * Every exit of the calendar refresh yields a JobRun: an HTTP result AND a terminal
 * outcome. Driven through runJob with a recording writer, so "exactly one terminal
 * write per path" is asserted, not assumed.
 */
import { assertEquals } from 'jsr:@std/assert';
import { runCalendarRefresh, type CalendarRunDeps, type HttpResult } from './run.ts';
import { runJob, type JobStatusWriter } from '../_shared/run-job.ts';

const FROM = '2026-06-09';
const THROUGH = '2027-01-08';

// A plausible calendar: a session on every weekday in the window (what Alpaca returns).
function plausibleRaw(): unknown[] {
  const out: unknown[] = [];
  const end = new Date(THROUGH + 'T00:00:00Z');
  for (let d = new Date(FROM + 'T00:00:00Z'); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    out.push({ date: d.toISOString().split('T')[0], open: '09:30', close: '16:00' });
  }
  return out;
}

async function drive(deps: Partial<CalendarRunDeps>) {
  const writes: Array<[string, string | undefined, number | undefined]> = [];
  const write: JobStatusWriter = (s, _a, m, w) => { writes.push([s, m, w]); return Promise.resolve(); };
  const full: CalendarRunDeps = {
    fetchCalendar: () => Promise.resolve({ ok: true, raw: plausibleRaw() }),
    applyCalendar: () => Promise.resolve({ error: null }),
    ...deps,
  };
  const quiet = console.error; console.error = () => {};
  let http: HttpResult;
  try {
    http = await runJob<HttpResult>({
      attempt: 1, write,
      body: () => runCalendarRefresh(full, FROM, THROUGH),
      onThrow: (e) => Promise.resolve({
        outcome: { status: 'failed', attempt: 1, message: `unhandled: ${e}` },
        response: { status: 500, body: { ok: false, reason: 'unhandled' } },
      }),
    });
  } finally { console.error = quiet; }
  return { http, writes };
}

Deno.test('success: 200, running then ONE success carrying the session count', async () => {
  const { http, writes } = await drive({});
  assertEquals(http.status, 200);
  assertEquals(writes.map((w) => w[0]), ['running', 'success']);
  assertEquals(writes[1][2], (http.body.sessions as number));
  assertEquals(writes[1][2]! > 100, true);
});

Deno.test('Alpaca non-2xx: 502, ONE failed carrying the status, and nothing applied', async () => {
  let applied = 0;
  const { http, writes } = await drive({
    fetchCalendar: () => Promise.resolve({ ok: false, reason: 'alpaca_fetch_failed', status: 401 }),
    applyCalendar: () => { applied++; return Promise.resolve({ error: null }); },
  });
  assertEquals(http.status, 502);
  assertEquals(writes.map((w) => w[0]), ['running', 'failed']);
  assertEquals(writes[1][1], 'alpaca_fetch_failed status=401');
  assertEquals(applied, 0);
});

Deno.test('Alpaca fetch throws/times out: 502, ONE failed alpaca_fetch_error', async () => {
  const { http, writes } = await drive({
    fetchCalendar: () => Promise.resolve({ ok: false, reason: 'alpaca_fetch_error' }),
  });
  assertEquals(http.status, 502);
  assertEquals(writes.map((w) => w[0]), ['running', 'failed']);
  assertEquals(writes[1][1], 'alpaca_fetch_error');
});

Deno.test('an implausible 200 body is rejected by the plan: 502, ONE failed, nothing applied', async () => {
  let applied = 0;
  const { http, writes } = await drive({
    fetchCalendar: () => Promise.resolve({ ok: true, raw: [] }),
    applyCalendar: () => { applied++; return Promise.resolve({ error: null }); },
  });
  assertEquals(http.status, 502);
  assertEquals(writes.map((w) => w[0]), ['running', 'failed']);
  assertEquals(applied, 0);
});

Deno.test('apply_market_calendar returning { error } (a RESOLVED error, #5): 500, ONE failed apply_failed', async () => {
  const { http, writes } = await drive({
    applyCalendar: () => Promise.resolve({ error: { message: 'permission denied' } }),
  });
  assertEquals(http.status, 500);
  assertEquals(writes.map((w) => w[0]), ['running', 'failed']);
  assertEquals(writes[1][1], 'apply_failed');
});

Deno.test('apply_market_calendar THROWING (transport): routed to onThrow, ONE failed, 500', async () => {
  const { http, writes } = await drive({
    applyCalendar: () => Promise.reject(new Error('connection reset')),
  });
  assertEquals(http.status, 500);
  assertEquals(writes.map((w) => w[0]), ['running', 'failed']);
});
