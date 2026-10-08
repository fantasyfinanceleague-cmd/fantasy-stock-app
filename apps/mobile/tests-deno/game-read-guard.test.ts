/**
 * The read-cap guard (3c, All matchups). PostgREST caps a read at 1000 rows,
 * so a larger league would silently come back partial. Each league-wide read
 * asks for an exact count; if the rows received are fewer than the count, the
 * screen fails visibly and renders nothing partial. Run: `deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { checkRowsComplete } from '../lib/game/readGuard.ts';

Deno.test('all rows received for the exact count: complete', () => {
  assertEquals(checkRowsComplete(14, 14), { ok: true });
});

Deno.test('fewer rows than the exact count (a server cap): incomplete, with both numbers', () => {
  assertEquals(checkRowsComplete(1000, 1248), { ok: false, received: 1000, expected: 1248 });
});

Deno.test('no exact count from the server: never assumed complete', () => {
  assertEquals(checkRowsComplete(12, null), { ok: false, received: 12, expected: null });
});

Deno.test('more rows than counted (a race with a write): complete only if equal, so flagged', () => {
  assertEquals(checkRowsComplete(15, 14).ok, false);
});
