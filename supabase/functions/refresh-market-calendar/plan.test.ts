/**
 * Unit tests for ./plan.ts. Hermetic: no DB, no Alpaca, no Deno runtime
 * APIs. Run from repo root with
 *   deno test supabase/functions/refresh-market-calendar/plan.test.ts
 */

import { assertEquals } from 'jsr:@std/assert';
import { planCalendarUpdate } from './plan.ts';

const FROM = '2026-10-01';
const THROUGH = '2026-10-30'; // 30-day window; min expected = floor(30/30*15) = 15

function session(date: string, open = '09:30', close = '16:00') {
  return { date, open, close };
}

// A plausible month: ~22 weekdays minus a couple of holidays.
function plausibleMonth(): unknown[] {
  const rows: unknown[] = [];
  const start = new Date('2026-10-01T00:00:00Z');
  for (let i = 0; i < 30; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue; // weekend
    rows.push(session(d.toISOString().split('T')[0]));
  }
  return rows;
}

Deno.test('planCalendarUpdate: accepts a plausible month', () => {
  const result = planCalendarUpdate(plausibleMonth(), FROM, THROUGH);
  assertEquals(result.ok, true);
  if (result.ok) {
    // ~22 weekdays in a 30-day window.
    assertEquals(result.sessions.length >= 15, true);
    assertEquals(result.sessions[0].open_et, '09:30');
    assertEquals(result.sessions[0].close_et, '16:00');
  }
});

Deno.test('planCalendarUpdate: rejects an invalid window (through before from)', () => {
  const result = planCalendarUpdate(plausibleMonth(), THROUGH, FROM);
  assertEquals(result, { ok: false, reason: 'invalid_window' });
});

Deno.test('planCalendarUpdate: rejects a non-array response (Alpaca error envelope)', () => {
  const result = planCalendarUpdate({ code: 40110000, message: 'invalid credentials' }, FROM, THROUGH);
  assertEquals(result, { ok: false, reason: 'non_array_response' });
});

Deno.test('planCalendarUpdate: rejects a non-array response (empty object, e.g. a 200 with no body)', () => {
  const result = planCalendarUpdate({}, FROM, THROUGH);
  assertEquals(result, { ok: false, reason: 'non_array_response' });
});

Deno.test('planCalendarUpdate: rejects a malformed row (missing date)', () => {
  const rows = plausibleMonth();
  rows.push({ open: '09:30', close: '16:00' });
  const result = planCalendarUpdate(rows, FROM, THROUGH);
  assertEquals(result, { ok: false, reason: 'malformed_row_date' });
});

Deno.test('planCalendarUpdate: rejects a malformed row (bad open time format)', () => {
  const rows = plausibleMonth();
  rows.push(session('2026-10-31', '9:30am', '16:00'));
  const result = planCalendarUpdate(rows, FROM, THROUGH);
  assertEquals(result, { ok: false, reason: 'malformed_row_open' });
});

Deno.test('planCalendarUpdate: rejects a row where close is not after open', () => {
  const rows = plausibleMonth();
  rows.push(session('2026-10-31', '16:00', '09:30'));
  const result = planCalendarUpdate(rows, FROM, THROUGH);
  assertEquals(result, { ok: false, reason: 'malformed_row_open_after_close' });
});

Deno.test('planCalendarUpdate: rejects a row whose date falls outside the requested window', () => {
  // A stray out-of-window row (wrong account, a shifted/misparsed response)
  // must never reach apply_market_calendar — its DELETE only ever targets
  // THIS run's own window, so an out-of-window write would never be cleaned
  // up by any future run.
  const rows = plausibleMonth();
  rows.push(session('2026-12-15')); // one day past THROUGH
  const result = planCalendarUpdate(rows, FROM, THROUGH);
  assertEquals(result, { ok: false, reason: 'row_outside_requested_window' });
});

Deno.test('planCalendarUpdate: rejects a sparse response (an outage returning only a few days)', () => {
  // Simulates the exact shape of the risk this exists for: a 200 status with
  // a body that LOOKS well-formed but is far too sparse to be real —
  // e.g. a partial/cached response during an Alpaca incident.
  const rows = [session('2026-10-01'), session('2026-10-02')];
  const result = planCalendarUpdate(rows, FROM, THROUGH);
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.reason.startsWith('sparse_response:'), true);
  }
});

Deno.test('planCalendarUpdate: accepts an early-close session (Black-Friday-shaped row)', () => {
  const rows = plausibleMonth();
  // Replace one row with an early close (13:00) — a valid session, just short.
  rows[0] = session((rows[0] as { date: string }).date, '09:30', '13:00');
  const result = planCalendarUpdate(rows, FROM, THROUGH);
  assertEquals(result.ok, true);
});

Deno.test('planCalendarUpdate: a DST-boundary window (Nov 1, 2026 fall-back in the US) validates the same as any other window', () => {
  // This module only validates date/time STRINGS as given by Alpaca (already
  // ET wall-clock) — it does no timezone arithmetic itself, so a window that
  // crosses a DST change must not behave any differently here. The
  // instant/next-open math that DOES need DST correctness lives in SQL
  // (market_session_status, AT TIME ZONE 'America/New_York') and is covered
  // by docs/security/game-data-asks-effect-test.sql instead.
  const from = '2026-10-25';
  const through = '2026-11-23'; // 30 days, spans 2026-11-01 fall-back
  const rows: unknown[] = [];
  const start = new Date('2026-10-25T00:00:00Z');
  for (let i = 0; i < 30; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    rows.push(session(d.toISOString().split('T')[0]));
  }
  const result = planCalendarUpdate(rows, from, through);
  assertEquals(result.ok, true);
});
