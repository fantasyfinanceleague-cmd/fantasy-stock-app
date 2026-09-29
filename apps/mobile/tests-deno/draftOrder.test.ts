/**
 * Hermetic unit tests for lib/draftOrder.ts. Run:
 *
 *   deno test apps/mobile/tests-deno/
 */
import { assertEquals } from 'jsr:@std/assert';
import { myPosition, parseDraftOrder, snakePickNumbers } from '../lib/draftOrder.ts';
import { currentTurn } from '../../../supabase/functions/_shared/draft-validation.ts';

const base = {
  ok: true, mode: 'random', state: 'open', draft_date: '2026-10-10T19:00:00Z', finalize_at: '2026-10-10T18:00:00Z',
  revealed: false, revealed_at: null, finalized: false, finalized_at: null, locked: false, locked_at: null,
  order: null, num_rounds: 6, member_count: 4, min_members: 4, waiting_for_members: false,
  is_commissioner: false, can_edit_order: false, can_change_mode: false, server_now: '2026-10-10T12:00:00Z',
};

Deno.test('parseDraftOrder: random before the reveal -> no order, reveal time kept', () => {
  const p = parseDraftOrder(base)!;
  assertEquals([p.mode, p.revealed, p.order, p.finalizeAt], ['random', false, null, '2026-10-10T18:00:00Z']);
});

Deno.test('parseDraftOrder: revealed order sorted by position, bots included', () => {
  const p = parseDraftOrder({
    ...base, state: 'finalized', revealed: true, finalized: true,
    order: [{ position: 2, user_id: 'bot-1' }, { position: 1, user_id: 'u-b' }, { position: 3, user_id: 'u-a' }],
  })!;
  assertEquals(p.order, ['u-b', 'bot-1', 'u-a']);
  assertEquals([p.revealed, p.finalized, p.locked], [true, true, false]);
  assertEquals(myPosition(p, 'u-a'), 3);
  assertEquals(myPosition(p, 'nobody'), null);
});

Deno.test('parseDraftOrder: a refusal or malformed payload is null, never a guessed order', () => {
  assertEquals(parseDraftOrder({ ok: false, reason: 'not_a_member' }), null);
  assertEquals(parseDraftOrder(null), null);
  assertEquals(parseDraftOrder({ ...base, mode: 'commissioner_first' }), null);
  assertEquals(parseDraftOrder({ ...base, state: 'weird' }), null);
});

Deno.test('snakePickNumbers: 4th of 10 over 3 rounds -> 4, 17, 24', () => {
  assertEquals(snakePickNumbers(4, 10, 3), [4, 17, 24]);
  assertEquals(snakePickNumbers(1, 4, 4), [1, 8, 9, 16]);
  assertEquals(snakePickNumbers(4, 4, 2), [4, 5]); // the turn: last picks twice in a row
  assertEquals(snakePickNumbers(0, 4, 2), []);
  assertEquals(snakePickNumbers(5, 4, 2), []);
});

Deno.test('snakePickNumbers agrees with the SERVER turn math for every seat', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];
  const rounds = 6;
  for (let pos = 1; pos <= order.length; pos++) {
    const mine = snakePickNumbers(pos, order.length, rounds);
    const server: number[] = [];
    for (let t = 0; t < order.length * rounds; t++) {
      if (currentTurn(t, order, rounds)?.pickerId === order[pos - 1]) server.push(t + 1);
    }
    assertEquals(mine, server, `seat ${pos}`);
  }
});
