/**
 * Hermetic tests for symbol-eligibility.ts (Phase 4). Run:
 *   deno test supabase/functions/_shared/symbol-eligibility.test.ts
 */
import { assertEquals } from 'jsr:@std/assert';
import {
  computeIsDraftable,
  type EligibilityInputs,
  MIN_MARKET_CAP,
  MIN_PRICE,
} from './symbol-eligibility.ts';

const base: EligibilityInputs = {
  active: true,
  exchange: 'NASDAQ',
  is_etf: false,
  last_price: 50,
  market_cap: 10_000_000_000,
};
const w = (over: Partial<EligibilityInputs>) => computeIsDraftable({ ...base, ...over });

Deno.test('draftable: healthy large-cap on a primary exchange', () => {
  assertEquals(computeIsDraftable(base), true);
});

Deno.test('inactive or unknown active state is not draftable', () => {
  assertEquals(w({ active: false }), false);
  assertEquals(w({ active: null }), false);
});

Deno.test('NULL exchange fails closed; non-primary exchange excluded', () => {
  assertEquals(w({ exchange: null }), false);
  assertEquals(w({ exchange: '' }), false);
  assertEquals(w({ exchange: 'OTC' }), false);
  for (const ex of ['NYSE', 'NYSE American', 'NYSE Arca', 'Cboe BZX']) {
    assertEquals(w({ exchange: ex }), true, ex);
  }
});

Deno.test('price floor is inclusive at exactly $1; penny stocks excluded', () => {
  assertEquals(w({ last_price: MIN_PRICE }), true);
  assertEquals(w({ last_price: 0.99 }), false);
  assertEquals(w({ last_price: null }), false);
  assertEquals(w({ last_price: 0 }), false);
});

Deno.test('market-cap floor is inclusive at exactly the floor; below excluded', () => {
  assertEquals(w({ market_cap: MIN_MARKET_CAP }), true);
  assertEquals(w({ market_cap: MIN_MARKET_CAP - 1 }), false);
  assertEquals(w({ market_cap: null }), false);
});

Deno.test('ETFs skip the market-cap floor (profile2 has no cap for funds)', () => {
  assertEquals(w({ is_etf: true, market_cap: null }), true);
  // ...but still need price + exchange + active:
  assertEquals(w({ is_etf: true, market_cap: null, last_price: 0.5 }), false);
  assertEquals(w({ is_etf: true, market_cap: null, exchange: null }), false);
});
