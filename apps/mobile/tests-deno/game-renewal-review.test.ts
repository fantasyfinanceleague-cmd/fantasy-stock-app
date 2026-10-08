/**
 * The Season 2 review (3c, R8): the settings whitelist that start_renewed_season
 * accepts (pick_clock_enabled is NOT one of them, so it is never sent), the
 * teams line (in + new, up to 16), and when the draft can be scheduled.
 * Run: `deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { RENEWAL_SETTINGS_KEYS, buildRenewalSettings, teamsLine, canSchedule } from '../lib/game/renewalReview.ts';

Deno.test('the settings sent are only the server\'s whitelist; pick_clock_enabled and unknown keys are dropped', () => {
  const sent = buildRenewalSettings({
    name: 'Stock Scudetto S2', pick_seconds: 60, pick_clock_enabled: false, num_weeks: 14, owner_id: 'x', draft_date: '2026-01-23T00:00:00Z',
  });
  assertEquals(Object.keys(sent).sort(), ['draft_date', 'name', 'num_weeks', 'pick_seconds']);
  assertEquals(RENEWAL_SETTINGS_KEYS.includes('pick_clock_enabled' as never), false);
});

Deno.test('the teams line is in + new, up to 16, and says more can join by code', () => {
  assertEquals(teamsLine({ in: 4, new: 1 }, 'SCUD26'), { value: '5', sub: "Follows who's in, up to 16. More can join with SCUD26 until the draft." });
});

Deno.test('the draft can be scheduled only when nobody is pending and a date is set', () => {
  assertEquals(canSchedule({ repliesPending: false, draftDate: '2026-01-23T00:00:00Z' }), true);
  assertEquals(canSchedule({ repliesPending: true, draftDate: '2026-01-23T00:00:00Z' }), false);
  assertEquals(canSchedule({ repliesPending: false, draftDate: null }), false);
});
