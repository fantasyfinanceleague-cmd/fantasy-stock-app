/**
 * The draft's designed ending (3c-2, U-10; board #game "Draft complete", 3edfaf6):
 * the board's copy, Week 1's real open through the market calendar (Home's B3
 * rule), your Week 1 opponent, the roster at draft prices, and the finalize
 * hand-off that waits for the server instead of skipping the ending.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import {
  DRAFT_COMPLETE_TAG, FINALIZE_GRACE_MS, SEE_WEEK_ONE_MATCHUP, SEE_WEEK_ONE_MATCHUPS, YOUR_TEAM_IS_SET, matchupSegmentFromParam, weekOneIsBye,
  draftPriceLabel, myRosterPicks, rosterPickCaption, shouldHandOffToFinalize, weekOneFor, weekOneLine, weekOneRealStart,
} from '../lib/game/draftComplete.ts';
import { indexPicks } from '../lib/game/draftBoard.ts';
import { standardWeekSessions } from '../lib/time/marketWeek.ts';
import { SOURCES } from './sourceManifest.generated.ts';

Deno.test('the board\'s copy, verbatim', () => {
  assertEquals(DRAFT_COMPLETE_TAG, 'Draft complete');
  assertEquals(YOUR_TEAM_IS_SET, 'Your team is set');
  assertEquals(SEE_WEEK_ONE_MATCHUP, 'See your Week 1 matchup');
  assertEquals(SEE_WEEK_ONE_MATCHUPS, "See Week 1's matchups"); // a bye (ruled)
});

// finalize writes schedule.ts's nominal Tuesday 14:30Z; Week 1 really opens Monday 9:30 AM ET.
const NOMINAL = '2026-10-06T14:30:00.000Z'; // Tue Oct 6 2026
const CAL = standardWeekSessions(NOMINAL);

Deno.test('"Week 1 starts Mon 9:30 AM ET. You play Gianluigi B." from the nominal row, resolved', () => {
  const real = weekOneRealStart(NOMINAL, CAL);
  assertEquals(real, '2026-10-05T13:30:00.000Z');
  assertEquals(weekOneLine(real, 'Gianluigi B.'), 'Week 1 starts Mon 9:30 AM ET. You play Gianluigi B.');
});

Deno.test('a holiday Monday: the week opens Tuesday, and the line says so', () => {
  const cal = CAL.filter((s) => s.sessionDate !== '2026-10-05');
  assertEquals(weekOneLine(weekOneRealStart(NOMINAL, cal), 'Gianluigi B.'), 'Week 1 starts Tue 9:30 AM ET. You play Gianluigi B.');
});

Deno.test('never the known-wrong nominal time: no calendar coverage, or no row, is "starts soon"', () => {
  assertEquals(weekOneRealStart(NOMINAL, []), null);
  assertEquals(weekOneRealStart(null, CAL), null);
  assertEquals(weekOneLine(null, 'Gianluigi B.'), 'Week 1 starts soon. You play Gianluigi B.');
});

Deno.test('a Week 1 bye says so (ruled): "You have a bye that week."', () => {
  const real = weekOneRealStart(NOMINAL, CAL);
  assertEquals(weekOneLine(real, null, true), 'Week 1 starts Mon 9:30 AM ET. You have a bye that week.');
  assertEquals(weekOneLine(null, null, true), 'Week 1 starts soon. You have a bye that week.');
});

Deno.test('a bye is a READ row with no other side; no row or not read yet is unknown, not a bye', () => {
  assertEquals(weekOneIsBye({ opponentId: null }), true);
  assertEquals(weekOneIsBye({ opponentId: 'a' }), false);
  assertEquals(weekOneIsBye(null), false);
});

Deno.test('the Matchup tab\'s segment from the route: only "all" or "mine", else nothing', () => {
  assertEquals(matchupSegmentFromParam('all'), 'all');
  assertEquals(matchupSegmentFromParam(['all']), 'all');
  assertEquals(matchupSegmentFromParam('mine'), 'mine');
  assertEquals(matchupSegmentFromParam(undefined), null);
  assertEquals(matchupSegmentFromParam('nope'), null);
});

Deno.test('not known yet (no row read): the sentence ends at the time', () => {
  const real = weekOneRealStart(NOMINAL, CAL);
  assertEquals(weekOneLine(real, null), 'Week 1 starts Mon 9:30 AM ET.');
  assertEquals(weekOneLine(real, '  '), 'Week 1 starts Mon 9:30 AM ET.');
});

Deno.test('your Week 1 game, either side; a bye has no opponent; not in the schedule is null', () => {
  const rows = [
    { team1_user_id: 'a', team2_user_id: 'me', week_start: NOMINAL },
    { team1_user_id: 'c', team2_user_id: 'd', week_start: NOMINAL },
    { team1_user_id: 'e', team2_user_id: null, week_start: NOMINAL },
  ];
  assertEquals(weekOneFor(rows, 'me'), { opponentId: 'a', weekStart: NOMINAL });
  assertEquals(weekOneFor(rows, 'c'), { opponentId: 'd', weekStart: NOMINAL });
  assertEquals(weekOneFor(rows, 'e'), { opponentId: null, weekStart: NOMINAL });
  assertEquals(weekOneFor(rows, 'zz'), null);
  assertEquals(weekOneFor([], 'me'), null);
});

Deno.test('the roster: your picks in order, round and pick, at draft prices; a SKIP is not a stock', () => {
  const picks = indexPicks([
    { pick_number: 2, symbol: 'nvda', pick_source: 'manual', entry_price: '318.37' },
    { pick_number: 7, symbol: 'AAPL', pick_source: 'auto_queue', entry_price: 211.4 },
    { pick_number: 10, symbol: 'SKIP', pick_source: 'skip', entry_price: null },
    { pick_number: 1, symbol: 'MSFT', pick_source: 'manual', entry_price: 421 },
  ]);
  const order = ['a', 'me', 'c', 'd'];
  assertEquals(myRosterPicks(picks, order, 'me'), [
    { symbol: 'NVDA', round: 1, pick: 2, price: 318.37 },
    { symbol: 'AAPL', round: 2, pick: 7, price: 211.4 },
  ]);
  assertEquals(myRosterPicks(picks, [], 'me'), []);
  assertEquals(rosterPickCaption({ round: 2, pick: 7 }), 'Round 2 · pick 7');
});

Deno.test('a draft price is real or absent, never "$0"', () => {
  assertEquals(draftPriceLabel(318.37), '$318.37');
  assertEquals(draftPriceLabel(211.4), '$211.40');
  assertEquals(draftPriceLabel(1200), '$1,200');
  for (const p of [null, 0, -1, Number.NaN]) assertEquals(draftPriceLabel(p), null, String(p));
});

Deno.test('the finalize hand-off waits out the grace window, and never fires without a start', () => {
  assertEquals(shouldHandOffToFinalize(null, 10_000_000), false);
  assertEquals(shouldHandOffToFinalize(1000, 1000), false); // the last pick's realtime read: wait
  assertEquals(shouldHandOffToFinalize(1000, 1000 + FINALIZE_GRACE_MS - 1), false);
  assertEquals(shouldHandOffToFinalize(1000, 1000 + FINALIZE_GRACE_MS), true);
});

Deno.test('the room: the ending replaces the room once every pick is in; the hand-off waits and re-reads (source guard)', () => {
  const room = SOURCES['components/game/DraftRoom.tsx'];
  assertEquals(room.includes('if (draftDone) {\n    return (\n      <DraftComplete'), true);
  assertEquals(room.includes('const stuck = draftDone && room.draftStatus === \'in_progress\';'), true);
  assertEquals(room.includes('setTimeout(refresh, Math.max(0, fullSince + FINALIZE_GRACE_MS - Date.now()))'), true);
  assertEquals(room.includes('if (stuck && !handedOff.current && shouldHandOffToFinalize(fullSince, Date.now())) {'), true);
  assertEquals(room.includes("router.push('/(tabs)/draft');"), true); // the finalize heal itself is unchanged
  assertEquals(room.includes('const weekOne = useWeekOne(leagueId, myUserId, draftDone && finished);'), true);
});

Deno.test('the ending: "Finishing the draft…" and no button until the server has finished (source guard)', () => {
  const view = SOURCES['components/game/DraftComplete.tsx'];
  assertEquals(view.includes('{finished ? weekLine : FINISHING_THE_DRAFT}'), true);
  assertEquals(view.includes('{finished ? <Button label={bye ? SEE_WEEK_ONE_MATCHUPS : SEE_WEEK_ONE_MATCHUP} onPress={onSeeMatchup} fullWidth /> : null}'), true);
});

Deno.test('a bye opens All matchups: the room passes it, the League tab routes it, the Matchup tab applies it (source guard)', () => {
  const room = SOURCES['components/game/DraftRoom.tsx'];
  assertEquals(room.includes('onSeeMatchup={() => onSeeMatchup?.({ all: weekOneIsBye(weekOne) })}'), true);
  assertEquals(SOURCES['app/(tabs)/league.tsx'].includes("router.push(all ? { pathname: '/(tabs)/matchup', params: { segment: 'all' } } : '/(tabs)/matchup');"), true);
  const tab = SOURCES['app/(tabs)/matchup.tsx'];
  assertEquals(tab.includes('const s = matchupSegmentFromParam(segmentParam);'), true);
  assertEquals(tab.includes('}, [segmentParam]);'), true); // applied on change: the tab stays mounted
});

Deno.test('the League tab keeps the ending after the phase moves on, until the matchup button (source guard)', () => {
  const tab = SOURCES['app/(tabs)/league.tsx'];
  assertEquals(tab.includes('if ((drafting || endingFor === activeLeagueId) && activeLeagueId && activeLeague) {'), true);
  assertEquals(tab.indexOf('endingFor === activeLeagueId') < tab.indexOf('if (inSeason) {'), true);
  assertEquals(tab.includes(": '/(tabs)/matchup');"), true); // the button goes to the Matchup tab
});

Deno.test('Week 1 is read from matchups through the seam (source guard)', () => {
  const hook = SOURCES['lib/game/useWeekOne.ts'];
  // (Matched in pieces: a whole `.from(...)` literal here would read as a call site to gen-architecture.)
  assertEquals(hook.includes("'matchups'"), true);
  assertEquals(hook.includes(".select('team1_user_id, team2_user_id, week_start').eq('league_id', leagueId).eq('week_number', 1)"), true);
  assertEquals(hook.includes('if (cancelled || res.error) return;'), true);
});
