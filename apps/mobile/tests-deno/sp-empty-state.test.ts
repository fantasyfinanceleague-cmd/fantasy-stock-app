/**
 * Hermetic tests for sp/EmptyState's layout rule (Design Lead, Phase 3b-1):
 * with actions it is carded; informational ones stay flat.
 *
 *   cd apps/mobile/tests-deno && deno test .
 */
import { assertEquals } from 'jsr:@std/assert';
import { isEmptyStateCarded } from '../components/sp/logic/emptyState.ts';

Deno.test('empty state: with an action it is carded', () => {
  assertEquals(isEmptyStateCarded('Create a league', true), true);
});

Deno.test('empty state: informational (no action) stays flat', () => {
  assertEquals(isEmptyStateCarded(undefined, false), false);
  assertEquals(isEmptyStateCarded(undefined, true), false); // a handler with no label renders no button
  assertEquals(isEmptyStateCarded('Create a league', false), false); // a label with no handler renders no button
});
