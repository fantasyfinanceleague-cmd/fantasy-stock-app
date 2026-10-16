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

// W4 DL gate: "Not in this league's list" — the row isn't a button; only the disc and the price
// dim, the reason stays in text2 at FULL opacity (dimmed, it read 2.44:1 / 2.04:1).
Deno.test('wiring: a not-in-list row dims only its disc and price, never its reason', () => {
  const row = searchScreenSrc.slice(searchScreenSrc.indexOf('function SearchRow'));
  assertEquals(row.includes('styles.disc, off ? styles.dim : null'), true);
  assertEquals(row.includes('off ? styles.dim : null]}>{keepMoney(formatMoney(item.price))}'), true);
  // The whole-row opacity is gone, and the status Text carries no dim.
  assertEquals(row.includes('styles.row, styles.disabled'), false);
  const status = row.slice(row.indexOf('testID="search-row-status"'), row.indexOf('</Text>', row.indexOf('testID="search-row-status"')));
  assertEquals(status.includes('dim'), false);
  // Still not a button: a plain View with the disabled state, and no chevron.
  assertEquals(row.includes("accessibilityState={{ disabled: true }} testID={`search-row-off-"), true);
  assertEquals(row.includes('{off ? <View style={styles.chevronSpace} /> : <Icon name="chevronRight"'), true);
});
