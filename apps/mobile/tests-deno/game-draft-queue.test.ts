/**
 * The draft queue editor's rules (3c). Normalised the way set_draft_queue does
 * (uppercase, trimmed, de-duplicated keeping the first, at most 50), reordered and
 * edited locally, and the refusals mapped to copy. Run: `deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { normalizeQueue, moveItem, removeItem, addSymbol, queueRefusalLine, QUEUE_MAX } from '../lib/game/draftQueue.ts';

Deno.test('the queue is normalised the way the server stores it: upper-case, trimmed, de-duplicated, first kept', () => {
  assertEquals(normalizeQueue([' nvda ', 'AAPL', 'nvda', 'msft']), ['NVDA', 'AAPL', 'MSFT']);
});

Deno.test('the queue holds at most 50 stocks', () => {
  assertEquals(QUEUE_MAX, 50);
  const many = Array.from({ length: 60 }, (_, i) => `S${i}`);
  assertEquals(normalizeQueue(many).length, 50);
});

Deno.test('move up and down reorder within the bounds; a move past an end does nothing', () => {
  assertEquals(moveItem(['A', 'B', 'C'], 1, -1), ['B', 'A', 'C']);
  assertEquals(moveItem(['A', 'B', 'C'], 1, 1), ['A', 'C', 'B']);
  assertEquals(moveItem(['A', 'B', 'C'], 0, -1), ['A', 'B', 'C']);
});

Deno.test('remove drops one stock; add appends a new one and ignores a duplicate or a full queue', () => {
  assertEquals(removeItem(['A', 'B'], 0), ['B']);
  assertEquals(addSymbol(['A'], 'b'), ['A', 'B']);
  assertEquals(addSymbol(['A'], 'a'), ['A']);
  assertEquals(addSymbol(Array.from({ length: 50 }, (_, i) => `S${i}`), 'NEW').length, 50);
});

Deno.test('a refused save says what failed; an unknown reason is one generic line', () => {
  assertEquals(queueRefusalLine('draft_completed'), 'The draft is already complete');
  assertEquals(queueRefusalLine('too_many'), `Your queue can hold up to ${QUEUE_MAX} stocks.`);
  assertEquals(queueRefusalLine('too_many'), 'Your queue can hold up to 50 stocks.');
  assertEquals(queueRefusalLine('unknown_symbols'), "Some of these stocks can't be queued. Remove them and try again.");
  for (const r of ['draft_completed', 'too_many', 'unknown_symbols', 'mystery']) assertEquals(queueRefusalLine(r).includes('[new copy'), false, r);
  assertEquals(queueRefusalLine('mystery'), "Your queue couldn't be saved.");
});
