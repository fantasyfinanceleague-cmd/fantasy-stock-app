/**
 * The roster-slot editor's rules (3c-2): the copy carried over from the old
 * SlotBuilder verbatim, the input sanitising, and the shortfall arithmetic.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import {
  EMPTY_SLOT,
  PRICE_TIERS_NEED_A_SLOT,
  SLOT_FIELD_LABELS,
  rosterSlotsCaption,
  slotFieldA11y,
  splitSlotErrors,
  SLOT_CHECK_FAILED,
  SLOT_PARTIAL_NOTE,
  categoryLabel,
  countInput,
  priceInput,
  removeSlotLabel,
  slotShort,
  slotShortfallCopy,
  slotTitle,
} from '../lib/game/slotBuilderCopy.ts';

const CATS = [{ id: 'c1', name: 'Tech' }, { id: 'c2', name: 'Energy' }];

Deno.test('a new slot is one stock with no filters (flex), as before', () => {
  assertEquals({ ...EMPTY_SLOT }, { slotCount: '1', priceMin: '', priceMax: '', categoryId: '' });
});

Deno.test('slot heading and remove label are 1-based', () => {
  assertEquals(slotTitle(0), 'Slot 1');
  assertEquals(removeSlotLabel(2), 'Remove slot 3');
});

Deno.test('category label: flex, a name, or Unknown for a vanished id', () => {
  assertEquals(categoryLabel('', CATS), 'Any (flex)');
  assertEquals(categoryLabel('c2', CATS), 'Energy');
  assertEquals(categoryLabel('gone', CATS), 'Unknown');
});

Deno.test('count keeps digits only; prices keep digits and the point', () => {
  assertEquals(countInput('2a.5'), '25');
  assertEquals(countInput(''), '');
  assertEquals(priceInput('$12.50x'), '12.50');
});

Deno.test('shortfall copy is the old wording, plural and singular', () => {
  assertEquals(
    slotShortfallCopy(0, 5, 8, '2'),
    'Slot 1: only 5 draftable stocks match — the league needs at least 16 (8 teams × 2).',
  );
  assertEquals(
    slotShortfallCopy(1, 1, 4, '1'),
    'Slot 2: only 1 draftable stock match — the league needs at least 4 (4 teams × 1).',
  );
});

Deno.test('an empty or zero count needs one per team, as the old check did', () => {
  assertEquals(slotShortfallCopy(0, 3, 6, ''), 'Slot 1: only 3 draftable stocks match — the league needs at least 6 (6 teams × ).');
  assertEquals(slotShort(5, 6, ''), true);
  assertEquals(slotShort(6, 6, '0'), false);
});

Deno.test('short only when matches fall below teams × count', () => {
  assertEquals(slotShort(15, 8, '2'), true);
  assertEquals(slotShort(16, 8, '2'), false);
});

Deno.test('the failure and partial-data lines are the old ones', () => {
  assertEquals(SLOT_CHECK_FAILED, 'Could not check availability — try again.');
  assertEquals(SLOT_PARTIAL_NOTE.startsWith('Stock data is still loading (takes ~2 days after launch)'), true);
  assertEquals(SLOT_PARTIAL_NOTE.endsWith('Slot count math is still enforced.'), true);
});

// ── Design Lead copy rulings (3c-2 round 3) ─────────────────────────────

Deno.test('field labels: Stocks, Min $, Max $', () => {
  assertEquals(SLOT_FIELD_LABELS, { count: 'Stocks', min: 'Min $', max: 'Max $' });
});

Deno.test('VoiceOver reads the fields in words', () => {
  assertEquals(slotFieldA11y(1, 'count'), 'Slot 2, stocks');
  assertEquals(slotFieldA11y(1, 'min'), 'Slot 2, lowest price in dollars');
  assertEquals(slotFieldA11y(1, 'max'), 'Slot 2, highest price in dollars');
});

Deno.test('roster slots caption: sentences, "price range" and never "bracket"', () => {
  assertEquals(rosterSlotsCaption('price_tiers'), 'Required: each slot sets a price range.');
  assertEquals(rosterSlotsCaption('fixed_notional'), 'Optional: a slot can require a category or a price range.');
  assertEquals(rosterSlotsCaption(''), 'Optional: a slot can require a category or a price range.');
  for (const line of [rosterSlotsCaption('price_tiers'), rosterSlotsCaption('budget_cap'), PRICE_TIERS_NEED_A_SLOT]) {
    assertEquals(/bracket/i.test(line), false, line);
  }
});

Deno.test('price tiers with no slot: the ruled line', () => {
  assertEquals(PRICE_TIERS_NEED_A_SLOT, 'Price tiers need at least one slot with a price range.');
});

Deno.test('slot errors split onto their slots; the capacity line stays general', () => {
  const capacity = 'Slots cover only 2 of 6 picks — once slots exist, every pick needs an open slot, so the draft would jam after 2. Add 4 more.';
  const out = splitSlotErrors([
    'Slot 1: count must be at least 1.',
    'Slot 1: min price is above max price.',
    'Slot 3: min price is above max price.',
    capacity,
  ]);
  assertEquals(out.bySlot, {
    0: ['Count must be at least 1.', 'Min price is above max price.'],
    2: ['Min price is above max price.'],
  });
  assertEquals(out.general, [capacity]);
});

Deno.test('no errors, nothing to show', () => {
  assertEquals(splitSlotErrors([]), { bySlot: {}, general: [] });
});
