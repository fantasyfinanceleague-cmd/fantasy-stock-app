/**
 * 3c Matchup pure logic: the race (no interpolation), lead-change detection
 * (30 s limit, mover naming), reveal-once persistence, and the phase -> view
 * mapping. Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { weekRacePoints } from '../lib/game/weekRace.ts';
import { leaderOf, detectLeadChange, pickMover } from '../lib/game/leadChange.ts';
import { revealKey, shouldPlayReveal, markRevealPlayed, type KeyValueStore } from '../lib/game/revealOnce.ts';
import { matchupView } from '../lib/game/matchupPhase.ts';
import type { PhaseResult } from '../lib/home/homePhase.ts';

const memStore = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v) };
};

// ---------------------------------------------------------------------------
// weekRace
// ---------------------------------------------------------------------------

const SNAP = [{ symbol: 'NVDA', quantity: 10, weekStartPrice: 100, enteredMidWeek: false }];

Deno.test('weekRace: each day is the score at that day close, from that day\'s price', () => {
  const pts = weekRacePoints(SNAP, [], [
    { date: '2026-09-28', closeAt: new Date('2026-09-28T20:00:00Z'), price: () => 102 },
    { date: '2026-09-29', closeAt: new Date('2026-09-29T20:00:00Z'), price: () => 95 },
  ]);
  assertEquals(pts.map((p) => [p.date, Math.round(p.gain * 100) / 100]), [['2026-09-28', 20], ['2026-09-29', -50]]);
});

Deno.test('weekRace: a trade counts only from the day it happened (no backdating)', () => {
  const trades = [{ symbol: 'NVDA', action: 'buy' as const, quantity: 5, price: 110, createdAt: new Date('2026-09-29T15:00:00Z') }];
  const pts = weekRacePoints(SNAP, trades, [
    { date: '2026-09-28', closeAt: new Date('2026-09-28T20:00:00Z'), price: () => 102 },
    { date: '2026-09-29', closeAt: new Date('2026-09-29T20:00:00Z'), price: () => 112 },
  ]);
  // Monday: no trade yet -> 10 * (102-100). Tuesday: the 5 bought at 110 gain 2 each.
  assertEquals(Math.round(pts[0].gain * 100) / 100, 20);
  assertEquals(Math.round(pts[1].gain * 100) / 100, 10 * 12 + 5 * 2);
});

Deno.test('weekRace: a day with no bar is ABSENT, never a zero or an interpolated point', () => {
  const pts = weekRacePoints(SNAP, [], [
    { date: '2026-09-28', closeAt: new Date('2026-09-28T20:00:00Z'), price: () => 102 },
    { date: '2026-09-29', closeAt: new Date('2026-09-29T20:00:00Z'), price: () => null },
  ]);
  assertEquals(pts.map((p) => p.date), ['2026-09-28']);
});

// ---------------------------------------------------------------------------
// leadChange
// ---------------------------------------------------------------------------

Deno.test('leaderOf: me / opp / tie', () => {
  assertEquals(leaderOf(213.6, 90.44), 'me');
  assertEquals(leaderOf(-1, 2), 'opp');
  assertEquals(leaderOf(5, 5), 'tie');
});

Deno.test('detectLeadChange: a flip fires; the same leader, a first read, and a tie do not', () => {
  assertEquals(detectLeadChange('opp', 'me', 1_000_000, null), true);
  assertEquals(detectLeadChange('me', 'me', 1_000_000, null), false);
  assertEquals(detectLeadChange(null, 'me', 1_000_000, null), false);
  assertEquals(detectLeadChange('me', 'tie', 1_000_000, null), false);
  assertEquals(detectLeadChange('tie', 'opp', 1_000_000, null), false);
});

Deno.test('detectLeadChange: at most one per 30 s (a flip inside the window is suppressed)', () => {
  const t0 = 1_000_000;
  assertEquals(detectLeadChange('me', 'opp', t0 + 29_999, t0), false);
  assertEquals(detectLeadChange('me', 'opp', t0 + 30_000, t0), true);
});

Deno.test('pickMover: names the stock whose contribution moved the most since the last poll', () => {
  assertEquals(pickMover({ NVDA: 100, AAPL: 50 }, { NVDA: 102.9, AAPL: 51 }), 'NVDA');
  assertEquals(pickMover({ NVDA: 100 }, { NVDA: 100 }), null);
  // A brand-new position moves from 0.
  assertEquals(pickMover({ NVDA: 1 }, { NVDA: 1, CRM: -9 }), 'CRM');
});

// ---------------------------------------------------------------------------
// revealOnce
// ---------------------------------------------------------------------------

Deno.test('revealOnce: plays once per matchup-week, only once final, and never again after marking', () => {
  const store = memStore();
  const key = revealKey('lg-1', 6);
  assertEquals(shouldPlayReveal(store, key, false), false); // not final yet
  assertEquals(shouldPlayReveal(store, key, true), true);
  markRevealPlayed(store, key);
  assertEquals(shouldPlayReveal(store, key, true), false);
  // Another week, same league, still plays.
  assertEquals(shouldPlayReveal(store, revealKey('lg-1', 7), true), true);
});

// ---------------------------------------------------------------------------
// matchupView
// ---------------------------------------------------------------------------

const base = { numWeeks: 14 };
const liveRound = null;

Deno.test('matchupView: live open and closed are both a scoreboard; closed says so', () => {
  assertEquals(matchupView({ kind: 'live_open', week: 6, isPlayoff: false, round: liveRound, weekEnd: 'x', ...base }), { kind: 'scoreboard', live: true, closed: false });
  assertEquals(matchupView({ kind: 'live_closed', week: 6, isPlayoff: false, round: liveRound, reason: 'after_hours', resumesAt: null, weekEnd: 'x', lastCloseAt: null, ...base }), { kind: 'scoreboard', live: true, closed: true });
});

Deno.test('matchupView: scoring is not final; scored is final with the result', () => {
  assertEquals(matchupView({ kind: 'scoring', week: 6, isPlayoff: false, round: null, weekEnd: 'x', ...base }), { kind: 'scoring' });
  assertEquals(matchupView({ kind: 'scored', week: 6, won: true, isPlayoff: false, round: null, nextStart: null, ...base }), { kind: 'final', won: true });
});

Deno.test('matchupView: pre-season and bye have no scoreboard; a bye is the neutral state', () => {
  assertEquals(matchupView({ kind: 'pre_season', seasonStartsAt: null, ...base }), { kind: 'pre_season' });
  assertEquals(matchupView({ kind: 'bye', week: 6, nextStart: null, ...base }), { kind: 'bye' });
});

Deno.test('matchupView: playoff states carry the round, and an out team says so', () => {
  assertEquals(matchupView({ kind: 'playoff_pending', week: 13, round: 'Semifinals', previousRound: 'Wild card', ...base }), { kind: 'playoff_pending', round: 'Semifinals' });
  assertEquals(matchupView({ kind: 'eliminated', round: 'Semifinals', ...base }), { kind: 'eliminated', round: 'Semifinals' });
  assertEquals(matchupView({ kind: 'missed_playoffs', ...base }), { kind: 'missed_playoffs' });
});

Deno.test('matchupView: a league that has not started has no matchup', () => {
  assertEquals(matchupView({ kind: 'pre_draft', waiting: false, ...base } as PhaseResult), { kind: 'not_started' });
  assertEquals(matchupView({ kind: 'drafting', ...base } as PhaseResult), { kind: 'not_started' });
});
