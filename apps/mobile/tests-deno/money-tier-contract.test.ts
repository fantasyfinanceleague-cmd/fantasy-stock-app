/**
 * The tier-trade contract (3e, option A): the refusal sentence and the slot
 * words are the approved board copy, and the parsers refuse a malformed slot
 * rather than guess one. The server decides fit; these tests only pin the words.
 * Run with: cd apps/mobile/tests-deno && deno test .
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { fillsSlotLine, parsePreviewSlots, parseSlotShape, slotLabelFor, slotLabelsBySymbol, slotRangeText, tierRefusalSentence } from '../lib/money/tierContract.ts';

const LO = { slot_id: 's1', slot_index: 0, slot_count: 1, price_min: 100, price_max: 200, category_id: null };

Deno.test('the approved refusal sentence, from the contract example', () => {
  assertEquals(
    tierRefusalSentence('aapl', 211.42, [LO]),
    'AAPL is $211.42. Your open slot takes stocks priced $100 to $200.',
  );
});

Deno.test('a null floor reads "up to", a null ceiling reads "or more", and both null reads any price', () => {
  assertEquals(slotRangeText(null, 200), 'up to $200');
  assertEquals(slotRangeText(100, null), '$100 or more');
  assertEquals(slotRangeText(null, null), 'at any price');
  assertEquals(tierRefusalSentence('TSLA', 5, [{ ...LO, price_min: null, price_max: 50 }]), 'TSLA is $5.00. Your open slot takes stocks priced up to $50.');
});

Deno.test('bounds keep cents only when they have them: $211.42, never $100.00', () => {
  assertEquals(slotRangeText(100.5, 200), '$100.50 to $200');
});

Deno.test('every slot held: a no-open-slot line, never a guessed range', () => {
  const s = tierRefusalSentence('AAPL', 211.42, []);
  assertEquals(s.startsWith('AAPL is $211.42.'), true);
  assert(!s.includes('takes stocks priced'));
});

Deno.test('several open slots name each range', () => {
  const hi = { ...LO, slot_id: 's2', slot_index: 1, price_min: 200, price_max: 300 };
  assertEquals(tierRefusalSentence('X', 50, [LO, hi]), 'X is $50.00. Your open slots take stocks priced $100 to $200 or $200 to $300.');
});

Deno.test('the fill line names the slot the server chose', () => {
  assertEquals(fillsSlotLine(LO), 'Fills your $100–$200 slot');
  assertEquals(fillsSlotLine({ ...LO, price_min: null }), 'Fills your slot priced up to $200');
  assertEquals(fillsSlotLine({ ...LO, price_max: null }), 'Fills your slot priced $100 or more');
});

Deno.test('a slot shape is refused when any field is malformed, never guessed', () => {
  assertEquals(parseSlotShape({ ...LO, slot_index: 'zero' }), null);
  assertEquals(parseSlotShape({ ...LO, price_min: 'low' }), null);
  assertEquals(parseSlotShape(LO)?.slot_id, 's1');
});

Deno.test('the preview slots parse as a whole, and a malformed entry refuses the whole list', () => {
  const ok = parsePreviewSlots([{ ...LO, held: ['MSFT'], open: 0 }]);
  assertEquals(ok?.[0].held, ['MSFT']);
  assertEquals(parsePreviewSlots([{ ...LO, held: ['MSFT'], open: 0 }, { ...LO, open: 'x' }]), null);
  assertEquals(parsePreviewSlots('nope'), null);
});

Deno.test('slot labels for the Portfolio, from the preview map: the right slot per symbol', () => {
  const slots = [
    { ...LO, held: ['MSFT'], open: 0 },
    { ...LO, slot_id: 's2', slot_index: 1, price_min: 200, price_max: null, held: [], open: 1 },
  ];
  assertEquals(slotLabelsBySymbol(slots), { MSFT: '$100–$200 slot' });
  assertEquals(slotLabelFor({ ...LO, price_max: null }), '$100 or more slot');
  assertEquals(slotLabelFor({ ...LO, price_min: null }), 'Up to $200 slot');
  assertEquals(slotLabelsBySymbol(null), {});
});
