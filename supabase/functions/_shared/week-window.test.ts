/**
 * Unit tests for ./week-window.ts — the single-cut fix for the Monday-gap
 * scoring defect (docs/audits/2026-09-30-week-window-audit.md).
 *
 * Hermetic: no DB, no Alpaca, no Deno runtime APIs. Run from repo root with
 *   deno test supabase/functions/_shared/week-window.test.ts
 */

import { assertEquals } from 'jsr:@std/assert';
import { etWallClockToUtc, weekCut, type CalendarSession, type Coverage } from './week-window.ts';

// ===========================================================================
// etWallClockToUtc — ET wall-clock -> UTC instant, across DST
// ===========================================================================

Deno.test('etWallClockToUtc: EDT (summer) — 9:30 AM ET = 13:30Z', () => {
  assertEquals(etWallClockToUtc('2026-09-29', '09:30').toISOString(), '2026-09-29T13:30:00.000Z');
});

Deno.test('etWallClockToUtc: EDT (summer) — 4:00 PM ET = 20:00Z', () => {
  assertEquals(etWallClockToUtc('2026-10-02', '16:00').toISOString(), '2026-10-02T20:00:00.000Z');
});

Deno.test('etWallClockToUtc: EST (winter) — 9:30 AM ET = 14:30Z', () => {
  assertEquals(etWallClockToUtc('2026-11-10', '09:30').toISOString(), '2026-11-10T14:30:00.000Z');
});

Deno.test('etWallClockToUtc: EST (winter) — 4:00 PM ET = 21:00Z', () => {
  assertEquals(etWallClockToUtc('2026-11-13', '16:00').toISOString(), '2026-11-13T21:00:00.000Z');
});

Deno.test('etWallClockToUtc: the day AFTER fall-back (2026-11-01) is already EST', () => {
  // DST ends 2026-11-01 02:00 EDT -> 01:00 EST. 2026-11-02 is a Monday in EST.
  assertEquals(etWallClockToUtc('2026-11-02', '09:30').toISOString(), '2026-11-02T14:30:00.000Z');
});

Deno.test('etWallClockToUtc: the day BEFORE fall-back (2026-10-30) is still EDT', () => {
  assertEquals(etWallClockToUtc('2026-10-30', '09:30').toISOString(), '2026-10-30T13:30:00.000Z');
});

Deno.test('etWallClockToUtc: the day AFTER spring-forward (2026-03-09) is already EDT', () => {
  // DST starts 2026-03-08 02:00 EST -> 03:00 EDT.
  assertEquals(etWallClockToUtc('2026-03-09', '09:30').toISOString(), '2026-03-09T13:30:00.000Z');
});

Deno.test('etWallClockToUtc: an early-close time (1:00 PM ET, Black Friday) converts like any other', () => {
  assertEquals(etWallClockToUtc('2026-11-27', '13:00').toISOString(), '2026-11-27T18:00:00.000Z');
});

// ===========================================================================
// weekCut — fixture helpers
// ===========================================================================

/** A normal Mon-Fri week of sessions, 9:30-16:00 ET every day. */
function normalWeek(mondayDate: string): CalendarSession[] {
  const days = [0, 1, 2, 3, 4].map((n) => {
    const [y, m, d] = mondayDate.split('-').map(Number);
    const t = Date.UTC(y, m - 1, d) + n * 86_400_000;
    const dt = new Date(t);
    const pad = (x: number) => String(x).padStart(2, '0');
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  });
  return days.map((sessionDate) => ({ sessionDate, openEt: '09:30', closeEt: '16:00' }));
}

const WIDE_COVERAGE: Coverage = { from: '2026-01-01', through: '2027-12-31' };

// ===========================================================================
// weekCut — the 8 audit scenarios, plus holidays / early close / floor
// ===========================================================================

Deno.test('weekCut EDT: nominal Tue 2026-09-29 14:30Z anchor (old scheme) -> real cut is MONDAY 09-28 13:30Z open .. Fri 10-02 20:00Z close', () => {
  // The whole point of the fix: the week now starts at MONDAY's open (the
  // same day the old baseline was taken on), not the old nominal window's
  // Tuesday. The anchor only identifies WHICH calendar week — any instant in
  // that week resolves to the same cut (see the FIXPOINT test below).
  const sessions = normalWeek('2026-09-28');
  const anchor = new Date('2026-09-29T14:30:00.000Z'); // the OLD nominal fixed-UTC value
  const r = weekCut(anchor, null, sessions, WIDE_COVERAGE);
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}`);
  assertEquals(r.open.toISOString(), '2026-09-28T13:30:00.000Z', '9:30 AM EDT Monday = 13:30Z');
  assertEquals(r.close.toISOString(), '2026-10-02T20:00:00.000Z', '4:00 PM EDT Friday = 20:00Z');
  assertEquals(r.openSessionDate, '2026-09-28');
  assertEquals(r.closeSessionDate, '2026-10-02');
});

Deno.test('weekCut EST: nominal Tue 2026-11-10 14:30Z anchor (old scheme) -> real cut is MONDAY 11-09\'s open, which happens to equal the old nominal clock reading in EST', () => {
  const sessions = normalWeek('2026-11-09');
  const anchor = new Date('2026-11-10T14:30:00.000Z');
  const r = weekCut(anchor, null, sessions, WIDE_COVERAGE);
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}`);
  assertEquals(r.open.toISOString(), '2026-11-09T14:30:00.000Z', '9:30 AM EST Monday = 14:30Z (same digits as the old Tuesday nominal, different day)');
  assertEquals(r.close.toISOString(), '2026-11-13T21:00:00.000Z');
});

Deno.test('weekCut FIXPOINT: re-deriving from an already-reconciled cut.open yields the identical cut', () => {
  const sessions = normalWeek('2026-09-28');
  const nominal = new Date('2026-09-29T14:30:00.000Z');
  const first = weekCut(nominal, null, sessions, WIDE_COVERAGE);
  if (!first.ok) throw new Error('expected ok');
  // Feed the RECONCILED open back in as the new anchor (what a second run, or
  // the Tuesday heal, would read from a matchups row snapshot-week-start
  // already rewrote).
  const second = weekCut(first.open, null, sessions, WIDE_COVERAGE);
  if (!second.ok) throw new Error('expected ok');
  assertEquals(second.open.getTime(), first.open.getTime());
  assertEquals(second.close.getTime(), first.close.getTime());
  assertEquals(second.openSessionDate, first.openSessionDate);
  assertEquals(second.closeSessionDate, first.closeSessionDate);
});

Deno.test('weekCut HOLIDAY MONDAY: MLK 2027-01-18 has no session -> the week cuts at Tuesday\'s open, not Monday\'s', () => {
  const sessions: CalendarSession[] = [
    // 2027-01-18 (Monday) deliberately absent — a holiday.
    { sessionDate: '2027-01-19', openEt: '09:30', closeEt: '16:00' },
    { sessionDate: '2027-01-20', openEt: '09:30', closeEt: '16:00' },
    { sessionDate: '2027-01-21', openEt: '09:30', closeEt: '16:00' },
    { sessionDate: '2027-01-22', openEt: '09:30', closeEt: '16:00' },
  ];
  const anchor = new Date('2027-01-19T14:30:00.000Z'); // nominal Tue (unchanged by the holiday)
  const r = weekCut(anchor, null, sessions, { from: '2027-01-01', through: '2027-12-31' });
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}`);
  assertEquals(r.openSessionDate, '2027-01-19', 'Tuesday is the first session that week');
  assertEquals(r.open.toISOString(), '2027-01-19T14:30:00.000Z');
  assertEquals(r.closeSessionDate, '2027-01-22');
});

Deno.test('weekCut HOLIDAY FRIDAY: Christmas 2026-12-25 has no session -> the week closes Thursday, not Friday', () => {
  const sessions: CalendarSession[] = [
    { sessionDate: '2026-12-21', openEt: '09:30', closeEt: '16:00' }, // Mon
    { sessionDate: '2026-12-22', openEt: '09:30', closeEt: '16:00' },
    { sessionDate: '2026-12-23', openEt: '09:30', closeEt: '16:00' },
    { sessionDate: '2026-12-24', openEt: '09:30', closeEt: '13:00' }, // Thu, early close (Christmas Eve)
    // 2026-12-25 (Friday) deliberately absent — Christmas.
  ];
  const anchor = new Date('2026-12-22T14:30:00.000Z'); // nominal Tue that week
  const r = weekCut(anchor, null, sessions, WIDE_COVERAGE);
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}`);
  assertEquals(r.closeSessionDate, '2026-12-24', 'the week closes on Thursday, the last real session');
  assertEquals(r.close.toISOString(), '2026-12-24T18:00:00.000Z', '1:00 PM ET early close on Christmas Eve');
});

Deno.test('weekCut EARLY CLOSE FRIDAY: 2026-11-27 (Black Friday) closes at 1:00 PM ET, not 4:00 PM', () => {
  const sessions: CalendarSession[] = [
    { sessionDate: '2026-11-23', openEt: '09:30', closeEt: '16:00' }, // Mon
    { sessionDate: '2026-11-24', openEt: '09:30', closeEt: '16:00' },
    { sessionDate: '2026-11-25', openEt: '09:30', closeEt: '16:00' },
    // 2026-11-26 Thanksgiving: absent.
    { sessionDate: '2026-11-27', openEt: '09:30', closeEt: '13:00' }, // Fri, early close
  ];
  const anchor = new Date('2026-11-24T14:30:00.000Z');
  const r = weekCut(anchor, null, sessions, WIDE_COVERAGE);
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}`);
  assertEquals(r.closeSessionDate, '2026-11-27');
  assertEquals(r.close.toISOString(), '2026-11-27T18:00:00.000Z', '1:00 PM EST = 18:00Z');
});

Deno.test('weekCut FLOOR: league drafted Monday 11:00 AM ET -> week starts Tuesday\'s open, not Monday\'s (already past)', () => {
  const sessions = normalWeek('2026-09-28'); // Monday 2026-09-28
  const nominalTuesday = new Date('2026-09-29T14:30:00.000Z'); // planSeason always anchors to Tuesday
  const draftInstant = new Date('2026-09-28T15:00:00.000Z'); // Monday 11:00 AM EDT — AFTER Monday's 13:30Z open
  const r = weekCut(nominalTuesday, draftInstant, sessions, WIDE_COVERAGE);
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}`);
  assertEquals(r.openSessionDate, '2026-09-29', 'Monday\'s own open (13:30Z) is before the floor, so Tuesday\'s is used');
  assertEquals(r.open.toISOString(), '2026-09-29T13:30:00.000Z');
});

Deno.test('weekCut FLOOR: league drafted Monday 6:00 AM ET (before open) -> week starts Monday\'s own open', () => {
  const sessions = normalWeek('2026-09-28');
  const nominalTuesday = new Date('2026-09-29T14:30:00.000Z');
  const draftInstant = new Date('2026-09-28T10:00:00.000Z'); // Monday 6:00 AM EDT — before Monday's open
  const r = weekCut(nominalTuesday, draftInstant, sessions, WIDE_COVERAGE);
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}`);
  assertEquals(r.openSessionDate, '2026-09-28');
  assertEquals(r.open.toISOString(), '2026-09-28T13:30:00.000Z', 'Monday\'s own open, since the draft was before it');
});

Deno.test('weekCut FLOOR: a Tuesday+ draft never binds the floor (weeks 2+ are always far in the future)', () => {
  const sessions = normalWeek('2026-10-05'); // week 2, a week later
  const anchor = new Date('2026-10-06T14:30:00.000Z'); // week 2's nominal Tuesday
  const weekOneDraftInstant = new Date('2026-09-23T15:00:00.000Z'); // long past
  const r = weekCut(anchor, weekOneDraftInstant, sessions, WIDE_COVERAGE);
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}`);
  assertEquals(r.openSessionDate, '2026-10-05', 'the floor never bumps a week that starts well after it — Monday\'s own open is used');
});

Deno.test('weekCut NO COVERAGE: refuses rather than guessing (never reads as "no trading days")', () => {
  const sessions = normalWeek('2026-09-28');
  const anchor = new Date('2026-09-29T14:30:00.000Z');
  const staleCoverage: Coverage = { from: '2026-01-01', through: '2026-09-25' }; // ends before the week
  const r = weekCut(anchor, null, sessions, staleCoverage);
  assertEquals(r, { ok: false, reason: 'no_coverage' });
});

Deno.test('weekCut NO COVERAGE: null coverage (calendar never refreshed) also refuses', () => {
  const sessions = normalWeek('2026-09-28');
  const anchor = new Date('2026-09-29T14:30:00.000Z');
  const r = weekCut(anchor, null, sessions, null);
  assertEquals(r, { ok: false, reason: 'no_coverage' });
});

Deno.test('weekCut NO SESSIONS IN WEEK: covered range but zero sessions that week -> refuses (defensive, not assumed reachable)', () => {
  const r = weekCut(new Date('2026-09-29T14:30:00.000Z'), null, [], WIDE_COVERAGE);
  assertEquals(r, { ok: false, reason: 'no_sessions_in_week' });
});

Deno.test('weekCut FLOOR BEYOND WEEK: every session\'s open precedes the floor -> refuses rather than picking a wrong day', () => {
  const sessions = normalWeek('2026-09-28');
  const anchor = new Date('2026-09-29T14:30:00.000Z');
  const impossibleFloor = new Date('2026-10-05T00:00:00.000Z'); // after the whole week
  const r = weekCut(anchor, impossibleFloor, sessions, WIDE_COVERAGE);
  assertEquals(r, { ok: false, reason: 'floor_beyond_week' });
});

Deno.test('weekCut: the anchor can be ANY instant within the week (Tuesday, Wednesday, or the reconciled Monday open) and still resolves the same week', () => {
  const sessions = normalWeek('2026-09-28');
  const viaTuesday = weekCut(new Date('2026-09-29T14:30:00.000Z'), null, sessions, WIDE_COVERAGE);
  const viaWednesday = weekCut(new Date('2026-09-30T18:00:00.000Z'), null, sessions, WIDE_COVERAGE);
  const viaFriday = weekCut(new Date('2026-10-02T15:00:00.000Z'), null, sessions, WIDE_COVERAGE);
  if (!viaTuesday.ok || !viaWednesday.ok || !viaFriday.ok) throw new Error('expected all ok');
  assertEquals(viaTuesday.open.getTime(), viaWednesday.open.getTime());
  assertEquals(viaTuesday.open.getTime(), viaFriday.open.getTime());
  assertEquals(viaTuesday.close.getTime(), viaFriday.close.getTime());
});

Deno.test('weekCut: sessions outside the week are ignored even if present in the array', () => {
  const sessions = [
    ...normalWeek('2026-09-21'), // the PRIOR week — must not leak in
    ...normalWeek('2026-09-28'),
    ...normalWeek('2026-10-05'), // the NEXT week — must not leak in
  ];
  const anchor = new Date('2026-09-29T14:30:00.000Z');
  const r = weekCut(anchor, null, sessions, WIDE_COVERAGE);
  if (!r.ok) throw new Error('expected ok');
  assertEquals(r.openSessionDate, '2026-09-28', 'Monday\'s open — not leaked from the prior or next week\'s sessions');
  assertEquals(r.closeSessionDate, '2026-10-02');
});
