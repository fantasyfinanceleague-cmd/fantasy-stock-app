/**
 * Hermetic unit tests for lib/weekStatus.ts's season-phase logic. No RN, no
 * Deno runtime APIs beyond Date — run:
 *
 *   deno test apps/mobile/tests-deno/
 *
 * Kept outside apps/mobile's own tsconfig/eslint scope (tsconfig.json
 * excludes tests-deno/**) since `jsr:` specifiers are Deno-only.
 *
 * Covers the "Week 1 · Live" bug: getWeekStatus used to derive status/phase
 * purely from season_status/current_week, both of which default to
 * 'active'/1 for a league that hasn't even drafted yet — so a not-started or
 * mid-draft league showed a Live badge for a week that had never started.
 * getSeasonPhase reads draft_status FIRST, and getWeekStatus's 'upcoming'
 * status takes priority over every other branch for exactly that reason.
 */
import { assertEquals, assertStringIncludes } from 'jsr:@std/assert';
import {
  getSeasonPhase,
  getSeasonLabel,
  isPreSeasonPhase,
  getWeekStatus,
  formatShortWeekdayDate,
  formatShortMonthDay,
  formatShortDateTime,
  formatSeasonStartShort,
} from '../lib/weekStatus.ts';

// ---------------------------------------------------------------------------
// getSeasonPhase
// ---------------------------------------------------------------------------

Deno.test('getSeasonPhase: null league is pre_draft', () => {
  assertEquals(getSeasonPhase(null), 'pre_draft');
});

Deno.test('getSeasonPhase: draft_status not_started is pre_draft regardless of other fields', () => {
  assertEquals(
    getSeasonPhase({ draft_status: 'not_started', season_status: 'completed', current_week: 5, num_weeks: 3 }),
    'pre_draft',
  );
});

Deno.test('getSeasonPhase: draft_status in_progress is drafting regardless of other fields', () => {
  assertEquals(
    getSeasonPhase({ draft_status: 'in_progress', season_status: 'playoffs', current_week: 2, num_weeks: 3 }),
    'drafting',
  );
});

Deno.test('getSeasonPhase: draft completed with a future league_start_date is pre_season', () => {
  const now = new Date('2026-09-25T12:00:00Z');
  assertEquals(
    getSeasonPhase({ draft_status: 'completed', league_start_date: '2026-09-29T13:30:00Z' }, now),
    'pre_season',
  );
});

Deno.test('getSeasonPhase: draft completed with a past league_start_date falls through to season_status', () => {
  const now = new Date('2026-09-25T12:00:00Z');
  assertEquals(
    getSeasonPhase({ draft_status: 'completed', league_start_date: '2026-09-01T13:30:00Z', season_status: 'active' }, now),
    'regular',
  );
});

Deno.test('getSeasonPhase: draft completed with no league_start_date falls through to season_status (no crash on null start)', () => {
  assertEquals(
    getSeasonPhase({ draft_status: 'completed', league_start_date: null, season_status: 'playoffs' }),
    'playoffs',
  );
});

Deno.test('getSeasonPhase: an unparseable league_start_date is not treated as a future date', () => {
  assertEquals(
    getSeasonPhase({ draft_status: 'completed', league_start_date: 'not-a-date', season_status: 'active' }),
    'regular',
  );
});

Deno.test('getSeasonPhase: season_status completed', () => {
  assertEquals(getSeasonPhase({ draft_status: 'completed', season_status: 'completed' }), 'completed');
});

Deno.test('getSeasonPhase: legacy fallback — current_week past num_weeks with no season_status completed flag', () => {
  assertEquals(
    getSeasonPhase({ draft_status: 'completed', season_status: 'active', current_week: 5, num_weeks: 4 }),
    'completed',
  );
});

Deno.test('getSeasonPhase: an undefined draft_status (legacy row) is treated like completed, not pre_draft', () => {
  assertEquals(getSeasonPhase({ season_status: 'active' }), 'regular');
});

// ---------------------------------------------------------------------------
// isPreSeasonPhase
// ---------------------------------------------------------------------------

Deno.test('isPreSeasonPhase: true for pre_draft, drafting, pre_season; false otherwise', () => {
  assertEquals(isPreSeasonPhase('pre_draft'), true);
  assertEquals(isPreSeasonPhase('drafting'), true);
  assertEquals(isPreSeasonPhase('pre_season'), true);
  assertEquals(isPreSeasonPhase('regular'), false);
  assertEquals(isPreSeasonPhase('playoffs'), false);
  assertEquals(isPreSeasonPhase('completed'), false);
});

// ---------------------------------------------------------------------------
// getSeasonLabel
// ---------------------------------------------------------------------------

Deno.test('getSeasonLabel: pre_draft and drafting have fixed copy', () => {
  assertEquals(getSeasonLabel('pre_draft', null), 'Draft pending');
  assertEquals(getSeasonLabel('drafting', null), 'Drafting');
});

Deno.test('getSeasonLabel: pre_season formats the league_start_date', () => {
  const label = getSeasonLabel('pre_season', { league_start_date: '2026-09-29T13:30:00Z' });
  assertStringIncludes(label, 'Starts');
});

Deno.test('getSeasonLabel: pre_season with no/invalid start date falls back rather than showing "Invalid Date"', () => {
  assertEquals(getSeasonLabel('pre_season', { league_start_date: null }), 'Starts soon');
  assertEquals(getSeasonLabel('pre_season', null), 'Starts soon');
  assertEquals(getSeasonLabel('pre_season', { league_start_date: 'not-a-date' }), 'Starts soon');
});

Deno.test('getSeasonLabel: regular/playoffs/completed return empty (callers keep their own copy)', () => {
  assertEquals(getSeasonLabel('regular', null), '');
  assertEquals(getSeasonLabel('playoffs', null), '');
  assertEquals(getSeasonLabel('completed', null), '');
});

// ---------------------------------------------------------------------------
// getWeekStatus — status='upcoming' must win over every other branch for a
// pre-season league (the actual "Week 1 · Live" bug fix)
// ---------------------------------------------------------------------------

Deno.test('getWeekStatus: not_started league is upcoming, never active, even with current_week/num_weeks set', () => {
  const status = getWeekStatus({ draft_status: 'not_started', current_week: 1, num_weeks: 10, season_status: 'active' }, null);
  assertEquals(status.status, 'upcoming');
  assertEquals(status.seasonPhase, 'pre_draft');
});

Deno.test('getWeekStatus: in_progress (drafting) league is upcoming', () => {
  const status = getWeekStatus({ draft_status: 'in_progress', current_week: 1, num_weeks: 10 }, null);
  assertEquals(status.status, 'upcoming');
  assertEquals(status.seasonPhase, 'drafting');
});

Deno.test('getWeekStatus: drafted league with a future start date is upcoming, not season_complete/final/active', () => {
  const now = new Date('2026-09-25T12:00:00Z');
  const status = getWeekStatus(
    { draft_status: 'completed', league_start_date: '2026-09-29T13:30:00Z', current_week: 1, num_weeks: 10, season_status: 'active' },
    null,
    now,
  );
  assertEquals(status.status, 'upcoming');
  assertEquals(status.seasonPhase, 'pre_season');
});

// ---------------------------------------------------------------------------
// Short date/time formatters — the design review's "reuse the weekday
// formatter, no seconds" request for the Draft screen's timestamps, and the
// Week KPI card's "Sep 29" (no weekday) value.
// ---------------------------------------------------------------------------

Deno.test('formatShortWeekdayDate: includes a short weekday and month, no year', () => {
  const s = formatShortWeekdayDate(new Date('2026-09-29T13:30:00Z'));
  assertStringIncludes(s, 'Sep');
  assertStringIncludes(s, '29');
  // No four-digit year in a "weekday, month day" format.
  assertEquals(/\b2026\b/.test(s), false);
});

Deno.test('formatShortMonthDay: month + day only, no weekday name', () => {
  const s = formatShortMonthDay(new Date('2026-09-29T13:30:00Z'));
  assertStringIncludes(s, 'Sep');
  assertStringIncludes(s, '29');
  // None of the weekday names should appear (this is the whole point of
  // the "short" variant vs formatShortWeekdayDate).
  for (const day of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) {
    assertEquals(s.includes(day), false);
  }
});

Deno.test('formatShortDateTime: no seconds, no four-digit year', () => {
  const s = formatShortDateTime('2026-09-25T18:43:59-07:00');
  assertEquals(s.includes('59'), false); // the seconds component specifically (minute is 43)
  assertEquals(/\b2026\b/.test(s), false);
  assertStringIncludes(s, 'Sep');
});

Deno.test('formatShortDateTime: accepts a Date as well as a string', () => {
  const fromString = formatShortDateTime('2026-09-25T18:43:00-07:00');
  const fromDate = formatShortDateTime(new Date('2026-09-25T18:43:00-07:00'));
  assertEquals(fromString, fromDate);
});

Deno.test('formatShortDateTime: an unparseable input does not throw or return "Invalid Date"', () => {
  const s = formatShortDateTime('not-a-date');
  assertEquals(s, 'Invalid date');
});

Deno.test('formatSeasonStartShort: matches getSeasonLabel\'s date, without the weekday or "Starts" prefix', () => {
  const league = { league_start_date: '2026-09-29T13:30:00Z' };
  const short = formatSeasonStartShort(league);
  const long = getSeasonLabel('pre_season', league);
  assertStringIncludes(long, short); // "Starts Tue, Sep 29" contains "Sep 29"
  assertStringIncludes(short, 'Sep');
  assertStringIncludes(short, '29');
});

Deno.test('formatSeasonStartShort: falls back to "Soon" for a missing/invalid date, matching getSeasonLabel\'s fallback', () => {
  assertEquals(formatSeasonStartShort(null), 'Soon');
  assertEquals(formatSeasonStartShort({ league_start_date: null }), 'Soon');
  assertEquals(formatSeasonStartShort({ league_start_date: 'not-a-date' }), 'Soon');
});

Deno.test('getWeekStatus: a completed-draft, season-started league is unaffected (regression guard)', () => {
  const now = new Date('2026-09-25T12:00:00Z');
  const status = getWeekStatus(
    { draft_status: 'completed', league_start_date: '2026-09-01T13:30:00Z', current_week: 2, num_weeks: 10, season_status: 'active' },
    null,
    now,
  );
  assertEquals(status.status, 'active');
  assertEquals(status.phase, 'regular');
  assertEquals(status.seasonPhase, 'regular');
});
