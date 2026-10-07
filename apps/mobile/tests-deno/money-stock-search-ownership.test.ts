/**
 * Hermetic tests for lib/money/stockSearchOwnership.ts (3e UX audit, E-3,
 * the ownership ruling). Run with: cd apps/mobile/tests-deno && deno test .
 */
import { assertEquals } from 'jsr:@std/assert';
import { ownershipSuffix } from '../lib/money/stockSearchOwnership.ts';

Deno.test('(a) mine: "You own this", mine is true', () => {
  assertEquals(ownershipSuffix({ kind: 'me' }, false), { text: 'You own this', mine: true });
});

Deno.test('(b) another manager, named: "Owned by {name}"', () => {
  assertEquals(ownershipSuffix({ kind: 'other', name: 'Paolo M.', isBot: false }, false), { text: 'Owned by Paolo M.', mine: false });
});

Deno.test('(b) another manager, name unresolved: falls back to "another manager"', () => {
  assertEquals(ownershipSuffix({ kind: 'other', name: null, isBot: false }, false), { text: 'Owned by another manager', mine: false });
});

Deno.test('free (no owner): no suffix', () => {
  assertEquals(ownershipSuffix(null, false), { text: null, mine: false });
});

Deno.test('a ledger conflict (more than one owner): no suffix, never a guess', () => {
  assertEquals(ownershipSuffix({ kind: 'other', name: 'Paolo M.', isBot: false }, true), { text: null, mine: false });
  assertEquals(ownershipSuffix({ kind: 'me' }, true), { text: null, mine: false });
});
