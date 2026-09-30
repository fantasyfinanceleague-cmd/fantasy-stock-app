/**
 * Hermetic tests for the league sheet's pure logic (Phase 3b-1): phase
 * grouping (Live this week / Upcoming / Finished), the rank · record meta
 * line ("2nd of 6 · 4–1"), the PhaseChip mapping, and which league is
 * active after a relaunch.
 *
 *   cd apps/mobile/tests-deno && deno test .
 */
import { assertEquals } from 'jsr:@std/assert';
import {
  accessibleLeagueRow,
  chipLabelFor,
  chipPhaseFor,
  moreLeaguesCount,
  pillAccessibilityLabel,
  formatLeagueMeta,
  formatRecord,
  groupLeagues,
  ordinal,
  sheetGroupFor,
  type SheetLeague,
} from '../lib/shell/leagueSheet.ts';
import { activeLeagueStorageKey, resolveActiveLeagueId } from '../lib/shell/activeLeague.ts';

function league(over: Partial<SheetLeague> = {}): SheetLeague {
  return {
    id: 'l1',
    name: 'Friday Night Stocks',
    seasonPhase: 'regular',
    marketOpen: true,
    rank: 2,
    rankCount: 6,
    wins: 4,
    losses: 1,
    ties: 0,
    membersJoined: 6,
    capacity: 6,
    isChampion: false,
    seasonLabel: '',
    currentWeek: 6,
    numWeeks: 10,
    playoffTeams: 4,
    draftDate: null,
    ...over,
  };
}

// ── ordinal / record ──────────────────────────────────────────────────────

Deno.test('ordinal: English suffixes incl. the teens', () => {
  const cases: [number, string][] = [
    [1, '1st'], [2, '2nd'], [3, '3rd'], [4, '4th'], [10, '10th'],
    [11, '11th'], [12, '12th'], [13, '13th'], [21, '21st'], [22, '22nd'], [23, '23rd'], [101, '101st'], [111, '111th'],
  ];
  for (const [n, s] of cases) assertEquals(ordinal(n), s);
});

Deno.test('record: W–L with an en dash; –T only when ties > 0', () => {
  assertEquals(formatRecord(4, 1, 0), '4–1');
  assertEquals(formatRecord(4, 1, 1), '4–1–1');
  assertEquals(formatRecord(0, 0, 0), '0–0');
  // numeric(5,1) from Postgres arrives as a string or a float
  assertEquals(formatRecord('10.0' as unknown as number, '4.0' as unknown as number, '0.0' as unknown as number), '10–4');
});

// ── grouping ──────────────────────────────────────────────────────────────

Deno.test('group: each season phase lands in exactly one sheet group', () => {
  assertEquals(sheetGroupFor('regular'), 'live');
  assertEquals(sheetGroupFor('playoffs'), 'live');
  assertEquals(sheetGroupFor('drafting'), 'live'); // a live draft is happening this week
  assertEquals(sheetGroupFor('pre_draft'), 'upcoming');
  assertEquals(sheetGroupFor('pre_season'), 'upcoming');
  assertEquals(sheetGroupFor('completed'), 'finished');
});

Deno.test('group: order is Live, Upcoming, Finished; empty groups are omitted; input order kept', () => {
  const groups = groupLeagues([
    league({ id: 'a', seasonPhase: 'completed' }),
    league({ id: 'b', seasonPhase: 'regular' }),
    league({ id: 'c', seasonPhase: 'pre_draft' }),
    league({ id: 'd', seasonPhase: 'playoffs' }),
  ]);
  assertEquals(groups.map((g) => g.key), ['live', 'upcoming', 'finished']);
  assertEquals(groups.map((g) => g.title), ['Live this week', 'Upcoming', 'Finished']);
  assertEquals(groups[0].leagues.map((l) => l.id), ['b', 'd']);
  assertEquals(groupLeagues([league({ seasonPhase: 'regular' })]).map((g) => g.key), ['live']);
  assertEquals(groupLeagues([]), []);
});

// ── chip ──────────────────────────────────────────────────────────────────

Deno.test('chip: regular season is Live only while the market is open', () => {
  assertEquals(chipPhaseFor('regular', true), 'live_open');
  assertEquals(chipPhaseFor('regular', false), 'live_closed');
  assertEquals(chipPhaseFor('pre_draft', true), 'pre_draft');
  assertEquals(chipPhaseFor('drafting', false), 'drafting');
  assertEquals(chipPhaseFor('pre_season', true), 'pre_season');
  assertEquals(chipPhaseFor('playoffs', false), 'playoffs');
  assertEquals(chipPhaseFor('completed', true), 'season_complete');
});

// ── meta line ─────────────────────────────────────────────────────────────

Deno.test('meta: live league shows rank of count · record (the board line)', () => {
  assertEquals(formatLeagueMeta(league()), '2nd of 6 · 4–1');
  assertEquals(formatLeagueMeta(league({ seasonPhase: 'playoffs', rank: 1, wins: 5, losses: 1, ties: 1 })), '1st of 6 · 5–1–1');
});

Deno.test('meta: finished league says Champion only when I actually won it', () => {
  assertEquals(
    formatLeagueMeta(league({ seasonPhase: 'completed', rank: 1, rankCount: 8, wins: 10, losses: 4, isChampion: true })),
    'Champion · 1st of 8 · 10–4'
  );
  // Ranked 1st in the table but not the season's champion (e.g. lost the final)
  assertEquals(
    formatLeagueMeta(league({ seasonPhase: 'completed', rank: 1, rankCount: 8, wins: 10, losses: 4, isChampion: false })),
    '1st of 8 · 10–4'
  );
});

Deno.test('meta: pre-draft and drafting leagues show who has joined', () => {
  assertEquals(formatLeagueMeta(league({ seasonPhase: 'pre_draft', membersJoined: 6, capacity: 8, rank: null })), '6 of 8 joined');
  assertEquals(formatLeagueMeta(league({ seasonPhase: 'drafting', membersJoined: 8, capacity: 8, rank: null })), '8 of 8 joined');
});

Deno.test('meta: pre-season reuses the existing season label, never a rank', () => {
  assertEquals(formatLeagueMeta(league({ seasonPhase: 'pre_season', seasonLabel: 'Starts Tue, Sep 29', rank: 1 })), 'Starts Tue, Sep 29');
});

Deno.test('meta: missing standings never invent a rank', () => {
  assertEquals(formatLeagueMeta(league({ rank: null, rankCount: null })), '');
  assertEquals(formatLeagueMeta(league({ seasonPhase: 'pre_draft', membersJoined: null, capacity: 8, rank: null })), '');
});

// ── active league persistence ─────────────────────────────────────────────

Deno.test('active league: the stored id wins while I am still in that league', () => {
  const ls = [league({ id: 'x', seasonPhase: 'completed' }), league({ id: 'y', seasonPhase: 'regular' })];
  assertEquals(resolveActiveLeagueId('x', ls), 'x');
});

Deno.test('active league: a stale id (league left or deleted) falls back to the first live league', () => {
  const ls = [
    league({ id: 'done', seasonPhase: 'completed' }),
    league({ id: 'soon', seasonPhase: 'pre_draft' }),
    league({ id: 'live', seasonPhase: 'regular' }),
  ];
  assertEquals(resolveActiveLeagueId('gone', ls), 'live');
  assertEquals(resolveActiveLeagueId(null, ls), 'live');
});

Deno.test('active league: no live league → upcoming, then finished; none → null', () => {
  assertEquals(resolveActiveLeagueId(null, [league({ id: 'f', seasonPhase: 'completed' }), league({ id: 'u', seasonPhase: 'pre_season' })]), 'u');
  assertEquals(resolveActiveLeagueId(null, [league({ id: 'f', seasonPhase: 'completed' })]), 'f');
  assertEquals(resolveActiveLeagueId('f', []), null);
});

Deno.test('active league: the storage key is per user, so accounts never share a choice', () => {
  assertEquals(activeLeagueStorageKey('u1') === activeLeagueStorageKey('u2'), false);
  assertEquals(activeLeagueStorageKey('u1'), activeLeagueStorageKey('u1'));
});

// ── VoiceOver + pill copy ─────────────────────────────────────────────────

Deno.test('a11y: sheet rows announce name, rank, record in words, and the chip as shown', () => {
  assertEquals(accessibleLeagueRow(league(), true), 'Friday Night Stocks, 2nd of 6, 4 wins, 1 loss, Week 6, selected');
  assertEquals(
    accessibleLeagueRow(league({ wins: 1, losses: 0, ties: 2, marketOpen: false }), false),
    'Friday Night Stocks, 2nd of 6, 1 win, 0 losses, 2 ties, Week 6'
  );
  assertEquals(
    accessibleLeagueRow(league({ seasonPhase: 'completed', rank: 1, rankCount: 8, wins: 10, losses: 4, isChampion: true }), false),
    'Friday Night Stocks, Champion, 1st of 8, 10 wins, 4 losses, Final'
  );
  assertEquals(
    accessibleLeagueRow(league({ seasonPhase: 'pre_draft', membersJoined: 6, capacity: 8, rank: null }), false),
    'Friday Night Stocks, 6 of 8 joined, Pre-draft'
  );
});

Deno.test('pill: "+N" counts the OTHER leagues and hides at zero; the label matches the spec', () => {
  assertEquals(moreLeaguesCount(1), 0);
  assertEquals(moreLeaguesCount(4), 3);
  assertEquals(moreLeaguesCount(0), 0);
  assertEquals(pillAccessibilityLabel('Friday Night Stocks', 3), 'Friday Night Stocks, 3 more leagues');
  assertEquals(pillAccessibilityLabel('Friday Night Stocks', 1), 'Friday Night Stocks, 1 more league');
  assertEquals(pillAccessibilityLabel('Friday Night Stocks', 0), 'Friday Night Stocks');
});

// ── PhaseChip labels in the sheet (Design Lead ruling) ────────────────────

Deno.test('chip label: live leagues read "Week N"', () => {
  assertEquals(chipLabelFor(league({ seasonPhase: 'regular', currentWeek: 6 })), 'Week 6');
  assertEquals(chipLabelFor(league({ seasonPhase: 'regular', currentWeek: 2, marketOpen: false })), 'Week 2');
});

Deno.test('chip label: an upcoming draft reads "Draft Sat 7:00 PM ET" in Eastern time', () => {
  // 2026-10-03 23:00 UTC = Sat 7:00 PM EDT
  assertEquals(chipLabelFor(league({ seasonPhase: 'pre_draft', draftDate: '2026-10-03T23:00:00Z' })), 'Draft Sat 7:00 PM ET');
  // 2026-12-05 00:30 UTC = Fri Dec 4, 7:30 PM EST
  assertEquals(chipLabelFor(league({ seasonPhase: 'pre_draft', draftDate: '2026-12-05T00:30:00Z' })), 'Draft Fri 7:30 PM ET');
});

Deno.test('chip label: finished reads "Final"; phases without a better label keep the chip default', () => {
  assertEquals(chipLabelFor(league({ seasonPhase: 'completed' })), 'Final');
  // No specific label: the phase's own name, still passed as a label so the
  // chip stays sentence case (never the ALL-CAPS tag default in the shell).
  assertEquals(chipLabelFor(league({ seasonPhase: 'pre_draft', draftDate: null })), 'Pre-draft');
  assertEquals(chipLabelFor(league({ seasonPhase: 'drafting' })), 'Drafting');
  assertEquals(chipLabelFor(league({ seasonPhase: 'pre_season' })), 'Pre-season');
  assertEquals(chipLabelFor(league({ seasonPhase: 'playoffs' })), 'Playoffs');
});

Deno.test('chip label: playoffs name the round (lib/playoffs), keyed on structure', () => {
  // 10-week season, 4-team playoff: week 11 = round 1, week 12 = round 2.
  const r1 = chipLabelFor(league({ seasonPhase: 'playoffs', currentWeek: 11, numWeeks: 10, playoffTeams: 4 }));
  const r2 = chipLabelFor(league({ seasonPhase: 'playoffs', currentWeek: 12, numWeeks: 10, playoffTeams: 4 }));
  assertEquals(typeof r1, 'string');
  assertEquals(r1 === r2, false);
});

Deno.test('a11y: a row announces the chip label it shows ("Week 6"), not the generic phase', () => {
  assertEquals(accessibleLeagueRow(league(), false), 'Friday Night Stocks, 2nd of 6, 4 wins, 1 loss, Week 6');
});
