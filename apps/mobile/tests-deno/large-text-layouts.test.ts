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
  const standings = SOURCES['components/game/StandingsTable.tsx'];
  assert(standings.includes('const stacked = isLargeText(fontScale);'));
  assert(standings.includes('{stacked ? <View style={styles.statsLine}>{stats}</View> : null}'));
  assert(standings.includes('const disc = scaledBadge(20, fontScale);'));
  const history = SOURCES['components/game/HistoryList.tsx'];
  assert(history.includes('const largeText = useLargeText();'));
  assert(history.includes('<View style={styles.statsLine}>'));
  const schedule = SOURCES['components/game/ScheduleList.tsx'];
  assert(schedule.includes('largeText ? styles.rowWrap : null'));
  assert(schedule.includes("resultLine: { width: '100%' },"));
  const matchup = SOURCES['app/(tabs)/matchup.tsx'];
  assert(matchup.includes('const largeText = useLargeText();'));
  assertEquals((matchup.match(/largeText \? styles\.lineupsStacked : null/g) ?? []).length, 2); // live and final
  assert(matchup.includes('lineup: { flex: 1, minWidth: 0, gap: space[2] },'));
  const sb = SOURCES['components/game/MatchScoreboard.tsx'];
  assert(sb.includes("namesRow: { flexDirection: 'row', flexWrap: 'wrap',"));
  assert(sb.includes("oppName: { flexShrink: 1, textAlign: 'right', marginLeft: 'auto' },"));
  // The hook reads the live scale (re-renders on a text-size change).
  assert(SOURCES['components/sp/useLargeText.ts'].includes('const { fontScale } = useWindowDimensions();'));
});
