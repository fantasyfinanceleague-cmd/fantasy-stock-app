/**
 * League › Schedule (3c, D4 = keep, Giorgio 2026-10-05). Every regular-season
 * week: the result with your score for a posted week, "● Live" for this week
 * until it posts, "Next" for the week after, a bye as a neutral row (never
 * W or L), and the playoffs as a line. The order is the week order. Run: `deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { buildSchedule } from '../lib/game/schedule.ts';

const names = [
  { user_id: 'roberto', display_name: 'Roberto B.' },
  { user_id: 'paolo', display_name: 'Paolo M.' },
  { user_id: 'gianluigi', display_name: 'Gianluigi B.' },
];

// The rows get_home_league returns: gains, not the winner.
const m = (week: number, t1: string, t2: string | null, g1: number | null, g2: number | null, playoff = false) =>
  ({ week_number: week, team1_user_id: t1, team2_user_id: t2, team1_gain: g1, team2_gain: g2, is_playoff: playoff });

Deno.test('a posted week shows the result and your score, from your side', () => {
  const rows = buildSchedule({
    myUserId: 'roberto', currentWeek: 3, numWeeks: 4, names,
    matchups: [m(1, 'roberto', 'paolo', 213.6, 90.44), m(2, 'gianluigi', 'roberto', 10, -4)],
  });
  assertEquals(rows[0], { week: 1, opponent: 'Paolo M.', bye: false, state: 'past', won: true, tie: false, gain: 213.6, oppGain: 90.44 });
  // From your side: you were team2 in week 2, so your gain is team2_gain (-4), and you lost to 10.
  assertEquals(rows[1].won, false);
  assertEquals(rows[1].gain, -4);
  assertEquals(rows[1].oppGain, 10);
});

Deno.test('equal dollars show no W or L: the percent tiebreak decides, and this read does not carry it', () => {
  const rows = buildSchedule({ myUserId: 'roberto', currentWeek: 2, numWeeks: 2, names, matchups: [m(1, 'roberto', 'paolo', 5, 5)] });
  assertEquals(rows[0].won, false);
  assertEquals(rows[0].tie, false);
});

Deno.test('this week is LIVE until it posts; the week after is NEXT; later weeks are future', () => {
  const rows = buildSchedule({
    myUserId: 'roberto', currentWeek: 2, numWeeks: 4, names,
    matchups: [m(1, 'roberto', 'paolo', 1, 0.5), m(2, 'roberto', 'gianluigi', null, null), m(3, 'roberto', 'paolo', null, null)],
  });
  assertEquals(rows.map((r) => r.state), ['past', 'live', 'next', 'future']);
  assertEquals(rows[3].opponent, null); // week 4 has no matchup row yet
});

Deno.test('a bye is a neutral row: no result, no W or L', () => {
  const rows = buildSchedule({ myUserId: 'roberto', currentWeek: 2, numWeeks: 2, names, matchups: [m(1, 'roberto', null, 7, null)] });
  assertEquals(rows[0].bye, true);
  assertEquals(rows[0].won, false);
  assertEquals(rows[0].gain, 7);
  assertEquals(rows[0].opponent, null);
});

Deno.test('playoff rows are not in the regular-season list', () => {
  const rows = buildSchedule({ myUserId: 'roberto', currentWeek: 1, numWeeks: 1, names, matchups: [m(2, 'roberto', 'paolo', 1, 1, true)] });
  assertEquals(rows.map((r) => r.week), [1]);
});

Deno.test('an unknown opponent name is never invented', () => {
  const rows = buildSchedule({ myUserId: 'roberto', currentWeek: 2, numWeeks: 2, names: [], matchups: [m(1, 'roberto', 'paolo', 1, 1)] });
  assertEquals(rows[0].opponent, '');
});
