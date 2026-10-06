/**
 * Create-league Season and Draft copy and bounds (3c). Pure, so it runs without
 * the app. The draft order is written to leagues.draft_order_mode. The pick clock
 * has no leagues column yet, so it is deliberately not here (see the report).
 * Run: `deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import {
  DRAFT_ORDER_OPTIONS,
  IF_TIME_RUNS_OUT_COPY,
  draftOrderCaption,
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
