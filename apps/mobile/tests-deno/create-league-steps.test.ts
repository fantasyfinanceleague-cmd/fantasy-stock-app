/**
 * Create league's four steps (3c-2): order, back/next, "Step N of 4", and the
 * checks (the old ones, with the Design Lead's inline copy).
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
  DRAFT_DATE_LATER,
  byeExpectedCopy,
  leagueNameError,
  roundRobinCaption,
  nextStep,
  playoffTeamsSub,
  prevStep,
  seasonCheckCaption,
  stakesStepError,
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

// ── Checks: the old checks, the Design Lead's inline copy ──────────────

const allow = () => ({ isValid: true });

Deno.test('league name: blank is refused inline with "Enter a league name."', () => {
  assertEquals(leagueNameError('', allow), 'Enter a league name.');
  assertEquals(leagueNameError('   ', allow), 'Enter a league name.');
});

Deno.test('league name: the moderation check sees the TRIMMED name', () => {
  let seen = '';
  leagueNameError('  Office League  ', (t) => { seen = t; return { isValid: true }; });
  assertEquals(seen, 'Office League');
});

Deno.test('league name: a refused name shows the ruled line, never the raw reason', () => {
  assertEquals(leagueNameError('x', () => ({ isValid: false, reason: 'Contains inappropriate language' })), 'League name is not allowed');
  assertEquals(leagueNameError('x', () => ({ isValid: false })), 'League name is not allowed');
});

Deno.test('league name: a good name has no error', () => {
  assertEquals(leagueNameError('Office League', allow), null);
});

Deno.test('stakes: only price tiers need slots; other modes pass with none', () => {
  assertEquals(stakesStepError('fixed_notional', 0, []), null);
  assertEquals(stakesStepError('budget_cap', 0, []), null);
  // Leftover errors from a mode the user switched away from never block, as before.
  assertEquals(stakesStepError('fixed_notional', 2, ['Slot 1: count must be at least 1.']), null);
});

Deno.test('stakes: price tiers with no slot shows the ruled "price range" line', () => {
  assertEquals(stakesStepError('price_tiers', 0, []), 'Price tiers need at least one slot with a price range.');
});

Deno.test('stakes: price tiers with slot errors are blocked (the errors show on the slots)', () => {
  assertEquals(stakesStepError('price_tiers', 2, ['first', 'second']), 'first');
  assertEquals(stakesStepError('price_tiers', 2, []), null);
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

Deno.test('round-robin caption and the TBD line (Design Lead rulings)', () => {
  assertEquals(roundRobinCaption(7), 'At least 7 weeks, so every team plays every other team once.');
  assertEquals(DRAFT_DATE_LATER, 'Set a draft date before the draft can start. You can do it later in League settings.');
});

Deno.test('budget presets unchanged', () => {
  assertEquals([...BUDGET_PRESETS], ['1000', '2500', '5000', '10000']);
});
