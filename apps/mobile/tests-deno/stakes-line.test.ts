/**
 * The shared stakes line (lib/stakesLine.ts). Pins the Design Lead's final
 * wording (3f / #125) and keeps its mode labels equal to STAKE_MODE_OPTIONS'.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { dollars, stakesLine } from '../lib/stakesLine.ts';
import categoryData from '../lib/categoryData.ts' with { type: 'text' };

Deno.test('equal stakes carries the per-slot amount', () => {
  assertEquals(stakesLine('fixed_notional', { notionalPerSlot: 1000 }), 'Equal stakes · $1,000 per slot');
  assertEquals(stakesLine('fixed_notional', { notionalPerSlot: 2000 }), 'Equal stakes · $2,000 per slot');
  assertEquals(stakesLine('fixed_notional', { notionalPerSlot: 1250.5 }), 'Equal stakes · $1,250.50 per slot');
});

Deno.test('a missing amount never reads as $0', () => {
  assertEquals(stakesLine('fixed_notional'), 'Equal stakes');
  assertEquals(stakesLine('fixed_notional', {}), 'Equal stakes');
  assertEquals(stakesLine('fixed_notional', { notionalPerSlot: null }), 'Equal stakes');
  assertEquals(stakesLine('fixed_notional', { notionalPerSlot: NaN }), 'Equal stakes');
  assertEquals(stakesLine('budget_cap', { budgetAmount: undefined }), 'Budget cap');
  assertEquals(stakesLine('budget_cap'), 'Budget cap');
});

Deno.test('price tiers and budget cap', () => {
  assertEquals(stakesLine('price_tiers'), 'Price tiers · one share per slot');
  // Amounts that belong to another mode are ignored.
  assertEquals(stakesLine('price_tiers', { notionalPerSlot: 1000, budgetAmount: 2500 }), 'Price tiers · one share per slot');
  assertEquals(stakesLine('budget_cap', { budgetAmount: 2500 }), 'Budget cap · $2,500');
  assertEquals(stakesLine('budget_cap', { budgetAmount: 2500, notionalPerSlot: 1000 }), 'Budget cap · $2,500');
});

Deno.test('unset and unknown modes read "Not set yet"', () => {
  assertEquals(stakesLine(null), 'Not set yet');
  assertEquals(stakesLine(undefined), 'Not set yet');
  assertEquals(stakesLine(''), 'Not set yet');
  assertEquals(stakesLine('something_new', { notionalPerSlot: 1000 }), 'Not set yet');
});

Deno.test('dollars groups thousands without Intl', () => {
  assertEquals(dollars(999), '$999');
  assertEquals(dollars(2000), '$2,000');
  assertEquals(dollars(100000), '$100,000');
  assertEquals(dollars(1234567), '$1,234,567');
});

Deno.test('the mode labels equal STAKE_MODE_OPTIONS (read as text; categoryData imports supabase)', () => {
  const labels = [...categoryData.matchAll(/value: '(fixed_notional|price_tiers|budget_cap)',\s*label: '([^']+)'/g)]
    .map((m) => [m[1], m[2]]);
  assertEquals(labels, [['fixed_notional', 'Equal stakes'], ['price_tiers', 'Price tiers'], ['budget_cap', 'Budget cap']]);
  for (const [mode, label] of labels) {
    assertEquals(stakesLine(mode, { notionalPerSlot: 1, budgetAmount: 1 }).startsWith(label), true, mode);
  }
});
