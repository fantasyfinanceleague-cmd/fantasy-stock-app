/**
 * Hermetic unit tests for ./market-hours.ts — the record-trade gate.
 * No DB, no Alpaca, no Deno runtime APIs beyond Intl/Date. Run from repo
 * root with
 *   deno test supabase/functions/_shared/market-hours.test.ts
 */

import { assertEquals } from 'jsr:@std/assert';
import { decideMarketGate, marketLabel, tradeGateResponse, type CalendarRow, type Coverage, type MarketGate } from './market-hours.ts';

function row(sessionDate: string, openEt: string, closeEt: string): CalendarRow {
  return { session_date: sessionDate, open_et: openEt, close_et: closeEt };
}

function cov(from: string, through: string): Coverage {
  return { covered_from: from, covered_through: through };
}

const WIDE = cov('2026-01-01', '2026-12-31');

// ===========================================================================
// Regular session — open, boundaries
// ===========================================================================

Deno.test('open: mid-session on a regular day', () => {
  const sessions = [row('2026-09-29', '09:30', '16:00')];
  const g = decideMarketGate(new Date('2026-09-29T15:00:00Z'), sessions, WIDE); // 11:00 ET
  assertEquals(g.open, true);
  if (g.open) {
    assertEquals(g.sessionDate, '2026-09-29');
    assertEquals(g.openAt.toISOString(), '2026-09-29T13:30:00.000Z');
    assertEquals(g.closeAt.toISOString(), '2026-09-29T20:00:00.000Z');
  }
});

Deno.test('closed: 1ms before the open — pre_market', () => {
  const sessions = [row('2026-09-29', '09:30', '16:00')];
  const g = decideMarketGate(new Date('2026-09-29T13:29:59.999Z'), sessions, WIDE);
  assertEquals(g.open, false);
  if (!g.open) {
    assertEquals(g.reason, 'market_closed');
    assertEquals(g.marketReason, 'pre_market');
    assertEquals(g.nextOpenAt?.toISOString(), '2026-09-29T13:30:00.000Z');
  }
});

Deno.test('open: exactly at the open instant — inclusive lower bound', () => {
  const sessions = [row('2026-09-29', '09:30', '16:00')];
  const g = decideMarketGate(new Date('2026-09-29T13:30:00.000Z'), sessions, WIDE);
  assertEquals(g.open, true);
});

Deno.test('closed: exactly at the close instant — exclusive upper bound', () => {
  const sessions = [row('2026-09-29', '09:30', '16:00'), row('2026-09-30', '09:30', '16:00')];
  const g = decideMarketGate(new Date('2026-09-29T20:00:00.000Z'), sessions, WIDE);
  assertEquals(g.open, false);
  if (!g.open) {
    assertEquals(g.reason, 'market_closed');
    assertEquals(g.marketReason, 'after_hours');
    assertEquals(g.nextOpenAt?.toISOString(), '2026-09-30T13:30:00.000Z');
  }
});

Deno.test('closed: well after the close — after_hours', () => {
  const sessions = [row('2026-09-29', '09:30', '16:00'), row('2026-09-30', '09:30', '16:00')];
  const g = decideMarketGate(new Date('2026-09-29T23:00:00Z'), sessions, WIDE); // 7pm ET
  assertEquals(g.open, false);
  if (!g.open) assertEquals(g.marketReason, 'after_hours');
});

// ===========================================================================
// Early close
// ===========================================================================

Deno.test('open: mid-session on an early-close day (Black Friday, 1pm ET close)', () => {
  const sessions = [row('2026-11-27', '09:30', '13:00')];
  const g = decideMarketGate(new Date('2026-11-27T17:00:00Z'), sessions, WIDE); // 12:00 ET
  assertEquals(g.open, true);
});

Deno.test('closed: after an early close, 1:30pm ET — the S5 exploit window', () => {
  const sessions = [row('2026-11-27', '09:30', '13:00')];
  const g = decideMarketGate(new Date('2026-11-27T18:30:00Z'), sessions, WIDE); // 13:30 ET
  assertEquals(g.open, false);
  if (!g.open) {
    assertEquals(g.reason, 'market_closed');
    assertEquals(g.marketReason, 'after_hours');
  }
});

// ===========================================================================
// Holiday / weekend
// ===========================================================================

Deno.test('closed: a holiday with no calendar row — holiday reason, next open skips it', () => {
  // Wed 2026-11-25 (last session before Thanksgiving), no row for Thu 11-26
  // (holiday), next session Fri 11-27 (early close).
  const sessions = [row('2026-11-25', '09:30', '16:00'), row('2026-11-27', '09:30', '13:00')];
  const g = decideMarketGate(new Date('2026-11-26T15:00:00Z'), sessions, WIDE); // Thu 10am ET
  assertEquals(g.open, false);
  if (!g.open) {
    assertEquals(g.reason, 'market_closed');
    assertEquals(g.marketReason, 'holiday');
    assertEquals(g.nextOpenAt?.toISOString(), '2026-11-27T14:30:00.000Z');
  }
});

Deno.test('closed: a weekend day with no calendar row — weekend reason', () => {
  // Fri 2026-10-02 last session, next Mon 2026-10-05.
  const sessions = [row('2026-10-02', '09:30', '16:00'), row('2026-10-05', '09:30', '16:00')];
  const g = decideMarketGate(new Date('2026-10-03T15:00:00Z'), sessions, WIDE); // Saturday
  assertEquals(g.open, false);
  if (!g.open) {
    assertEquals(g.reason, 'market_closed');
    assertEquals(g.marketReason, 'weekend');
    assertEquals(g.nextOpenAt?.toISOString(), '2026-10-05T13:30:00.000Z');
  }
});

Deno.test('closed: Sunday — weekend reason, next open Monday', () => {
  const sessions = [row('2026-10-02', '09:30', '16:00'), row('2026-10-05', '09:30', '16:00')];
  const g = decideMarketGate(new Date('2026-10-04T15:00:00Z'), sessions, WIDE); // Sunday
  assertEquals(g.open, false);
  if (!g.open) assertEquals(g.marketReason, 'weekend');
});

// ===========================================================================
// DST — both directions (mirrors week-window.test.ts's etWallClockToUtc
// coverage, exercised here through the gate)
// ===========================================================================

Deno.test('DST spring-forward: the day after (2026-03-09, EDT) opens at 13:30Z', () => {
  const sessions = [row('2026-03-09', '09:30', '16:00')];
  const g = decideMarketGate(new Date('2026-03-09T13:30:00.000Z'), sessions, WIDE);
  assertEquals(g.open, true);
  if (g.open) assertEquals(g.openAt.toISOString(), '2026-03-09T13:30:00.000Z');
});

Deno.test('DST fall-back: the day after (2026-11-02, EST) opens at 14:30Z', () => {
  const sessions = [row('2026-11-02', '09:30', '16:00')];
  const g = decideMarketGate(new Date('2026-11-02T14:30:00.000Z'), sessions, WIDE);
  assertEquals(g.open, true);
  if (g.open) assertEquals(g.openAt.toISOString(), '2026-11-02T14:30:00.000Z');
  // 13:30Z on the same day is still pre-market under EST (13:30Z = 8:30 ET).
  const pre = decideMarketGate(new Date('2026-11-02T13:30:00.000Z'), sessions, WIDE);
  assertEquals(pre.open, false);
  if (!pre.open) assertEquals(pre.marketReason, 'pre_market');
});

// ===========================================================================
// ET date != UTC date (late evening ET rolls to the next UTC calendar day)
// ===========================================================================

Deno.test("today's ET date is derived correctly when it differs from the UTC date", () => {
  // 2026-09-29 23:30 ET = 2026-09-30 03:30Z. Must be evaluated as the
  // 09-29 session (already closed, after_hours), not treated as 09-30.
  const sessions = [row('2026-09-29', '09:30', '16:00'), row('2026-09-30', '09:30', '16:00')];
  const g = decideMarketGate(new Date('2026-09-30T03:30:00.000Z'), sessions, WIDE);
  assertEquals(g.open, false);
  if (!g.open) {
    assertEquals(g.marketReason, 'after_hours');
    assertEquals(g.nextOpenAt?.toISOString(), '2026-09-30T13:30:00.000Z');
  }
});

// ===========================================================================
// Coverage failures — fail CLOSED as calendar_unavailable, never
// market_closed (CLAUDE.md "success signals" #1: a missing/stale refresh
// must never read as a routine game-flow refusal)
// ===========================================================================

Deno.test('calendar_unavailable: no coverage row at all', () => {
  const sessions = [row('2026-09-29', '09:30', '16:00')];
  const g = decideMarketGate(new Date('2026-09-29T15:00:00Z'), sessions, null);
  assertEquals(g.open, false);
  if (!g.open) {
    assertEquals(g.reason, 'calendar_unavailable');
    assertEquals(g.nextOpenAt, null);
  }
});

Deno.test('calendar_unavailable: today is before covered_from', () => {
  const sessions = [row('2026-09-29', '09:30', '16:00')];
  const g = decideMarketGate(new Date('2026-09-29T15:00:00Z'), sessions, cov('2026-10-01', '2026-12-31'));
  assertEquals(g.open, false);
  if (!g.open) assertEquals(g.reason, 'calendar_unavailable');
});

Deno.test('calendar_unavailable: today is after covered_through (a lapsed refresh)', () => {
  const sessions = [row('2026-09-29', '09:30', '16:00')];
  const g = decideMarketGate(new Date('2026-09-29T15:00:00Z'), sessions, cov('2026-01-01', '2026-09-28'));
  assertEquals(g.open, false);
  if (!g.open) assertEquals(g.reason, 'calendar_unavailable');
});

Deno.test('calendar_unavailable: a malformed calendar row (bad time format)', () => {
  const sessions: CalendarRow[] = [{ session_date: '2026-09-29', open_et: 'nine-thirty', close_et: '16:00' }];
  const g = decideMarketGate(new Date('2026-09-29T15:00:00Z'), sessions, WIDE);
  assertEquals(g.open, false);
  if (!g.open) assertEquals(g.reason, 'calendar_unavailable');
});

Deno.test('calendar_unavailable: a malformed calendar row (non-string session_date)', () => {
  const sessions: CalendarRow[] = [{ session_date: null, open_et: '09:30', close_et: '16:00' }];
  const g = decideMarketGate(new Date('2026-09-29T15:00:00Z'), sessions, WIDE);
  assertEquals(g.open, false);
  if (!g.open) assertEquals(g.reason, 'calendar_unavailable');
});

Deno.test('calendar_unavailable: malformed coverage row', () => {
  const sessions = [row('2026-09-29', '09:30', '16:00')];
  const g = decideMarketGate(new Date('2026-09-29T15:00:00Z'), sessions, { covered_from: null, covered_through: '2026-12-31' });
  assertEquals(g.open, false);
  if (!g.open) assertEquals(g.reason, 'calendar_unavailable');
});

Deno.test("accepts PostgREST's HH:MM:SS time format, not just HH:MM", () => {
  const sessions: CalendarRow[] = [{ session_date: '2026-09-29', open_et: '09:30:00', close_et: '16:00:00' }];
  const g = decideMarketGate(new Date('2026-09-29T15:00:00Z'), sessions, WIDE);
  assertEquals(g.open, true);
});

// ===========================================================================
// next_open_at reaches past a run of malformed/irrelevant rows correctly and
// ignores rows before today
// ===========================================================================

Deno.test('ignores sessions before today when picking next_open_at', () => {
  const sessions = [
    row('2026-09-01', '09:30', '16:00'), // stale, before today
    row('2026-10-02', '09:30', '16:00'), // today, already closed
    row('2026-10-05', '09:30', '16:00'), // the real next session
  ];
  const g = decideMarketGate(new Date('2026-10-02T23:00:00Z'), sessions, WIDE); // Fri 7pm ET
  assertEquals(g.open, false);
  if (!g.open) assertEquals(g.nextOpenAt?.toISOString(), '2026-10-05T13:30:00.000Z');
});

Deno.test('next_open_at is null when no later session falls within the covered window', () => {
  const sessions = [row('2026-10-02', '09:30', '16:00')];
  const g = decideMarketGate(new Date('2026-10-02T23:00:00Z'), sessions, cov('2026-01-01', '2026-10-02'));
  assertEquals(g.open, false);
  if (!g.open) assertEquals(g.nextOpenAt, null);
});

// ===========================================================================
// Intl hardening — mirrors week-window.test.ts's approach: simulate
// Intl.DateTimeFormat returning an incomplete part set and assert this
// module refuses (calendar_unavailable) instead of silently defaulting.
// ===========================================================================

function withBrokenIntl<T>(fn: () => T): T {
  const real = Intl.DateTimeFormat;
  // deno-lint-ignore no-explicit-any
  (Intl as any).DateTimeFormat = class {
    formatToParts() {
      return [{ type: 'year', value: '2026' }]; // missing month/day/etc.
    }
  };
  try {
    return fn();
  } finally {
    // deno-lint-ignore no-explicit-any
    (Intl as any).DateTimeFormat = real;
  }
}

Deno.test('calendar_unavailable: Intl.DateTimeFormat returns an incomplete part set', () => {
  const sessions = [row('2026-09-29', '09:30', '16:00')];
  const g = withBrokenIntl(() => decideMarketGate(new Date('2026-09-29T15:00:00Z'), sessions, WIDE));
  assertEquals(g.open, false);
  if (!g.open) assertEquals(g.reason, 'calendar_unavailable');
});

// ===========================================================================
// tradeGateResponse — the pure decide -> HTTP-status/body mapping record-
// trade's handler calls. Tested independently of decideMarketGate so a
// status-code regression (e.g. someone "fixing" market_closed to a 4xx,
// which supabase-js would then swallow the body of) is caught here, not
// only by re-deriving the decision.
// ===========================================================================

Deno.test('tradeGateResponse: market_closed is a 200 game-flow refusal (functions.invoke keeps the body only on 2xx)', () => {
  const gate: Extract<MarketGate, { open: false }> = {
    open: false,
    reason: 'market_closed',
    marketReason: 'weekend',
    nextOpenAt: new Date('2026-10-05T13:30:00.000Z'),
  };
  const r = tradeGateResponse(gate);
  assertEquals(r.status, 200);
  assertEquals(r.body, { ok: false, reason: 'market_closed', market_reason: 'weekend', next_open_at: '2026-10-05T13:30:00.000Z' });
});

Deno.test('tradeGateResponse: market_closed with a null next_open_at serializes as null, not undefined', () => {
  const gate: Extract<MarketGate, { open: false }> = { open: false, reason: 'market_closed', marketReason: 'holiday', nextOpenAt: null };
  const r = tradeGateResponse(gate);
  assertEquals(r.body.next_open_at, null);
});

Deno.test('tradeGateResponse: calendar_unavailable is a 503, with no market_reason/next_open_at leaked', () => {
  const gate: Extract<MarketGate, { open: false }> = { open: false, reason: 'calendar_unavailable', nextOpenAt: null };
  const r = tradeGateResponse(gate);
  assertEquals(r.status, 503);
  assertEquals(r.body, { ok: false, reason: 'calendar_unavailable' });
});

// ===========================================================================
// marketLabel — the additive, never-blocking preview field
// ===========================================================================

Deno.test('marketLabel: open gate -> {open:true, reason:null, next_open_at:null}', () => {
  const sessions = [row('2026-09-29', '09:30', '16:00')];
  const gate = decideMarketGate(new Date('2026-09-29T15:00:00Z'), sessions, WIDE);
  assertEquals(marketLabel(gate), { open: true, reason: null, next_open_at: null });
});

Deno.test('marketLabel: closed gate -> {open:false, reason, next_open_at}', () => {
  const sessions = [row('2026-10-02', '09:30', '16:00'), row('2026-10-05', '09:30', '16:00')];
  const gate = decideMarketGate(new Date('2026-10-03T15:00:00Z'), sessions, WIDE); // Saturday
  assertEquals(marketLabel(gate), { open: false, reason: 'weekend', next_open_at: '2026-10-05T13:30:00.000Z' });
});

Deno.test('marketLabel: calendar_unavailable -> null (fail-soft, never a guessed status)', () => {
  const sessions = [row('2026-09-29', '09:30', '16:00')];
  const gate = decideMarketGate(new Date('2026-09-29T15:00:00Z'), sessions, null);
  assertEquals(marketLabel(gate), null);
});
