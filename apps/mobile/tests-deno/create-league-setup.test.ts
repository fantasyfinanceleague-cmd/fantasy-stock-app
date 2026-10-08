/**
 * Create-league Season and Draft copy and bounds (3c). Pure, so it runs without
 * the app. Draft order writes leagues.draft_order_mode; the pick clock writes
 * leagues.pick_seconds (CHECK 30/45/60/75/90).
 * Run: `deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import {
  DEFAULT_PICK_SECONDS,
  DRAFT_ORDER_OPTIONS,
  IF_TIME_RUNS_OUT_COPY,
  PICK_SECONDS_OPTIONS,
  draftOrderCaption,
  pickClockLocked,
  pickSecondsCaption,
  playoffTeamsBounds,
  seasonCaption,
} from '../lib/game/createLeagueSetup.ts';

Deno.test('the two draft orders are the ones the database accepts', () => {
  assertEquals(DRAFT_ORDER_OPTIONS.map((o) => o.value), ['random', 'manual']);
});

Deno.test('draft order captions match the board', () => {
  assertEquals(draftOrderCaption('random'), 'Random: revealed 1 hour before the draft.');
  assertEquals(
    draftOrderCaption('manual'),
    'Manual: arrange it any time up to 1 hour before the draft. You can switch until then.',
  );
});

Deno.test('the auto-pick line says never a random pick, never a skip', () => {
  assertEquals(IF_TIME_RUNS_OUT_COPY.includes('Never a random pick, never a skip.'), true);
});

Deno.test('the Season caption counts playoff weeks from the playoff plan', () => {
  assertEquals(seasonCaption(11, 4), 'Season: 11 weeks + 2 playoff weeks');
  assertEquals(seasonCaption(11, 2), 'Season: 11 weeks + 1 playoff week');
  assertEquals(seasonCaption(11, 3), 'Season: 11 weeks + 2 playoff weeks');
});

Deno.test('playoff teams run from 2 up to the league size, equal included', () => {
  assertEquals(playoffTeamsBounds(8), { min: 2, max: 8 });
  assertEquals(playoffTeamsBounds(2), { min: 2, max: 2 });
});

Deno.test('the pick clock steps match the server CHECK (30..90 by 15)', () => {
  assertEquals(PICK_SECONDS_OPTIONS.map((o) => o.value), [30, 45, 60, 75, 90]);
  assertEquals(DEFAULT_PICK_SECONDS, 60);
});

Deno.test('the pick clock caption names the chosen time, with 60 as the default', () => {
  assertEquals(pickSecondsCaption(60), 'Time each manager has to make a pick. 60 seconds is the default.');
  assertEquals(pickSecondsCaption(30), 'Time each manager has to make a pick. 30 seconds.');
});

Deno.test('the pick clock freezes once the draft has started, as the trigger does', () => {
  assertEquals(pickClockLocked('not_started'), false);
  assertEquals(pickClockLocked('in_progress'), true);
  assertEquals(pickClockLocked('completed'), true);
});
