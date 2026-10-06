/**
 * The queue read, in the pre-draft lobby AND the live draft room (3c-2): a
 * failed read is never an empty queue, because set_draft_queue replaces the
 * whole list. The room used to read `(queueRes.data ?? [])`, so a failed read
 * seeded the editor with [] and the first save wiped the saved queue.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { DRAFT_ROOM_LOAD_FAILED, QUEUE_LOAD_FAILED, RENEWAL_LOAD_FAILED, nextQueueRead, queueRead, type QueueRead } from '../lib/game/draftQueueRead.ts';
// Read as text (raw-imports, no --allow-read) for the source guards below.
import roomSrc from '../lib/game/useDraftRoom.ts' with { type: 'text' };
import lobbySrc from '../lib/game/useDraftQueue.ts' with { type: 'text' };
import viewSrc from '../components/game/DraftRoom.tsx' with { type: 'text' };
import renewalSrc from '../components/game/LeagueRenewal.tsx' with { type: 'text' };

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

Deno.test('the load-failure lines: the house "X didn\'t load" form', () => {
  assertEquals(QUEUE_LOAD_FAILED, "Your queue didn't load.");
  assertEquals(DRAFT_ROOM_LOAD_FAILED, "The draft room didn't load.");
  assertEquals(RENEWAL_LOAD_FAILED, "The renewal didn't load.");
});

// ── Re-reads (the room re-reads on every pick; the lobby after a save) ─────

const ok = (syms: string[]) => ({ data: syms.map((symbol, i) => ({ symbol, position: i + 1 })), error: null });
const failed = { data: null, error: { message: 'timeout' } };
const LOADING: QueueRead = { status: 'loading' };

Deno.test('first read fails: an error (the editor is not shown), never []', () => {
  assertEquals(nextQueueRead(LOADING, failed), { status: 'error' });
});

Deno.test('first read succeeds: ready with the server list', () => {
  assertEquals(nextQueueRead(LOADING, ok(['NVDA', 'MSFT'])), { status: 'ready', queue: ['NVDA', 'MSFT'] });
});

Deno.test('a failed re-read keeps the last good list (edits survive a blip mid-draft)', () => {
  const prev: QueueRead = { status: 'ready', queue: ['NVDA', 'MSFT'] };
  assertEquals(nextQueueRead(prev, failed), prev);
});

Deno.test('a good re-read replaces the list, including with a real empty one', () => {
  assertEquals(nextQueueRead({ status: 'ready', queue: ['NVDA'] }, ok(['AAPL'])), { status: 'ready', queue: ['AAPL'] });
  assertEquals(nextQueueRead({ status: 'ready', queue: ['NVDA'] }, ok([])), { status: 'ready', queue: [] });
});

Deno.test('after an error, a good re-read (Try again) recovers', () => {
  assertEquals(nextQueueRead({ status: 'error' }, ok(['COST'])), { status: 'ready', queue: ['COST'] });
  assertEquals(nextQueueRead({ status: 'error' }, failed), { status: 'error' });
});

// ── Source guards: the hooks and the room go through the rule ──────────────

Deno.test('useDraftRoom reads the queue through nextQueueRead, never `.data ?? []`', () => {
  const room = roomSrc;
  assertEquals(room.includes('nextQueueRead(s.queue, queueRes)'), true);
  assertEquals(/queueRes\.data\s*\?\?\s*\[\]/.test(room), false);
});

Deno.test('useDraftQueue reads through nextQueueRead', () => {
  assertEquals(lobbySrc.includes('nextQueueRead(prev, res)'), true);
});

Deno.test('DraftRoom seeds QueueEditor only from a ready read', () => {
  const view = viewSrc;
  assertEquals(view.includes("room.queue.status === 'ready'"), true);
  assertEquals(view.includes('initial={room.queue.queue}'), true);
  assertEquals(view.includes('initial={room.queue}'), false);
});

Deno.test("the draft room has no \"Couldn't load\" or pull-to-refresh copy left", () => {
  assertEquals(viewSrc.includes("Couldn't load"), false);
  assertEquals(viewSrc.includes('Pull down to try again'), false);
  assertEquals(viewSrc.includes('{DRAFT_ROOM_LOAD_FAILED}'), true);
});

Deno.test('the renewal has no "Couldn\'t load" or pull-to-refresh copy left', () => {
  assertEquals(renewalSrc.includes("Couldn't load"), false);
  assertEquals(renewalSrc.includes('Pull down to try again'), false);
  assertEquals(renewalSrc.includes('{RENEWAL_LOAD_FAILED}'), true);
});
