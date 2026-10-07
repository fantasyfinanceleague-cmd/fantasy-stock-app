/**
 * The draft room's capture variants (3c-2, DEV-only seam): each variant's picks
 * and clock agree, "you" are seat 2 of the board's six, and the ending is a full
 * 6x6 draft. Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { draftRoomClock, draftRoomPicks, parseDraftRoomVariant } from '../lib/game/seamRoom.ts';
import { SEAM_ME, nextNominalTuesday, seamTableRows } from '../lib/game/seamTables.ts';
import { FIXTURE_USER_ID } from '../lib/shell/fixtureIds.ts';
import { managerAtPick } from '../lib/game/draftBoard.ts';

const ORDER = ['paolo', SEAM_ME, 'alessandro', 'francesco', 'gianluigi', 'andrea'];

Deno.test('the variant from the env: known names, else the on-clock default', () => {
  assertEquals(parseDraftRoomVariant('after_pick'), 'after_pick');
  assertEquals(parseDraftRoomVariant('complete'), 'complete');
  assertEquals(parseDraftRoomVariant(undefined), 'on_clock');
  assertEquals(parseDraftRoomVariant('nope'), 'on_clock');
});

Deno.test('"you" in the seam is the shell fixture\'s user (seat 2)', () => {
  assertEquals(SEAM_ME, FIXTURE_USER_ID);
  assertEquals(managerAtPick(2, ORDER), SEAM_ME);
  assertEquals(managerAtPick(11, ORDER), SEAM_ME); // round 2 reverses: seat 2 picks 11
  assertEquals([managerAtPick(12, ORDER), managerAtPick(13, ORDER)], ['paolo', 'paolo']); // "Pick 12, then 13"
});

Deno.test('on the clock: 10 picks, your pick 11 next; after the pick: 11, yours, manual or auto', () => {
  assertEquals(draftRoomPicks('on_clock').length, 10);
  const after = draftRoomPicks('after_pick');
  assertEquals(after.length, 11);
  assertEquals(after[10], { pick_number: 11, symbol: 'AAPL', pick_source: 'manual', entry_price: 211.42 });
  assertEquals(draftRoomPicks('after_auto_pick')[10].pick_source, 'auto_queue');
  assertEquals(draftRoomClock('after_pick', 0).picks_made, 11);
});

Deno.test('complete: all 36 picks, unique stocks, the clock stopped and the draft completed', () => {
  const all = draftRoomPicks('complete');
  assertEquals(all.map((p) => p.pick_number), Array.from({ length: 36 }, (_, i) => i + 1));
  const stocks = all.filter((p) => p.pick_source !== 'skip').map((p) => p.symbol);
  assertEquals(new Set(stocks).size, stocks.length);
  const mine = all.filter((p) => managerAtPick(p.pick_number, ORDER) === SEAM_ME).map((p) => p.symbol);
  assertEquals(mine, ['NVDA', 'AAPL', 'CRM', 'TSLA', 'COST', 'V']); // the board's DraftComplete roster
  const clock = draftRoomClock('complete', 0);
  assertEquals([clock.draft_status, clock.clock_running, clock.deadline_at], ['completed', false, null]);
});

Deno.test('the table seam follows the variant; Week 1 is a nominal Tuesday 14:30Z ahead', () => {
  assertEquals((seamTableRows(true, 'drafts', 'complete') as unknown[]).length, 36);
  assertEquals((seamTableRows(true, 'drafts') as unknown[]).length, 10);
  assertEquals(nextNominalTuesday(Date.parse('2026-10-07T03:00:00Z')), '2026-10-13T14:30:00.000Z'); // a Wednesday → next Tue
  assertEquals(nextNominalTuesday(Date.parse('2026-10-05T12:00:00Z')), '2026-10-06T14:30:00.000Z'); // a Monday → tomorrow
  assertEquals(nextNominalTuesday(Date.parse('2026-10-06T12:00:00Z')), '2026-10-13T14:30:00.000Z'); // a Tuesday → a week out
});
