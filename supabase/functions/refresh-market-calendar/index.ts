// supabase/functions/refresh-market-calendar/index.ts
//
// Cron-only refresh of public.market_calendar from Alpaca's /v2/calendar
// (trading API). Ask #7 (docs/design/prompts/phase3-plan.md): market open /
// closed / holiday status must come from DATA, not a hard-coded weekday
// rule — a weekday rule cannot know Thanksgiving, a half-day, or a rule
// change.
//
// WHY A TABLE, NOT AN ON-DEMAND CALL PER CLIENT: every screen showing session
// status would otherwise spend an Alpaca round trip, and a transient Alpaca
// outage would flip every client to "unknown" at once. Refreshing a ~97-day
// window daily (see LOOKBACK_DAYS/LOOKAHEAD_DAYS below) means one failed
// refresh changes nothing for clients until the cached window runs out (see
// public.market_session_status's 'no_coverage' branch) — the same
// "a failure changes nothing" shape as enrich-symbols' unpriced backlog, not
// a live dependency on Alpaca's uptime.
//
// AUTH: same apikey-guard pattern as snapshot-week-start/-end, enrich-symbols,
// process-week-results, refresh-symbols — verify_jwt=false in config.toml;
// this function's own constant-time apikey check against SB_SECRET_KEY_CRON
// is the ENTIRE auth boundary. Fails closed if the secret is unset.
//
// SUCCESS-SIGNAL DISCIPLINE (CLAUDE.md): an Alpaca 401/5xx/timeout must never
// look like "no trading days" (lesson #1). planCalendarUpdate (pure,
// plan.test.ts) rejects anything that isn't a plausible calendar body BEFORE
// apply_market_calendar ever runs, so a bad fetch is a no-op, not a write of
// fabricated holidays. The RPC's resolved `{ error }` is checked explicitly
// (lesson #5 — supabase-js does not throw on a Postgres error) rather than
// trusted via a bare await.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { runCalendarRefresh, type FetchCalendarResult } from './run.ts';
import { writeJobStatus, type JobStatusRwClient } from '../_shared/job-status-io.ts';
import { runJob, type JobRun } from '../_shared/run-job.ts';

function env(k: string): string {
  return Deno.env.get(k) ?? '';
}

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

// ── apikey auth (mirrors snapshot-week-start/-end, enrich-symbols,
// refresh-symbols, process-week-results) ──────────────────────────────────
function constantTimeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let result = 0;
  for (let i = 0; i < aBytes.length; i++) {
    result |= aBytes[i] ^ bBytes[i];
  }
  return result === 0;
}

function isAuthorized(req: Request): boolean {
  const expectedKey = Deno.env.get('SB_SECRET_KEY_CRON');
  if (!expectedKey || expectedKey.length === 0) {
    console.error('SB_SECRET_KEY_CRON not configured — rejecting all requests');
    return false; // fail closed
  }
  const providedKey = req.headers.get('apikey') ?? '';
  return constantTimeEqual(providedKey, expectedKey);
}

const ALPACA_TRADING_BASE = 'https://paper-api.alpaca.markets/v2';

// Trailing window: re-covers yesterday too, so a same-day rerun after a
// partial prior failure heals it rather than waiting for tomorrow. It must cover a
// full season: the snapshot jobs' window math needs calendar coverage for every
// league-week they touch, and 7 days made a week-1 window refuse 'no_coverage' the
// day it fell out (B1). 120 days keeps any in-season week covered.
const LOOKBACK_DAYS = 120;
// Leading window: gives market_session_status ~3 months of "next open"
// runway between refreshes, matching the daily-cron cadence with headroom
// for a missed day or two.
const LOOKAHEAD_DAYS = 90;
// Network budget for the Alpaca calendar fetch.
const FETCH_TIMEOUT_MS = 15000;

function isoDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

Deno.serve(async (req) => {
  if (!isAuthorized(req)) return json({ error: 'Unauthorized' }, 401);

  const JOB_NAME = 'refresh-market-calendar';

  // Pre-client config guards: no row is written for these (there is no client to
  // write with, and the 500 itself is the signal). The unauthenticated 401 above
  // never writes a row either, so a caller cannot forge or spam status rows.
  const ALPACA_KEY = env('ALPACA_API_KEY');
  const ALPACA_SECRET = env('ALPACA_API_SECRET');
  if (!ALPACA_KEY || !ALPACA_SECRET) {
    console.error('ALPACA_API_KEY/ALPACA_API_SECRET not configured');
    return json({ ok: false, reason: 'server_config_error' }, 500);
  }

  // SB_SECRET_KEY_INTERNAL, not the legacy SUPABASE_SERVICE_ROLE_KEY — same
  // RLS-bypassing, blast-radius-scoped credential every sibling cron function
  // uses for its write client (enrich-symbols, refresh-symbols,
  // snapshot-week-start, process-week-results). This project is actively
  // migrating OFF the legacy key (docs/migrations/MIGRATION_STATUS.md — a
  // legacy key of this shape leaked into git history before); nothing new
  // should fall back to it.
  const SUPABASE_URL = env('SUPABASE_URL');
  const SECRET_KEY = env('SB_SECRET_KEY_INTERNAL');
  if (!SUPABASE_URL || !SECRET_KEY) {
    console.error('SUPABASE_URL/SB_SECRET_KEY_INTERNAL not configured');
    return json({ ok: false, reason: 'server_config_error' }, 500);
  }
  const supabase = createClient(SUPABASE_URL, SECRET_KEY);

  const now = new Date();
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - LOOKBACK_DAYS);
  const through = new Date(now);
  through.setUTCDate(through.getUTCDate() + LOOKAHEAD_DAYS);
  const fromIso = isoDate(from);
  const throughIso = isoDate(through);

  // Exactly one 'running' and one terminal cron_job_status write, by construction
  // (../_shared/run-job.ts). The decisions live in run.ts with the I/O injected.
  return await runJob<Response>({
    attempt: 1,
    // Cast: checking the full supabase-js client against the writer's narrow slice
    // trips TS2589 (excessively deep); the writer's tests pin the slice.
    write: async (status, attempt, message, work) => {
      await writeJobStatus(supabase as unknown as JobStatusRwClient, JOB_NAME, status, attempt, { message, work });
    },
    onThrow: async (e): Promise<JobRun<Response>> => {
      console.error('Unhandled error:', e);
      return {
        outcome: { status: 'failed', attempt: 1, message: `unhandled: ${String(e)}` },
        response: json({ ok: false, reason: 'unhandled' }, 500),
      };
    },
    body: async (): Promise<JobRun<Response>> => {
      const run = await runCalendarRefresh({
        fetchCalendar: async (f, t): Promise<FetchCalendarResult> => {
          try {
            const url = `${ALPACA_TRADING_BASE}/calendar?start=${f}&end=${t}`;
            const res = await fetch(url, {
              headers: {
                'APCA-API-KEY-ID': ALPACA_KEY,
                'APCA-API-SECRET-KEY': ALPACA_SECRET,
                'Accept': 'application/json',
              },
              signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            });
            if (!res.ok) {
              const preview = await res.text().catch(() => '');
              console.error(`Alpaca calendar fetch failed: ${res.status} ${preview.slice(0, 300)}`);
              return { ok: false, reason: 'alpaca_fetch_failed', status: res.status };
            }
            return { ok: true, raw: await res.json() };
          } catch (e) {
            console.error('Alpaca calendar fetch threw:', e instanceof Error ? e.message : e);
            return { ok: false, reason: 'alpaca_fetch_error' };
          }
        },
        applyCalendar: async (f, t, sessions) => {
          // supabase-js resolves .rpc() to { data, error } and does NOT throw on a
          // Postgres error (CLAUDE.md "success signals" #5): run.ts checks `error`.
          const { error } = await supabase.rpc('apply_market_calendar', { p_from: f, p_through: t, p_sessions: sessions });
          return { error };
        },
      }, fromIso, throughIso);
      return { outcome: run.outcome, response: json(run.response.body, run.response.status) };
    },
  });
});
