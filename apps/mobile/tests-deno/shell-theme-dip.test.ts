/**
 * Hermetic tests for the Appearance dip decision (Phase 3b-1): the cover
 * only starts when the resolved theme will change, so it can never wait
 * forever on a change that doesn't happen.
 *
 *   cd apps/mobile/tests-deno && deno test .
 */
import { assertEquals } from 'jsr:@std/assert';
import { dipTarget } from '../lib/shell/themeDip.ts';

Deno.test('dip: Light → Dark and Dark → Light dip into the new theme', () => {
  assertEquals(dipTarget('light', 'dark', 'light', null, false), 'dark');
  assertEquals(dipTarget('dark', 'light', 'dark', null, false), 'light');
});

Deno.test('dip: System resolves through the phone; no dip when that is already on screen', () => {
  assertEquals(dipTarget('light', 'system', 'light', null, false), null);
  assertEquals(dipTarget('light', 'system', 'dark', null, false), 'dark');
  assertEquals(dipTarget('dark', 'system', null, null, false), 'light'); // unknown scheme → Light
});

Deno.test('dip: choosing what is already shown never dips', () => {
  assertEquals(dipTarget('dark', 'dark', 'light', null, false), null);
  assertEquals(dipTarget('light', 'light', 'dark', null, false), null);
});

Deno.test('dip: a forced theme outside dev means nothing changes on screen', () => {
  assertEquals(dipTarget('light', 'dark', 'dark', 'light', false), null);
  assertEquals(dipTarget('light', 'dark', 'dark', 'light', true), 'dark'); // dev ignores the force
});
