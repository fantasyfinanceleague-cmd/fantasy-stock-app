/**
 * Create league's four steps (3c-2): order, back/next, "Step N of 4", and the
 * gates, which must return exactly the Alerts the old nine-step flow showed.
 * Plus the Season/Draft/Stakes helpers (bounds the DB CHECKs accept, board copy).
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import {
  BUDGET_PRESETS,
  CREATE_ROUNDS_BOUNDS,
  CREATE_STEPS,
  CREATE_STEP_COPY,
  DURATION_OPTIONS,
  MANAGER_SIZES,
  byeExpectedCopy,
  leagueStepGate,
  nextStep,
  playoffTeamsSub,
  prevStep,
  seasonCheckCaption,
  stakesStepGate,
  stakesSummary,
  stepCaption,
  stepManagers,
  stepNumber,
  stepWeeks,
  stepWithin,
  weeksShown,
} from '../lib/game/createLeagueSteps.ts';

Deno.test('four steps in the board order: League, Season, Draft, Stakes', () => {
  assertEquals([...CREATE_STEPS], ['league', 'season', 'draft', 'stakes']);
  assertEquals(CREATE_STEPS.map(stepNumber), [1, 2, 3, 4]);
});

Deno.test('the step caption is the board\'s "Step N of 4"', () => {
  assertEquals(stepCaption('season'), 'Step 2 of 4');
  assertEquals(stepCaption('draft'), 'Step 3 of 4');
  assertEquals(stepCaption('league'), 'Step 1 of 4');
  assertEquals(stepCaption('stakes'), 'Step 4 of 4');
});

Deno.test('next walks forward and ends at the last step (create)', () => {
  assertEquals(nextStep('league'), 'season');
  assertEquals(nextStep('season'), 'draft');
  assertEquals(nextStep('draft'), 'stakes');
  assertEquals(nextStep('stakes'), null);
});

Deno.test('back walks backward and the first step dismisses (no welcome step)', () => {
  assertEquals(prevStep('stakes'), 'draft');
  assertEquals(prevStep('draft'), 'season');
  assertEquals(prevStep('season'), 'league');
  assertEquals(prevStep('league'), null);
});

Deno.test('the Season and Draft titles and subtitles are the board\'s, verbatim', () => {
  assertEquals(CREATE_STEP_COPY.season, { title: 'Season', subtitle: 'How big the league is and how long it runs.' });
  assertEquals(CREATE_STEP_COPY.draft, {
    title: 'Draft',
    subtitle: 'A live snake draft. Everyone picks in turn, and the order reverses each round.',
  });
});

Deno.test('every step has a title and a subtitle', () => {
  for (const s of CREATE_STEPS) {
    assertEquals(CREATE_STEP_COPY[s].title.length > 0, true, s);
    assertEquals(CREATE_STEP_COPY[s].subtitle.length > 0, true, s);
  }
});

// ── Gates: the old Alerts, unchanged ────────────────────────────────────

const allow = () => ({ isValid: true });

Deno.test('League gate: an empty or blank name is refused with the old Required alert', () => {
  assertEquals(leagueStepGate('', allow), { ok: false, title: 'Required', message: 'Please enter a league name' });
  assertEquals(leagueStepGate('   ', allow), { ok: false, title: 'Required', message: 'Please enter a league name' });
});

Deno.test('League gate: the moderation check sees the TRIMMED name', () => {
  let seen = '';
  leagueStepGate('  Office League  ', (t) => { seen = t; return { isValid: true }; });
  assertEquals(seen, 'Office League');
});

Deno.test('League gate: a refused name shows the reason, or the old fallback', () => {
  assertEquals(leagueStepGate('x', () => ({ isValid: false, reason: 'Nope' })), { ok: false, title: 'Error', message: 'Nope' });
  assertEquals(leagueStepGate('x', () => ({ isValid: false })), { ok: false, title: 'Error', message: 'League name is not allowed' });
});

Deno.test('League gate: a good name passes', () => {
  assertEquals(leagueStepGate('Office League', allow), { ok: true });
});

Deno.test('Stakes gate: only price tiers need slots; other modes pass with none', () => {
  assertEquals(stakesStepGate('fixed_notional', 0, []), { ok: true });
  assertEquals(stakesStepGate('budget_cap', 0, []), { ok: true });
  // Leftover errors from a mode the user switched away from never block, as before.
  assertEquals(stakesStepGate('fixed_notional', 2, ['Slot 1: count must be at least 1.']), { ok: true });
});

Deno.test('Stakes gate: price tiers with no slot shows the old Add a slot alert', () => {
  assertEquals(stakesStepGate('price_tiers', 0, []), {
    ok: false,
    title: 'Add a slot',
    message: 'Price tiers need at least one slot with a price bracket.',
  });
});

Deno.test('Stakes gate: price tiers with slot errors shows the FIRST error, as before', () => {
  assertEquals(stakesStepGate('price_tiers', 2, ['first', 'second']), { ok: false, title: 'Fix roster slots', message: 'first' });
  assertEquals(stakesStepGate('price_tiers', 2, []), { ok: true });
});

// ── Season ──────────────────────────────────────────────────────────────

Deno.test('managers: the same even sizes as before, inside the 4..16 CHECK', () => {
  assertEquals([...MANAGER_SIZES], [4, 6, 8, 10, 12, 14, 16]);
  for (const s of MANAGER_SIZES) assertEquals(s >= 4 && s <= 16, true);
});

Deno.test('managers: steps by one listed size and holds at the ends', () => {
  assertEquals(stepManagers(8, 1), 10);
  assertEquals(stepManagers(8, -1), 6);
  assertEquals(stepManagers(16, 1), 16);
  assertEquals(stepManagers(4, -1), 4);
});

Deno.test('managers: a size off the list moves to the nearest listed size that way', () => {
  assertEquals(stepManagers(7, 1), 8);
  assertEquals(stepManagers(7, -1), 6);
});

Deno.test('weeks shown never drop below one round robin (size − 1): the value the insert writes', () => {
  assertEquals(weeksShown(11, 8), 11);
  assertEquals(weeksShown(11, 16), 15); // the old screen showed 11 here and created 15
  assertEquals(weeksShown(7, 8), 7);
});

Deno.test('weeks step from the shown value and hold at the floor', () => {
  assertEquals(stepWeeks(11, 8, 1), 12);
  assertEquals(stepWeeks(11, 8, -1), 10);
  assertEquals(stepWeeks(7, 8, -1), 7);
  assertEquals(stepWeeks(11, 16, 1), 16); // + from the shown 15, not the stale 11
  assertEquals(stepWeeks(11, 16, -1), 15);
});

Deno.test('playoff teams sub-line (board)', () => {
  assertEquals(playoffTeamsSub(7), '2 to 7, up to your expected managers');
});

Deno.test('season caption gains the board\'s recheck sentence', () => {
  assertEquals(seasonCheckCaption(13, 6), 'Season: 13 weeks + 3 playoff weeks. We check this again when the draft starts.');
});

Deno.test('the bye notice second line (board), based on the expected size', () => {
  assertEquals(byeExpectedCopy(7), 'Based on the 7 you expect. This updates as people join.');
});

Deno.test('durations are exactly the CHECK values, in order', () => {
  assertEquals(DURATION_OPTIONS.map((d) => d.value), [7, 30, 90, 180, 365]);
});

// ── Draft / Stakes ──────────────────────────────────────────────────────

Deno.test('rounds in create stay 3..12', () => {
  assertEquals(CREATE_ROUNDS_BOUNDS, { min: 3, max: 12 });
  assertEquals(stepWithin(12, 1, 3, 12), 12);
  assertEquals(stepWithin(3, -1, 3, 12), 3);
  assertEquals(stepWithin(6, 1, 3, 12), 7);
});

Deno.test('the summary Stakes line keeps the old wording', () => {
  assertEquals(stakesSummary({ stakeMode: 'fixed_notional', notionalPerSlot: 1000, budgetCap: 2500, slotCount: 0 }), 'Equal • $1,000/slot');
  assertEquals(stakesSummary({ stakeMode: 'price_tiers', notionalPerSlot: 1000, budgetCap: 2500, slotCount: 1 }), 'Price tiers • 1 slot');
  assertEquals(stakesSummary({ stakeMode: 'price_tiers', notionalPerSlot: 1000, budgetCap: 2500, slotCount: 3 }), 'Price tiers • 3 slots');
  assertEquals(stakesSummary({ stakeMode: 'budget_cap', notionalPerSlot: 1000, budgetCap: 10000, slotCount: 0 }), 'Cap • $10,000');
});

Deno.test('budget presets unchanged', () => {
  assertEquals([...BUDGET_PRESETS], ['1000', '2500', '5000', '10000']);
});
