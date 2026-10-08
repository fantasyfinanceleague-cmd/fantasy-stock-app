/**
 * Draft lobby rules (3c): your snake picks, the uneven-bye split, and the start
 * blockers mapped to copy. Checked against the board's own numbers (Serie A
 * Traders: seat 4 of 8 picks 4, 13, 20, 29, 36, 45; Office League 7/10 gives
 * 1–2 byes). Run: `deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { mySnakePicks, byeSplit, startBlockerCopy } from '../lib/game/draftLobby.ts';

Deno.test('snake picks: seat 4 of 8 over 6 rounds is 4, 13, 20, 29, 36, 45 (the board)', () => {
  assertEquals(mySnakePicks(4, 8, 6), [4, 13, 20, 29, 36, 45]);
});

Deno.test('snake picks: the first seat picks first and last in the reversed rounds', () => {
  assertEquals(mySnakePicks(1, 4, 3), [1, 8, 9]);
  assertEquals(mySnakePicks(4, 4, 3), [4, 5, 12]);
});

Deno.test('byes: odd managers that do not divide the weeks evenly get a 1-2 or 2-3 split', () => {
  assertEquals(byeSplit(7, 10), { lo: 1, hi: 2 });
  assertEquals(byeSplit(7, 13), { lo: 1, hi: 2 });
  assertEquals(byeSplit(5, 14), { lo: 2, hi: 3 });
});

Deno.test('byes: no notice for an even count, or when the weeks divide evenly', () => {
  assertEquals(byeSplit(6, 10), null);
  assertEquals(byeSplit(7, 14), null);
});

Deno.test('start blockers map to the existing copy, with the counts filled in', () => {
  assertEquals(
    startBlockerCopy({ code: 'not_enough_members', have: 3, need: 4 }),
    'A draft needs at least 4 managers. 3 are in, so invite 1 more to start.',
  );
  assertEquals(
    startBlockerCopy({ code: 'playoff_teams_exceeds_members', playoffTeams: 7, members: 6 }),
    '7 playoff teams, but 6 managers are in. Lower the playoff teams to start.',
  );
});

Deno.test('an unknown blocker is never shown as a made-up reason: one honest generic line', () => {
  assertEquals(startBlockerCopy({ code: 'some_future_code' }), "The draft can't start yet.");
});

import { byeNoticeCopy } from '../lib/game/draftLobby.ts';

Deno.test('the bye notice is the board\'s own words, with the split named', () => {
  assertEquals(byeNoticeCopy(7, 10), "With 7 managers and 10 weeks, byes won't be even: some get 2, some get 1.");
  assertEquals(byeNoticeCopy(5, 14), "With 5 managers and 14 weeks, byes won't be even: some get 3, some get 2.");
});

Deno.test('no bye notice when the weeks divide evenly or the count is even', () => {
  assertEquals(byeNoticeCopy(6, 10), null);
  assertEquals(byeNoticeCopy(7, 14), null);
});

import { playoffStepperBounds, stepPlayoffTeams } from '../lib/game/draftLobby.ts';

Deno.test('the playoff stepper is 2 up to one per manager (the board: "Up to 6, one per manager.")', () => {
  assertEquals(playoffStepperBounds(6), { min: 2, max: 6 });
  assertEquals(playoffStepperBounds(1), { min: 2, max: 2 });
});

Deno.test('a step stays inside the bounds: it cannot go below 2 or above the manager count', () => {
  assertEquals(stepPlayoffTeams(7, -1, 6), 6); // 7 is over the 6 managers: a step down lands on 6
  assertEquals(stepPlayoffTeams(6, 1, 6), 6); // no further up than one per manager
  assertEquals(stepPlayoffTeams(2, -1, 6), 2); // no further down than 2
  assertEquals(stepPlayoffTeams(4, 1, 6), 5);
});
