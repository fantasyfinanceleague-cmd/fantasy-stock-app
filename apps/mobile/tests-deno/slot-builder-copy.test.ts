/**
 * The roster-slot editor's rules (3c-2): the copy carried over from the old
 * SlotBuilder verbatim, the input sanitising, and the shortfall arithmetic.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import {
  EMPTY_SLOT,
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
