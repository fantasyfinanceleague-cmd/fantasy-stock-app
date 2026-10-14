/**
 * Large text (§9: the type scales with the system text size). The capture pass at XL
 * (accessibility-extra-large, 2026-10-08) found the game screens' one-line rows and
 * side-by-side columns breaking: League › Standings and History names wrapping a
 * letter per line, Schedule's results clipped off the card, the standings' medal
 * numeral spilling out of its 20 pt disc, the Matchup lineups running into each other,
 * and the opponent's name going off the scoreboard. From the largest standard size up
 * (LARGE_TEXT_SCALE) those layouts stack.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { LARGE_TEXT_SCALE, isLargeText, scaledBadge } from '../components/sp/logic/largeText.ts';
import { SOURCES } from './sourceManifest.generated.ts';

Deno.test('large text starts at the largest standard size; the medal disc grows with its numeral', () => {
  assertEquals(LARGE_TEXT_SCALE, 1.3);
  for (const s of [0.82, 1, 1.12, 1.24]) assertEquals(isLargeText(s), false, String(s));
  for (const s of [1.35, 1.65, 2.35, 3.12]) assertEquals(isLargeText(s), true, String(s));
  assertEquals(isLargeText(Number.NaN), false);
  assertEquals(scaledBadge(20, 1), 20);
  assertEquals(scaledBadge(20, 1.35), 27);
  assertEquals(scaledBadge(20, 3.12), 32); // capped at 1.6x
});

Deno.test('each screen that broke stacks at large text (source guards)', () => {
  // W4: Standings and History decide ONE shape per list (leagueView managerListStacks: the
  // large sizes, or a ≥ $1M gain leaving the name no room) and the ManagerRow stacks on it.
  const standings = SOURCES['components/game/StandingsTable.tsx'];
  assert(standings.includes('const stacked = managerListStacks({ rowWidth, fontScale, move: showMove, rows: figures, leading: rankWidth });'));
  assert(standings.includes('stacked={layout.stacked}'));
  // The medal disc grows with its numeral; one disc for Standings and History (MedalDisc, GS-8).
  assert(standings.includes('const disc = useMedalDiscSize();'));
  assert(SOURCES['components/game/MedalDisc.tsx'].includes('return scaledBadge(20, fontScale);'));
  const history = SOURCES['components/game/HistoryList.tsx'];
  assert(history.includes('const layout = useStandingsLayout(figures, false, table.medals);'));
  assert(history.includes('stacked={layout.stacked}'));
  const row = SOURCES['components/sp/gn/ManagerRow.tsx'];
  assert(row.includes('const leagueStacked = !excerpt && !!stackedProp;'));
  const schedule = SOURCES['components/game/ScheduleList.tsx'];
  assert(schedule.includes('largeText ? styles.rowWrap : null'));
  assert(schedule.includes("resultLine: { width: '100%' },"));
  // W4: Matchup's roster stays mirrored (it's the head-to-head); at large text each HALF
  // stacks the stock over its week, so a long number never squeezes the ticker out.
  const roster = SOURCES['components/sp/gn/RosterRow.tsx'];
  assert(roster.includes('const stacked = useLargeText();'));
  assert(roster.includes('const layout = stacked ? styles.contentStacked : styles.content;'));
  // The scoreboard digits shrink to fit once given a bounded width (ThisWeekCard's safety
  // net for an unusual value; moved here from the retired MatchScoreboard's layout test).
  assert(SOURCES['components/sp/game/ScoreDigits.tsx'].includes('adjustsFontSizeToFit'));
  const bracket = SOURCES['components/game/BracketView.tsx'];
  assert(bracket.includes('name: { flexShrink: 1, minWidth: 0 },'));
  assert(bracket.includes("end: { marginLeft: 'auto', flexShrink: 0 },"));
  assert(SOURCES['components/game/DraftComplete.tsx'].includes("sectionHead: { flexDirection: 'row', flexWrap: 'wrap',"));
  // The hook reads the live scale (re-renders on a text-size change).
  assert(SOURCES['components/sp/useLargeText.ts'].includes('const { fontScale } = useWindowDimensions();'));
});
