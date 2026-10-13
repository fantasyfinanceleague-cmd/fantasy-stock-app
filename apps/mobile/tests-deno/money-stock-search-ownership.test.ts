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
  // W4 (Game Night row): the status is its own <Text> line, between the ticker and the company.
  assertEquals(searchScreenSrc.includes('testID="search-row-status"'), true);
});

Deno.test("wiring: the search row colours 'You own this' with the mine flag, not a fixed tone", () => {
  assertEquals(searchScreenSrc.includes('status.mine ? colors.youText'), true);
});

Deno.test('W4: a free stock when every slot is held reads "No free slot"; owners still win', () => {
  assertEquals(ownershipSuffix(null, false, true), { text: 'No free slot', mine: false });
  assertEquals(ownershipSuffix(null, false, false), { text: null, mine: false });
  assertEquals(ownershipSuffix({ kind: 'me' }, false, true), { text: 'You own this', mine: true });
  assertEquals(ownershipSuffix({ kind: 'other', name: 'Paolo M.', isBot: false }, false, true).text, 'Owned by Paolo M.');
  // A ledger conflict says nothing, roomless or not (never a guess).
  assertEquals(ownershipSuffix(null, true, true), { text: null, mine: false });
});
