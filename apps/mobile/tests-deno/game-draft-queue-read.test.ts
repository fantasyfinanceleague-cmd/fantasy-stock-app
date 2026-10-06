/**
 * The pre-draft queue read (3c-2): a failed read is never an empty queue,
 * because set_draft_queue replaces the whole list.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { QUEUE_LOAD_FAILED, queueRead } from '../lib/game/draftQueueRead.ts';

Deno.test('rows become the queue, in position order', () => {
  assertEquals(
    queueRead({ data: [{ symbol: 'CRM', position: 2 }, { symbol: 'AAPL', position: 1 }, { symbol: 'COST', position: 3 }], error: null }),
    { status: 'ready', queue: ['AAPL', 'CRM', 'COST'] },
  );
});

Deno.test('no rows is a real, empty queue', () => {
  assertEquals(queueRead({ data: [], error: null }), { status: 'ready', queue: [] });
});

Deno.test('a resolved query error is an error, not an empty queue', () => {
  assertEquals(queueRead({ data: null, error: { message: 'permission denied' } }), { status: 'error' });
  assertEquals(queueRead({ data: [{ symbol: 'AAPL', position: 1 }], error: { message: 'x' } }), { status: 'error' });
});

Deno.test('null data with no error is still not trusted as empty', () => {
  assertEquals(queueRead({ data: null, error: null }), { status: 'error' });
});

Deno.test('the load-failure line', () => {
  assertEquals(QUEUE_LOAD_FAILED, "Couldn't load your queue.");
});
