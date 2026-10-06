/**
 * MatchScoreboard's display model (3c, the one scoreboard for Matchup, All
 * matchups and the playoffs). Same rules as Home's ThisWeekCard, so the two
 * cannot drift: zero is neutral (scoreTone), the tug comes from sp's
 * tugRatio/leaderOf, money goes through sp's formatMoney (U+2212 minus), and
 * the lead line + tiebreak come from gameCopy. Run: `deno test .`
 */
import { assertEquals, assert } from 'jsr:@std/assert';
import { buildMatchScoreboardModel } from '../lib/game/matchScoreboardModel.ts';

const me = { name: 'Roberto B.', gain: 213.6, pct: 1.76 };
const opp = { name: 'Gianluigi B.', gain: 90.44, pct: 0.74 };

Deno.test('scores: sp formatMoney with U+2212 for a loss, and a plus on a gain', () => {
  const m = buildMatchScoreboardModel({ week: 6, live: true, me, opp, endsLabel: 'Ends Fri 4:00 PM ET' });
  assertEquals(m.mineText, '+$213.60');
  assertEquals(m.oppText, '+$90.44');
  const loss = buildMatchScoreboardModel({ week: 6, live: true, me: { ...me, gain: -38.88 }, opp, endsLabel: 'x' });
  assertEquals(loss.mineText, '−$38.88');
});

Deno.test('zero is neutral on either side (scoreTone), a non-zero takes its side', () => {
  const m = buildMatchScoreboardModel({ week: 1, live: true, me: { ...me, gain: 0 }, opp: { ...opp, gain: 5 }, endsLabel: 'x' });
  assertEquals(m.mineTone, 'zero');
  assertEquals(m.oppTone, 'opp');
});

Deno.test('the lead is in dollars, with the tiebreak small beside it, from the shared helpers', () => {
  const m = buildMatchScoreboardModel({ week: 6, live: true, me, opp, endsLabel: 'x' });
  assertEquals(m.leader, 'you');
  assertEquals(m.leadLine, 'Roberto B. leads by $123.16'); // gameCopy.leadLine: the leader's own name
  assertEquals(m.tiebreakLine, 'Tiebreak +1.76% vs +0.74%');
});

Deno.test('the tug is sp\'s tugRatio over the two gains; dead level at zero', () => {
  const even = buildMatchScoreboardModel({ week: 1, live: true, me: { ...me, gain: 0 }, opp: { ...opp, gain: 0 }, endsLabel: 'x' });
  assertEquals(even.tugRatio, 0.5);
  assertEquals(even.leader, 'tie');
  assert(buildMatchScoreboardModel({ week: 6, live: true, me, opp, endsLabel: 'x' }).tugRatio > 0.5);
});

Deno.test('pre-season: no leader, no lead line, no tiebreak, the tug is level', () => {
  const m = buildMatchScoreboardModel({ week: 1, live: false, noLeader: true, me: { ...me, gain: 0 }, opp: { ...opp, gain: 0 }, endsLabel: 'x' });
  assertEquals(m.leadLine, null);
  assertEquals(m.tiebreakLine, null);
  assertEquals(m.tugRatio, 0.5);
});

Deno.test('no opponent (a bye): one side only, no lead and no opponent score', () => {
  const m = buildMatchScoreboardModel({ week: 4, live: true, me, opp: null, endsLabel: 'x' });
  assertEquals(m.oppText, null);
  assertEquals(m.leadLine, null);
});

Deno.test('VoiceOver: one sentence with the scores, the lead, and when it ends', () => {
  const m = buildMatchScoreboardModel({ week: 6, live: true, me, opp, endsLabel: 'Ends Friday 4 PM Eastern' });
  assertEquals(
    m.a11yLabel,
    'Week 6, live. You +$213.60, Gianluigi B. +$90.44. You lead by $123.16. Ends Friday 4 PM Eastern.',
  );
});

Deno.test('a final matchup says final, not live', () => {
  const m = buildMatchScoreboardModel({ week: 6, live: false, me, opp, endsLabel: 'Final' });
  assert(m.a11yLabel.startsWith('Week 6, final.'));
});

Deno.test('a final matchup has no percentages to show, so the tiebreak is omitted, never guessed', () => {
  const m = buildMatchScoreboardModel({ week: 6, live: false, me: { name: 'Roberto B.', gain: 351.77, pct: null }, opp: { name: 'Gianluigi B.', gain: -38.88, pct: null }, endsLabel: 'Final' });
  assertEquals(m.leadLine, 'Roberto B. leads by $390.65');
  assertEquals(m.tiebreakLine, null);
});
