/**
 * Hermetic tests for lib/money/stockSearchOwnership.ts (3e UX audit, E-3,
 * the ownership ruling). Run with: cd apps/mobile/tests-deno && deno test .
 */
import { assertEquals } from 'jsr:@std/assert';
import { ownershipSuffix } from '../lib/money/stockSearchOwnership.ts';
import searchScreenSrc from '../components/money/StockSearchScreen.tsx' with { type: 'text' };

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

// C-2 (Design Lead gate): the status is its own line, never joined onto the
// company name where a long name would truncate it with it, and `mine`
// actually drives the colour. StockSearchScreen.tsx is a React Native
// component and isn't Deno-testable directly; this is a source guard, the
// same pattern used elsewhere in this suite (e.g. the C-1 quiet-wiring test).
Deno.test('wiring: the search row never rejoins the ownership text onto the company name', () => {
  assertEquals(searchScreenSrc.includes('${item.name} · ${suffix}'), false);
  assertEquals(searchScreenSrc.includes('subtitle2'), true);
});

Deno.test("wiring: the search row colours 'You own this' with the mine flag, not a fixed tone", () => {
  assertEquals(searchScreenSrc.includes('suffix.mine ? colors.youText'), true);
});
