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
  capacityLine,
  slotConfigIssues,
  slotFieldA11y,
  slotIssueAway,
  slotIssueOnSlot,
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
// categoryData pulls in supabase, so it is read as text (raw-imports) for the guards below.
import categoryDataSrc from '../lib/categoryData.ts' with { type: 'text' };

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

// ── The slot checks, structured (the logic is validateSlotConfig's, unchanged) ──

const slot = (slotCount: string, priceMin = '', priceMax = '') => ({ slotCount, priceMin, priceMax });

Deno.test('no slots: no issues (slots are optional outside price tiers)', () => {
  assertEquals(slotConfigIssues([], 6), { slots: [], capacity: null });
});

Deno.test('per slot, in order: a count below 1, then a min above the max', () => {
  const out = slotConfigIssues([slot('', '50', '10'), slot('2'), slot('0'), slot('4', '5', '5')], 6);
  assertEquals(out.slots, [
    { slot: 0, kind: 'count' },
    { slot: 0, kind: 'range' },
    { slot: 2, kind: 'count' },
  ]);
  // A bad count adds nothing to the total (2 + 4 = 6): capacity is fine.
  assertEquals(out.capacity, null);
});

Deno.test('capacity: the total must equal the rounds exactly', () => {
  assertEquals(slotConfigIssues([slot('3'), slot('5')], 6).capacity, { total: 8, rounds: 6 });
  assertEquals(slotConfigIssues([slot('4')], 6).capacity, { total: 4, rounds: 6 });
  assertEquals(slotConfigIssues([slot('6')], 6).capacity, null);
});

// ── Copy (Design Lead rulings) ───────────────────────────────────────────

Deno.test('on the slot: no slot number', () => {
  assertEquals(slotIssueOnSlot('count'), 'This slot needs at least 1 stock.');
  assertEquals(slotIssueOnSlot('range'), "Min price can't be higher than max price.");
});

Deno.test('away from the slot: names it, 1-based', () => {
  assertEquals(slotIssueAway({ slot: 1, kind: 'count' }), 'Slot 2 needs at least 1 stock.');
  assertEquals(slotIssueAway({ slot: 1, kind: 'range' }), "In slot 2, min price can't be higher than max price.");
});

Deno.test('capacity, too many: the ruled line', () => {
  assertEquals(capacityLine(8, 6), 'Your slots hold 8 stocks, but each team drafts 6, one per round. Remove 2.');
});

Deno.test('capacity, too few: the ruled line', () => {
  assertEquals(capacityLine(4, 6), 'Your slots hold 4 stocks, but each team drafts 6, one per round. Add 2 so every pick has a slot.');
});

Deno.test('capacity, singular and plural: 1 stock / Remove 1 / Add 1', () => {
  assertEquals(capacityLine(1, 6), 'Your slots hold 1 stock, but each team drafts 6, one per round. Add 5 so every pick has a slot.');
  assertEquals(capacityLine(7, 6), 'Your slots hold 7 stocks, but each team drafts 6, one per round. Remove 1.');
  assertEquals(capacityLine(5, 6), 'Your slots hold 5 stocks, but each team drafts 6, one per round. Add 1 so every pick has a slot.');
  assertEquals(capacityLine(0, 6), 'Your slots hold 0 stocks, but each team drafts 6, one per round. Add 6 so every pick has a slot.');
});

Deno.test('no user-facing line says "stocks per team" or "bracket"', () => {
  const lines = [
    slotIssueOnSlot('count'), slotIssueOnSlot('range'),
    slotIssueAway({ slot: 0, kind: 'count' }), slotIssueAway({ slot: 0, kind: 'range' }),
    capacityLine(8, 6), capacityLine(4, 6),
  ];
  for (const l of lines) {
    assertEquals(/stocks per team/i.test(l), false, l);
    assertEquals(/bracket/i.test(l), false, l);
  }
});

// ── categoryData (read as text) ──────────────────────────────────────────

Deno.test('validateSlotConfig builds its lines from slotConfigIssues (away form + capacity)', () => {
  const fn = categoryDataSrc.slice(categoryDataSrc.indexOf('export function validateSlotConfig('));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assertEquals(body.includes('slotConfigIssues(slots, numRounds)'), true);
  assertEquals(body.includes('issues.map(slotIssueAway)'), true);
  assertEquals(body.includes('capacityLine(capacity.total, capacity.rounds)'), true);
});

Deno.test('the Price tiers and Budget cap help lines are the ruled ones', () => {
  assertEquals(
    categoryDataSrc.includes("'One share per slot. Each roster slot takes stocks in a price range you set, so expensive stocks only compete with each other.'"),
    true,
  );
  assertEquals(
    categoryDataSrc.includes(`"One share per slot. Your roster's share prices must add up to no more than the league cap, so a tight cap makes every pick count."`),
    true,
  );
  const help = [...categoryDataSrc.matchAll(/help: (['"])(.*?)\1,/g)].map((m) => m[2]);
  assertEquals(help.length, 3);
  for (const h of help) assertEquals(/bracket/i.test(h), false, h);
});
