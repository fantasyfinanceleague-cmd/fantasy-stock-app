/**
 * Boundary tests for lib/home/homePhase.ts — the single source of Home's
 * phase (Phase 3b-2). Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { homePhase, type HomePhaseInput, type MatchupRow } from '../lib/home/homePhase.ts';
import { playoffRoundLabelForWeek } from '../lib/playoffs.ts';

const ET = (iso: string) => new Date(iso);

function row(overrides: Partial<MatchupRow> & { week: number; weekStart: string; weekEnd: string }): MatchupRow {
  return {
    isPlayoff: false,
    myGain: null,
    opponentGain: null,
    hasOpponent: true,
    ...overrides,
  };
}

function baseInput(overrides: Partial<HomePhaseInput>): HomePhaseInput {
  return {
    league: {
      draftStatus: 'completed',
      leagueStartDate: '2026-08-01T00:00:00Z',
      seasonStatus: 'active',
      currentWeek: 6,
      numWeeks: 14,
      playoffTeams: 6,
    },
    current: null,
    previous: null,
    laterPlayoffWeek: null,
    lastPlayoffLoss: false,
    lastPlayoffWeek: null,
    draftOrderWaiting: false,
    now: ET('2026-09-24T15:00:00-04:00'), // Thu 3:00 PM ET, week 6
    market: { status: 'open', reason: 'regular_session', nextOpenAt: null },
    ...overrides,
  };
}

const week6 = row({ week: 6, weekStart: '2026-09-21T09:30:00-04:00', weekEnd: '2026-09-25T16:00:00-04:00' });
const week7 = row({ week: 7, weekStart: '2026-09-28T09:30:00-04:00', weekEnd: '2026-10-02T16:00:00-04:00' });

Deno.test('live_open: Friday 15:59:59 ET, market open, both gains null', () => {
  const r = homePhase(
    baseInput({ current: week6, now: ET('2026-09-25T15:59:59-04:00') }),
    playoffRoundLabelForWeek,
  );
  assertEquals(r.kind, 'live_open');
});

Deno.test('scoring: Friday 16:00:00 ET, both gains still null', () => {
  const r = homePhase(
    baseInput({ current: week6, now: ET('2026-09-25T16:00:00-04:00') }),
    playoffRoundLabelForWeek,
  );
  assertEquals(r.kind, 'scoring');
});

Deno.test('scoring: partial — only my gain posted, opponent still null', () => {
  const partial = { ...week6, myGain: 41.3, opponentGain: null };
  const r = homePhase(
    baseInput({ current: partial, now: ET('2026-09-25T16:05:00-04:00') }),
    playoffRoundLabelForWeek,
  );
  assertEquals(r.kind, 'scoring');
});

Deno.test('scoring: partial — only opponent gain posted, mine still null', () => {
  const partial = { ...week6, myGain: null, opponentGain: -12.0 };
  const r = homePhase(
    baseInput({ current: partial, now: ET('2026-09-25T16:05:00-04:00') }),
    playoffRoundLabelForWeek,
  );
  assertEquals(r.kind, 'scoring');
});

Deno.test('scored: both gains posted, before next week starts', () => {
  const scored = { ...week6, myGain: 41.3, opponentGain: -12.0 };
  const r = homePhase(
    baseInput({ current: scored, now: ET('2026-09-25T16:05:00-04:00') }),
    playoffRoundLabelForWeek,
  );
  assertEquals(r.kind, 'scored');
  if (r.kind === 'scored') {
    assertEquals(r.won, true);
    assertEquals(r.week, 6);
  }
});

Deno.test('scored: the weekend after current_week already advanced (F5)', () => {
  const scoredWeek6 = { ...week6, myGain: 72.1, opponentGain: 10.0 };
  const unstartedWeek7 = { ...week7, myGain: null, opponentGain: null };
  const r = homePhase(
    baseInput({
      league: {
        draftStatus: 'completed', leagueStartDate: '2026-08-01T00:00:00Z',
        seasonStatus: 'active', currentWeek: 7, numWeeks: 14, playoffTeams: 6,
      },
      current: unstartedWeek7,
      previous: scoredWeek6,
      now: ET('2026-09-26T12:00:00-04:00'), // Saturday
    }),
    playoffRoundLabelForWeek,
  );
  assertEquals(r.kind, 'scored');
  if (r.kind === 'scored') {
    assertEquals(r.week, 6);
    assertEquals(r.nextStart, unstartedWeek7.weekStart);
  }
});

Deno.test('scored -> live_open at Monday 09:30:00 ET exactly', () => {
  const scoredWeek6 = { ...week6, myGain: 72.1, opponentGain: 10.0 };
  const unstartedWeek7 = { ...week7, myGain: null, opponentGain: null };
  const before = homePhase(
    baseInput({
      current: unstartedWeek7, previous: scoredWeek6,
      now: ET('2026-09-28T09:29:59-04:00'),
    }),
    playoffRoundLabelForWeek,
  );
  assertEquals(before.kind, 'scored');
  const after = homePhase(
    baseInput({
      current: unstartedWeek7, previous: scoredWeek6,
      now: ET('2026-09-28T09:30:00-04:00'),
    }),
    playoffRoundLabelForWeek,
  );
  assertEquals(after.kind, 'live_open');
});

Deno.test('holiday Monday: still scored at 10:00 Monday, live at Tuesday 09:30 (real row time, no weekday rule)', () => {
  const scoredWeek6 = { ...week6, myGain: 72.1, opponentGain: 10.0 };
  // Week 7 starts Tuesday because Monday is a holiday — the row's own
  // weekStart carries that, not a hardcoded weekday.
  const holidayWeek7 = row({ week: 7, weekStart: '2026-09-29T09:30:00-04:00', weekEnd: '2026-10-03T16:00:00-04:00' });
  const monday = homePhase(
    baseInput({
      current: holidayWeek7, previous: scoredWeek6,
      now: ET('2026-09-28T10:00:00-04:00'), // Monday, holiday
      market: { status: 'closed', reason: 'holiday', nextOpenAt: '2026-09-29T09:30:00-04:00' },
    }),
    playoffRoundLabelForWeek,
  );
  assertEquals(monday.kind, 'scored');
  const tuesday = homePhase(
    baseInput({
      current: holidayWeek7, previous: scoredWeek6,
      now: ET('2026-09-29T09:30:00-04:00'),
      market: { status: 'open', reason: 'regular_session', nextOpenAt: null },
    }),
    playoffRoundLabelForWeek,
  );
  assertEquals(tuesday.kind, 'live_open');
});

Deno.test('live_closed: Wednesday overnight, resumes from the market calendar', () => {
  const r = homePhase(
    baseInput({
      current: week6,
      now: ET('2026-09-23T20:00:00-04:00'), // Wed 8pm
      market: { status: 'closed', reason: 'after_hours', nextOpenAt: '2026-09-24T09:30:00-04:00' },
    }),
    playoffRoundLabelForWeek,
  );
  assertEquals(r.kind, 'live_closed');
  if (r.kind === 'live_closed') {
    assertEquals(r.reason, 'after_hours');
    assertEquals(r.resumesAt, '2026-09-24T09:30:00-04:00');
  }
});

Deno.test('live_closed: market status unknown never claims open, and never invents a resume time', () => {
  const r = homePhase(
    baseInput({
      current: week6,
      now: ET('2026-09-23T20:00:00-04:00'),
      market: { status: 'unknown', reason: 'no_coverage', nextOpenAt: '2026-09-24T09:30:00-04:00' },
    }),
    playoffRoundLabelForWeek,
  );
  assertEquals(r.kind, 'live_closed');
  if (r.kind === 'live_closed') {
    assertEquals(r.resumesAt, null);
  }
});

Deno.test('bye: regular season, no opponent this week, never a score', () => {
  const bye = row({ week: 6, weekStart: week6.weekStart, weekEnd: week6.weekEnd, hasOpponent: false });
  const r = homePhase(
    baseInput({ current: bye, now: ET('2026-09-23T15:00:00-04:00') }),
    playoffRoundLabelForWeek,
  );
  assertEquals(r.kind, 'bye');
  if (r.kind === 'bye') assertEquals(r.week, 6);
});

Deno.test('playoffs: live semifinal carries the round label', () => {
  const playoffWeek = row({
    week: 15, weekStart: '2026-12-14T09:30:00-04:00', weekEnd: '2026-12-18T16:00:00-04:00', isPlayoff: true,
  });
  const r = homePhase(
    baseInput({
      league: { draftStatus: 'completed', leagueStartDate: '2026-08-01T00:00:00Z', seasonStatus: 'playoffs', currentWeek: 15, numWeeks: 14, playoffTeams: 4 },
      current: playoffWeek,
      now: ET('2026-12-15T15:00:00-04:00'),
    }),
    playoffRoundLabelForWeek,
  );
  assertEquals(r.kind, 'live_open');
  if (r.kind === 'live_open') {
    assertEquals(r.isPlayoff, true);
    assertEquals(r.round, 'Semifinals');
  }
});

Deno.test('playoffs: first-round bye when a later round is already scheduled for me', () => {
  const r = homePhase(
    baseInput({
      league: { draftStatus: 'completed', leagueStartDate: '2026-08-01T00:00:00Z', seasonStatus: 'playoffs', currentWeek: 15, numWeeks: 14, playoffTeams: 6 },
      current: null,
      laterPlayoffWeek: 16,
      now: ET('2026-12-15T15:00:00-04:00'),
    }),
    playoffRoundLabelForWeek,
  );
  assertEquals(r.kind, 'playoff_bye');
  // Real week number, not arithmetic (Design Lead ruling, 2026-09-30): the
  // bye's week is the LATER round's real week_number (16), never
  // `current?.week ?? previous?.week + 1` guessed from the current week.
  if (r.kind === 'playoff_bye') assertEquals(r.week, 16);
});

Deno.test('playoffs: eliminated when the last playoff row was a loss and nothing later is scheduled', () => {
  const lostSemi = row({
    week: 15, weekStart: '2026-12-14T09:30:00-04:00', weekEnd: '2026-12-18T16:00:00-04:00',
    isPlayoff: true, myGain: -10, opponentGain: 40,
  });
  const r = homePhase(
    baseInput({
      league: { draftStatus: 'completed', leagueStartDate: '2026-08-01T00:00:00Z', seasonStatus: 'playoffs', currentWeek: 16, numWeeks: 14, playoffTeams: 4 },
      current: null,
      previous: lostSemi,
      lastPlayoffLoss: true,
      lastPlayoffWeek: 15,
      now: ET('2026-12-21T15:00:00-04:00'),
    }),
    playoffRoundLabelForWeek,
  );
  assertEquals(r.kind, 'eliminated');
  if (r.kind === 'eliminated') assertEquals(r.round, 'Semifinals');
});

Deno.test('complete: season_status completed wins over every other check', () => {
  const r = homePhase(
    baseInput({
      league: { draftStatus: 'completed', leagueStartDate: '2026-08-01T00:00:00Z', seasonStatus: 'completed', currentWeek: 17, numWeeks: 14, playoffTeams: 6 },
      current: week6,
      now: ET('2026-09-23T15:00:00-04:00'),
    }),
    playoffRoundLabelForWeek,
  );
  assertEquals(r.kind, 'complete');
});

Deno.test('pre_draft: not started, waiting for the draft order', () => {
  const r = homePhase(
    baseInput({
      league: { draftStatus: 'not_started', leagueStartDate: null, seasonStatus: 'active', currentWeek: 1, numWeeks: 14, playoffTeams: 6 },
      draftOrderWaiting: true,
    }),
    playoffRoundLabelForWeek,
  );
  assertEquals(r.kind, 'pre_draft');
  if (r.kind === 'pre_draft') assertEquals(r.waiting, true);
});

Deno.test('pre_draft: order set, not waiting', () => {
  const r = homePhase(
    baseInput({
      league: { draftStatus: 'not_started', leagueStartDate: null, seasonStatus: 'active', currentWeek: 1, numWeeks: 14, playoffTeams: 6 },
      draftOrderWaiting: false,
    }),
    playoffRoundLabelForWeek,
  );
  assertEquals(r.kind, 'pre_draft');
  if (r.kind === 'pre_draft') assertEquals(r.waiting, false);
});

Deno.test('drafting: draft in progress', () => {
  const r = homePhase(
    baseInput({
      league: { draftStatus: 'in_progress', leagueStartDate: null, seasonStatus: 'active', currentWeek: 1, numWeeks: 14, playoffTeams: 6 },
    }),
    playoffRoundLabelForWeek,
  );
  assertEquals(r.kind, 'drafting');
});

Deno.test('pre_season: draft done, league_start_date in the future', () => {
  const r = homePhase(
    baseInput({
      league: { draftStatus: 'completed', leagueStartDate: '2026-09-29T00:00:00Z', seasonStatus: 'active', currentWeek: 1, numWeeks: 14, playoffTeams: 6 },
      now: ET('2026-09-27T12:00:00-04:00'), // Sunday, before Monday's open
    }),
    playoffRoundLabelForWeek,
  );
  assertEquals(r.kind, 'pre_season');
});

Deno.test('missed_playoffs: playoffs on, no row for me ever (never seeded into the bracket)', () => {
  const r = homePhase(
    baseInput({
      league: { draftStatus: 'completed', leagueStartDate: '2026-08-01T00:00:00Z', seasonStatus: 'playoffs', currentWeek: 15, numWeeks: 14, playoffTeams: 4 },
      current: null,
      previous: null,
      laterPlayoffWeek: null,
      lastPlayoffLoss: false,
      now: ET('2026-12-15T15:00:00-04:00'),
    }),
    playoffRoundLabelForWeek,
  );
  assertEquals(r.kind, 'missed_playoffs');
});
