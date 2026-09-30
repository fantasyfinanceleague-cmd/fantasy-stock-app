/**
 * Boundary tests for lib/home/marketWeek.ts — B1 (Design Lead, 2026-09-30):
 * matchups.week_start/week_end are FIXED UTC year-round and week_start is a
 * nominal TUESDAY (_shared/schedule.ts), never the real Monday-open/Friday-
 * close a person sees. These tests pin the market-calendar-derived
 * replacement against Design Lead's five exact scenarios.
 *
 * The nominal `weekEnd` used to anchor each case is written the way
 * schedule.ts actually produces one -- Friday at the fixed 21:00Z close
 * (CLOSE_H=21) -- never midnight, which rolls back to Thursday in ET and
 * would anchor every case a day early.
 *
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { etWallClockToUtcIso, resolveWeekWindow, standardWeekSessions, lastSessionCloseBefore, type MarketCalendarSession } from '../lib/home/marketWeek.ts';

Deno.test('etWallClockToUtcIso: 9:30 AM ET in EDT (summer) is 13:30Z', () => {
  assertEquals(etWallClockToUtcIso('2026-09-21', '09:30:00'), '2026-09-21T13:30:00.000Z');
});

Deno.test('etWallClockToUtcIso: 9:30 AM ET in EST (winter) is 14:30Z', () => {
  assertEquals(etWallClockToUtcIso('2026-12-15', '09:30:00'), '2026-12-15T14:30:00.000Z');
});

Deno.test('etWallClockToUtcIso: 4:00 PM ET close in EDT is 20:00Z', () => {
  assertEquals(etWallClockToUtcIso('2026-09-25', '16:00:00'), '2026-09-25T20:00:00.000Z');
});

Deno.test('resolveWeekWindow: ordinary week -> Monday open through Friday close', () => {
  const nominalWeekEnd = '2026-09-25T21:00:00.000Z'; // schedule.ts's fixed Friday close
  const sessions: MarketCalendarSession[] = standardWeekSessions(nominalWeekEnd);
  const window = resolveWeekWindow(nominalWeekEnd, sessions);
  assertEquals(window, { weekStart: '2026-09-21T13:30:00.000Z', weekEnd: '2026-09-25T20:00:00.000Z' });
});

Deno.test('resolveWeekWindow: Monday holiday -> the week starts Tuesday 9:30 AM ET', () => {
  // Monday 2026-09-21 missing from the calendar (holiday) -- Tue-Fri only.
  const sessions: MarketCalendarSession[] = [
    { sessionDate: '2026-09-22', openEt: '09:30:00', closeEt: '16:00:00' },
    { sessionDate: '2026-09-23', openEt: '09:30:00', closeEt: '16:00:00' },
    { sessionDate: '2026-09-24', openEt: '09:30:00', closeEt: '16:00:00' },
    { sessionDate: '2026-09-25', openEt: '09:30:00', closeEt: '16:00:00' },
  ];
  const window = resolveWeekWindow('2026-09-25T21:00:00.000Z', sessions);
  assertEquals(window?.weekStart, '2026-09-22T13:30:00.000Z');
});

Deno.test('resolveWeekWindow: half-day Friday -> the week ends 1:00 PM ET', () => {
  const nominalWeekEnd = '2026-09-25T21:00:00.000Z';
  const sessions: MarketCalendarSession[] = [
    ...standardWeekSessions(nominalWeekEnd).slice(0, 4),
    { sessionDate: '2026-09-25', openEt: '09:30:00', closeEt: '13:00:00' },
  ];
  const window = resolveWeekWindow(nominalWeekEnd, sessions);
  assertEquals(window?.weekEnd, '2026-09-25T17:00:00.000Z'); // 1:00 PM EDT = 17:00Z
});

Deno.test('resolveWeekWindow: Friday holiday -> the week ends Thursday close', () => {
  const nominalWeekEnd = '2026-09-25T21:00:00.000Z';
  const sessions: MarketCalendarSession[] = standardWeekSessions(nominalWeekEnd).slice(0, 4);
  const window = resolveWeekWindow(nominalWeekEnd, sessions);
  assertEquals(window?.weekEnd, '2026-09-24T20:00:00.000Z');
});

Deno.test('resolveWeekWindow: December (EST) week -> still 9:30 AM open / 4:00 PM close', () => {
  const nominalWeekEnd = '2026-12-18T21:00:00.000Z';
  const sessions: MarketCalendarSession[] = standardWeekSessions(nominalWeekEnd);
  const window = resolveWeekWindow(nominalWeekEnd, sessions);
  assertEquals(window, { weekStart: '2026-12-14T14:30:00.000Z', weekEnd: '2026-12-18T21:00:00.000Z' });
});

Deno.test('resolveWeekWindow: a non-Friday anchor (e.g. a league start date) resolves the SAME week -- never assumes the anchor is Friday', () => {
  // A league's leagueStartDate can land on any weekday (schedule.ts's own
  // nominal-Tuesday convention, or any other day) -- anchoring on it must
  // find the correct Monday via the REAL day of week, not by subtracting
  // a fixed 4 days as if the anchor were always a Friday.
  const sessions = standardWeekSessions('2026-09-25T21:00:00.000Z'); // Mon 9/21 - Fri 9/25
  const fromTuesday = resolveWeekWindow('2026-09-22T14:30:00.000Z', sessions); // nominal Tuesday anchor
  const fromMonday = resolveWeekWindow('2026-09-21T13:30:00.000Z', sessions); // Monday anchor
  const fromFriday = resolveWeekWindow('2026-09-25T21:00:00.000Z', sessions); // Friday anchor
  assertEquals(fromTuesday, { weekStart: '2026-09-21T13:30:00.000Z', weekEnd: '2026-09-25T20:00:00.000Z' });
  assertEquals(fromTuesday, fromMonday);
  assertEquals(fromTuesday, fromFriday);
});

Deno.test('resolveWeekWindow: no coverage for the week -> null, never a guess', () => {
  const window = resolveWeekWindow('2026-09-25T21:00:00.000Z', []);
  assertEquals(window, null);
});

Deno.test('standardWeekSessions: five weekday sessions, Monday through Friday', () => {
  const sessions = standardWeekSessions('2026-09-25T21:00:00.000Z');
  assertEquals(sessions.map((s: MarketCalendarSession) => s.sessionDate), ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25']);
  assertEquals(sessions.every((s: MarketCalendarSession) => s.openEt === '09:30:00' && s.closeEt === '16:00:00'), true);
});

// ── Orchestrator ask (2026-09-30): a runtime whose Intl drops a required
// part must degrade to null all the way out, never a wrong-but-confident
// window (the marketHours.ts:58 "?? '0'" shape this module now avoids
// via lib/time/etParts.ts). ─────────────────────────────────────────────

Deno.test('etWallClockToUtcIso: a runtime that drops the hour part returns null, never a fabricated midnight', () => {
  const RealDateTimeFormat = Intl.DateTimeFormat;
  try {
    // deno-lint-ignore no-explicit-any
    (Intl as any).DateTimeFormat = function (...args: unknown[]) {
      // deno-lint-ignore no-explicit-any
      const real = new (RealDateTimeFormat as any)(...args);
      return { formatToParts: (d: Date) => real.formatToParts(d).filter((p: { type: string }) => p.type !== 'hour') };
    };
    assertEquals(etWallClockToUtcIso('2026-09-21', '09:30:00'), null);
  } finally {
    Intl.DateTimeFormat = RealDateTimeFormat;
  }
});

Deno.test('resolveWeekWindow: the missing-part failure propagates all the way out to null', () => {
  const RealDateTimeFormat = Intl.DateTimeFormat;
  try {
    // deno-lint-ignore no-explicit-any
    (Intl as any).DateTimeFormat = function (...args: unknown[]) {
      // deno-lint-ignore no-explicit-any
      const real = new (RealDateTimeFormat as any)(...args);
      return { formatToParts: (d: Date) => real.formatToParts(d).filter((p: { type: string }) => p.type !== 'day') };
    };
    const nominalWeekEnd = '2026-09-25T21:00:00.000Z';
    const sessions = [{ sessionDate: '2026-09-25', openEt: '09:30:00', closeEt: '16:00:00' }];
    assertEquals(resolveWeekWindow(nominalWeekEnd, sessions), null);
  } finally {
    Intl.DateTimeFormat = RealDateTimeFormat;
  }
});

// ── R2 (Design Lead, 2026-09-30): live_closed's "…at {weekday}'s close"
// needs the session that ACTUALLY just closed, not the week's eventual
// Friday end -- a Tuesday-evening after-hours state was reading "at
// Friday's close" three days early. ─────────────────────────────────────

Deno.test('lastSessionCloseBefore: Wednesday 8pm ET names Wednesday\'s own close, not Friday\'s', () => {
  const week = standardWeekSessions('2026-09-25T21:00:00.000Z'); // anchored on Friday's nominal weekEnd
  const now = new Date('2026-09-24T00:00:00.000Z'); // Wed 8pm ET (00:00Z Thu)
  const result = lastSessionCloseBefore(now, week);
  assertEquals(result, '2026-09-23T20:00:00.000Z'); // Wednesday 4:00 PM ET
});

Deno.test('lastSessionCloseBefore: Monday morning before the open has no session closed yet this week', () => {
  const week = standardWeekSessions('2026-09-25T21:00:00.000Z');
  const now = new Date('2026-09-21T12:00:00.000Z'); // Mon 8am ET, before the 9:30 open
  assertEquals(lastSessionCloseBefore(now, week), null);
});

Deno.test('lastSessionCloseBefore: exactly at a session\'s close counts as already closed', () => {
  const week = standardWeekSessions('2026-09-25T21:00:00.000Z');
  const wedClose = etWallClockToUtcIso('2026-09-23', '16:00:00')!;
  const result = lastSessionCloseBefore(new Date(wedClose), week);
  assertEquals(result, wedClose);
});

Deno.test('lastSessionCloseBefore: no session in range closed yet returns null, never a fabricated guess', () => {
  const week = standardWeekSessions('2026-09-25T21:00:00.000Z');
  const now = new Date('2020-01-01T00:00:00.000Z'); // long before any session in `week`
  assertEquals(lastSessionCloseBefore(now, week), null);
});
