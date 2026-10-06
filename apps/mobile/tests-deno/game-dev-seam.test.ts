/**
 * The capture seam is inert outside dev (3c): it is on only when the build is a dev
 * build AND the flag is exactly '1'. Anything else (a production build, a dev build
 * without the flag, or a flag with another value) leaves the real calls in place.
 * Run: `deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { seamActive } from '../lib/game/devSeamGate.ts';

Deno.test('the seam is on only in a dev build with the flag set to 1', () => {
  assertEquals(seamActive(true, '1'), true);
});

Deno.test('a production build never turns the seam on, even with the flag', () => {
  assertEquals(seamActive(false, '1'), false);
});

Deno.test('a dev build without the flag, or with any other flag value, is inert', () => {
  assertEquals(seamActive(true, undefined), false);
  assertEquals(seamActive(true, ''), false);
  assertEquals(seamActive(true, 'true'), false);
  assertEquals(seamActive(true, '0'), false);
});
