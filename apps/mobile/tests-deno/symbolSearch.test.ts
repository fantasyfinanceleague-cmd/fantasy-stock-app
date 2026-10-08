/**
 * Hermetic unit tests for lib/symbolSearch.ts. Run:
 *
 *   deno test apps/mobile/tests-deno/
 */
import { assertEquals } from 'jsr:@std/assert';
import { parseQuotePrice, shapeSearchOutcome, shapeSearchResults } from '../lib/symbolSearch.ts';

Deno.test('parseQuotePrice: prefers data.price', () => {
  assertEquals(parseQuotePrice({ price: 123.45 }), 123.45);
});

Deno.test('parseQuotePrice: falls back through quote.ap -> quote.bp -> trade.p -> bar.c', () => {
  assertEquals(parseQuotePrice({ quote: { ap: 10 } }), 10);
  assertEquals(parseQuotePrice({ quote: { bp: 11 } }), 11);
  assertEquals(parseQuotePrice({ trade: { p: 12 } }), 12);
  assertEquals(parseQuotePrice({ bar: { c: 13 } }), 13);
});

Deno.test('parseQuotePrice: nullish/zero/negative is unusable', () => {
  assertEquals(parseQuotePrice(null), null);
  assertEquals(parseQuotePrice({}), null);
  assertEquals(parseQuotePrice({ price: 0 }), null);
  assertEquals(parseQuotePrice({ price: -5 }), null);
  assertEquals(parseQuotePrice({ price: 'not-a-number' as unknown as number }), null);
});

const AAPL = { symbol: 'AAPL', name: 'Apple Inc.', price: 250, is_draftable: true };
const BAC = { symbol: 'BAC', name: 'Bank of America', price: 40, is_draftable: false };

Deno.test('shapeSearchResults: draftable + unowned is available and selectable', () => {
  const [shaped] = shapeSearchResults([AAPL]);
  assertEquals(shaped.status, 'available');
  assertEquals(shaped.selectable, true);
  assertEquals(shaped.badgeLabel, null);
});

Deno.test('shapeSearchResults: not-draftable is unselectable with a badge', () => {
  const [shaped] = shapeSearchResults([BAC]);
  assertEquals(shaped.status, 'not_draftable');
  assertEquals(shaped.selectable, false);
  assertEquals(shaped.badgeLabel, 'NOT DRAFTABLE');
});

Deno.test('shapeSearchResults: allowUndraftable bypasses the not_draftable gate', () => {
  const [shaped] = shapeSearchResults([BAC], { allowUndraftable: true });
  assertEquals(shaped.status, 'available');
  assertEquals(shaped.selectable, true);
});

Deno.test('shapeSearchResults: already-owned symbol is unselectable even if draftable', () => {
  const [shaped] = shapeSearchResults([AAPL], { ownedSymbols: new Set(['AAPL']) });
  assertEquals(shaped.status, 'already_owned');
  assertEquals(shaped.selectable, false);
  assertEquals(shaped.badgeLabel, 'ALREADY OWNED');
});

Deno.test('shapeSearchResults: ownedSymbols comparison is case-insensitive via uppercasing', () => {
  const lower = { symbol: 'aapl', name: 'Apple Inc.' };
  const [shaped] = shapeSearchResults([lower], { ownedSymbols: new Set(['AAPL']) });
  assertEquals(shaped.status, 'already_owned');
});

Deno.test('shapeSearchResults: custom owned badge label (draft screen wording)', () => {
  const [shaped] = shapeSearchResults([AAPL], {
    ownedSymbols: new Set(['AAPL']),
    ownedBadgeLabel: 'ALREADY DRAFTED',
  });
  assertEquals(shaped.badgeLabel, 'ALREADY DRAFTED');
});

Deno.test('shapeSearchResults: owned takes priority over not_draftable', () => {
  const ownedAndUndraftable = { symbol: 'BAC', name: 'Bank of America', is_draftable: false };
  const [shaped] = shapeSearchResults([ownedAndUndraftable], { ownedSymbols: new Set(['BAC']) });
  assertEquals(shaped.status, 'already_owned');
});

Deno.test('shapeSearchResults: preserves input order and all fields', () => {
  const shaped = shapeSearchResults([AAPL, BAC]);
  assertEquals(shaped.map((s) => s.symbol), ['AAPL', 'BAC']);
  assertEquals(shaped[0].price, 250);
  assertEquals(shaped[0].name, 'Apple Inc.');
});

// E-1, 3e UX audit: a thrown search must surface as `error`, not a clean
// empty list — the two look identical on screen (no results shown) but must
// be told apart, since a failure read as "no matches" tells the user the
// stock doesn't exist. useSymbolSearch's catch block has no items array, so
// it signals failure with `null`; a real empty response passes `[]`.
Deno.test('shapeSearchOutcome: a thrown search (null items) is `error`, not an empty result list', () => {
  const outcome = shapeSearchOutcome(null);
  assertEquals(outcome.kind, 'error');
  assertEquals('results' in outcome, false);
});

Deno.test('shapeSearchOutcome: a clean no-match response ([]) is `results`, not `error`', () => {
  const outcome = shapeSearchOutcome([]);
  assertEquals(outcome, { kind: 'results', results: [] });
});

Deno.test('shapeSearchOutcome: a real response shapes through shapeSearchResults unchanged', () => {
  const outcome = shapeSearchOutcome([AAPL, BAC], { ownedSymbols: new Set(['BAC']) });
  assertEquals(outcome.kind, 'results');
  assertEquals(outcome.kind === 'results' && outcome.results, shapeSearchResults([AAPL, BAC], { ownedSymbols: new Set(['BAC']) }));
});
