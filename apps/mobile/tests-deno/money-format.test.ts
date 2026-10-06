/**
 * Hermetic tests for lib/money/formatShares.ts, lib/money/cleanCompanyName.ts
 * and lib/money/buyQuantity.ts (Phase 3e). Run with:
 *
 *   cd apps/mobile/tests-deno && deno test .
 */
import { assertEquals } from 'jsr:@std/assert';
import { cleanCompanyName } from '../lib/money/cleanCompanyName.ts';
import { formatShares } from '../lib/money/formatShares.ts';
import { buyQuantity, fixedNotionalShares } from '../lib/money/buyQuantity.ts';

Deno.test('cleanCompanyName strips feed share-class suffixes', () => {
  assertEquals(cleanCompanyName('Apple Inc. - Common Stock'), 'Apple');
  assertEquals(cleanCompanyName('Alphabet Inc. - Class A'), 'Alphabet');
  assertEquals(cleanCompanyName('Alphabet, Inc. - Class A'), 'Alphabet');
  assertEquals(cleanCompanyName('Berkshire Hathaway Inc. - Class B Common Stock'), 'Berkshire Hathaway');
  assertEquals(cleanCompanyName('NVIDIA Corporation - Common Stock'), 'NVIDIA');
});

Deno.test('cleanCompanyName strips trailing legal suffixes without eating real words', () => {
  assertEquals(cleanCompanyName('Tesla, Inc.'), 'Tesla');
  assertEquals(cleanCompanyName('JPMorgan Chase & Co.'), 'JPMorgan Chase');
  assertEquals(cleanCompanyName('Walt Disney Co'), 'Walt Disney');
  assertEquals(cleanCompanyName('Costco Wholesale Corporation'), 'Costco Wholesale');
  // "Group" and "Holdings" are part of the name, not a legal suffix.
  assertEquals(cleanCompanyName('Fortress Investment Group LLC'), 'Fortress Investment Group');
  assertEquals(cleanCompanyName('Visa Inc. Class A'), 'Visa');
});

Deno.test('cleanCompanyName leaves already-clean names and empty input alone', () => {
  assertEquals(cleanCompanyName('Shopify'), 'Shopify');
  assertEquals(cleanCompanyName('  Shopify  '), 'Shopify');
  assertEquals(cleanCompanyName(''), '');
  assertEquals(cleanCompanyName(null), '');
  assertEquals(cleanCompanyName(undefined), '');
});

Deno.test('formatShares shows up to 4 decimals and trims trailing zeros', () => {
  assertEquals(formatShares(2.916472), '2.9165');
  assertEquals(formatShares(6.8942), '6.8942');
  assertEquals(formatShares(18.13930000), '18.1393');
  assertEquals(formatShares(1), '1');
  assertEquals(formatShares(2.5), '2.5');
  assertEquals(formatShares(1234.5), '1,234.5');
});

Deno.test('formatShares rounds beyond 4 decimals instead of showing them', () => {
  assertEquals(formatShares(14.63312), '14.6331');
  assertEquals(formatShares(0.000049), '0');
});

Deno.test('formatShares refuses non-finite input rather than inventing a number', () => {
  assertEquals(formatShares(Number.NaN), '—');
  assertEquals(formatShares(Number.POSITIVE_INFINITY), '—');
});

Deno.test('fixedNotionalShares mirrors record-trade: cents price, then 6 dp quantity', () => {
  // record-trade: price = round(fill * 100) / 100; quantity = round(amount / price * 1e6) / 1e6
  const q = fixedNotionalShares(971.92, 66.4175);
  assertEquals(q?.price, 66.42);
  assertEquals(q?.quantity, Math.round((971.92 / 66.42) * 1e6) / 1e6);
});

Deno.test('fixedNotionalShares: the test_0925 case, JPM proceeds reinvested into VIST', () => {
  const q = fixedNotionalShares(971.92, 66.42);
  assertEquals(formatShares(q?.quantity ?? Number.NaN), '14.6329');
});

Deno.test('fixedNotionalShares refuses a non-positive price', () => {
  assertEquals(fixedNotionalShares(100, 0), null);
  assertEquals(fixedNotionalShares(100, -1), null);
  assertEquals(fixedNotionalShares(100, Number.NaN), null);
});

Deno.test('buyQuantity: one-share modes are always exactly 1', () => {
  assertEquals(buyQuantity({ kind: 'one_share' }), 1);
  assertEquals(buyQuantity({ kind: 'budget', budget: 2500, spent: 1000, left: 1500 }), 1);
  assertEquals(buyQuantity({ kind: 'tier', tierLabel: 'Tier 2' }), 1);
});

Deno.test('buyQuantity: a sale-proceeds source sizes by its amount', () => {
  assertEquals(buyQuantity({ kind: 'proceeds', amount: 971.92, price: 66.42 }), fixedNotionalShares(971.92, 66.42)?.quantity);
});
