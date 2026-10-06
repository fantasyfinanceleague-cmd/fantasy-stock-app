/**
 * The tier-trade words (3e), against the Design Lead's final table. Every row
 * of the table is pinned, plus both fallbacks (an unresolved category name) and
 * the Flex rule. The server decides fit; these tests pin only the words.
 * Run with: cd apps/mobile/tests-deno && deno test .
 */
import { assertEquals } from 'jsr:@std/assert';
import {
  fillsSlotLine, parsePreviewSlots, parseSlotShape, slotLabelFor, slotLabelsBySymbol, tierRefusalSentence,
  type CategoryResolver, type SlotShape,
} from '../lib/money/tierContract.ts';

const NAMES: Record<string, string> = { tech: 'Tech', health: 'Health Care' };
const resolve: CategoryResolver = (id) => NAMES[id] ?? null;

const band = (id: string, min: number | null, max: number | null, cat: string | null = null): SlotShape => ({
  slot_id: id, slot_index: 0, slot_count: 1, price_min: min, price_max: max, category_id: cat,
});

// ---- Refusal (the sheet's Buy, before the review) -------------------------

Deno.test('refusal: every slot full (open_slots []) is the approved line, with no price head', () => {
  assertEquals(tierRefusalSentence('AAPL', 211.42, [], resolve), 'Every slot is full. Sell a stock first to open its slot.');
});

Deno.test('refusal: one banded slot is the approved single sentence', () => {
  assertEquals(
    tierRefusalSentence('AAPL', 211.42, [band('a', 100, 200)], resolve),
    'AAPL is $211.42. Your open slot takes stocks priced $100 to $200.',
  );
});

Deno.test('refusal: several open slots list each range, with commas and "and" before the last', () => {
  assertEquals(
    tierRefusalSentence('AAPL', 211.42, [band('a', 50, 100), band('b', 200, 400), band('c', 800, null)], resolve),
    'AAPL is $211.42. Your open slots: $50–$100, $200–$400 and $800 or more.',
  );
});

Deno.test('refusal: a null floor reads "up to $50", a null ceiling reads "$800 or more"', () => {
  assertEquals(
    tierRefusalSentence('AAPL', 60, [band('a', null, 50)], resolve),
    'AAPL is $60.00. Your open slot takes stocks priced up to $50.',
  );
  assertEquals(
    tierRefusalSentence('AAPL', 900, [band('a', 800, null)], resolve),
    'AAPL is $900.00. Your open slot takes stocks priced $800 or more.',
  );
});

Deno.test('refusal, category only: no price head, the category named', () => {
  assertEquals(tierRefusalSentence('AAPL', 211.42, [band('t', null, null, 'tech')], resolve), "AAPL doesn't fit your open Tech slot.");
});

Deno.test('refusal, price and category: the category joins the sentence', () => {
  assertEquals(
    tierRefusalSentence('AAPL', 211.42, [band('t', 100, 200, 'tech')], resolve),
    'AAPL is $211.42. Your open slot takes Tech stocks priced $100 to $200.',
  );
});

Deno.test('refusal, a mix of banded and category slots: the list form with full labels', () => {
  assertEquals(
    tierRefusalSentence('AAPL', 211.42, [band('t', 100, 200, 'tech'), band('h', null, null, 'health')], resolve),
    'AAPL is $211.42. Your open slots: $100–$200 Tech and Health Care.',
  );
});

Deno.test('refusal: a Flex slot never appears (it would have accepted the stock)', () => {
  assertEquals(
    tierRefusalSentence('AAPL', 211.42, [band('f', null, null), band('a', 100, 200)], resolve),
    'AAPL is $211.42. Your open slot takes stocks priced $100 to $200.',
  );
  assertEquals(tierRefusalSentence('AAPL', 211.42, [band('f', null, null)], resolve), 'Every slot is full. Sell a stock first to open its slot.');
});

Deno.test('refusal, fallback: an unresolved category never prints "Category"', () => {
  const s = tierRefusalSentence('AAPL', 211.42, [band('x', null, null, 'unknown-id')], resolve);
  assertEquals(s, "AAPL doesn't fit your open slot.");
  assertEquals(s.includes('Category'), false);
});

// ---- Fills (the review's line, once the server names the slot) ------------

Deno.test('fills: a banded slot, a category slot, a banded category slot, and Flex', () => {
  assertEquals(fillsSlotLine(band('a', 100, 200), resolve), 'Fills your $100–$200 slot');
  assertEquals(fillsSlotLine(band('t', null, null, 'tech'), resolve), 'Fills your Tech slot');
  assertEquals(fillsSlotLine(band('t', 100, 200, 'tech'), resolve), 'Fills your $100–$200 Tech slot');
  assertEquals(fillsSlotLine(band('f', null, null), resolve), 'Fills your Flex slot');
});

Deno.test('fills: the approved open-edge forms, and the category form of each', () => {
  assertEquals(fillsSlotLine(band('a', null, 50), resolve), 'Fills your slot priced up to $50');
  assertEquals(fillsSlotLine(band('a', 800, null), resolve), 'Fills your slot priced $800 or more');
  assertEquals(fillsSlotLine(band('t', null, 50, 'tech'), resolve), 'Fills your Tech slot priced up to $50');
  assertEquals(fillsSlotLine(band('t', 800, null, 'tech'), resolve), 'Fills your Tech slot priced $800 or more');
});

Deno.test('fills, fallback: an unresolved category falls back to "Fills your open slot" and nothing else', () => {
  assertEquals(fillsSlotLine(band('x', 100, 200, 'unknown-id'), resolve), 'Fills your open slot');
  assertEquals(fillsSlotLine(band('x', null, null, 'unknown-id'), resolve).includes('Category'), false);
});

// ---- Portfolio row label (the same rule) -----------------------------------

Deno.test('the Portfolio label: "Tech slot", "$100–$200 Tech slot", "$100–$200 slot", "Flex slot"', () => {
  assertEquals(slotLabelFor(band('t', null, null, 'tech'), resolve), 'Tech slot');
  assertEquals(slotLabelFor(band('t', 100, 200, 'tech'), resolve), '$100–$200 Tech slot');
  assertEquals(slotLabelFor(band('a', 100, 200), resolve), '$100–$200 slot');
  assertEquals(slotLabelFor(band('f', null, null), resolve), 'Flex slot');
});

Deno.test('the Portfolio label, fallback: an unresolved category gives no label, never "Category"', () => {
  assertEquals(slotLabelFor(band('x', 100, 200, 'unknown-id'), resolve), null);
  assertEquals(slotLabelsBySymbol([{ ...band('x', 100, 200, 'unknown-id'), held: ['MSFT'], open: 0 }], resolve), {});
});

Deno.test('the Portfolio labels come from the preview map, per held symbol', () => {
  const slots = [{ ...band('t', 100, 200, 'tech'), held: ['MSFT'], open: 0 }];
  assertEquals(slotLabelsBySymbol(slots, resolve), { MSFT: '$100–$200 Tech slot' });
});

// ---- Parsing: a malformed slot is refused, never guessed --------------------

Deno.test('a slot shape is refused when any field is malformed', () => {
  assertEquals(parseSlotShape({ ...band('a', 100, 200), slot_index: 'zero' }), null);
  assertEquals(parseSlotShape({ ...band('a', 100, 200), price_min: 'low' }), null);
  assertEquals(parseSlotShape(band('a', 100, 200))?.slot_id, 'a');
});

Deno.test('the preview slots parse as a whole; one malformed entry refuses the list', () => {
  assertEquals(parsePreviewSlots([{ ...band('a', 100, 200), held: ['MSFT'], open: 0 }])?.[0].held, ['MSFT']);
  assertEquals(parsePreviewSlots([{ ...band('a', 100, 200), held: ['MSFT'], open: 0 }, { ...band('b', 1, 2), open: 'x' }]), null);
  assertEquals(parsePreviewSlots('nope'), null);
});
