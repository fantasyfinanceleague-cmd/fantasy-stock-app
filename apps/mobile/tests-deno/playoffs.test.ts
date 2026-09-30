/**
 * Pins the three copies of the playoff shape + round names to each other:
 *   server  supabase/functions/_shared/playoff-bracket.ts (the source of truth)
 *   mobile  apps/mobile/lib/playoffs.ts
 *   web     apps/web/src/utils/playoffs.js
 * Run (see ./deno.json for why it must be run from here):
 *
 *   cd apps/mobile/tests-deno && deno test .
 */
import { assertEquals } from 'jsr:@std/assert';
import { playoffLine as mobileLine, playoffPlan as mobilePlan, playoffRoundLabelForWeek as mobileWeek, playoffRoundShortName } from '../lib/playoffs.ts';
// Plain ESM .js; Deno imports it directly and type-checks it via its JSDoc.
import { playoffLine as webLine, playoffPlan as webPlan, playoffRoundLabelForWeek as webWeek } from '../../web/src/utils/playoffs.js';
import {
  isValidPlayoffTeams,
  playoffRoundLabels,
  playoffShape,
} from '../../../supabase/functions/_shared/playoff-bracket.ts';

function serverPlan(teams: unknown) {
  if (!isValidPlayoffTeams(teams)) return null;
  const rounds = playoffRoundLabels(teams);
  if (!rounds) return null;
  const { weeks, byes } = playoffShape(teams);
  return { teams, weeks, byes, rounds };
}

Deno.test('mobile and web playoffPlan match the server for P = -2..70 and junk', () => {
  const inputs: unknown[] = [...Array.from({ length: 73 }, (_, i) => i - 2), 2.5, NaN, Infinity, null, undefined, '4'];
  for (const p of inputs) {
    const expected = serverPlan(p);
    const junk = p as number; // deliberately feeding non-numbers too
    assertEquals(mobilePlan(junk), expected, `mobile P=${String(p)}`);
    assertEquals(webPlan(junk), expected, `web P=${String(p)}`);
  }
});

Deno.test('client labels: all 15 league sizes, pinned (DECIDED copy)', () => {
  const expected = [
    'Final',
    'Wild card · Final',
    'Semifinals · Final',
    'Wild card · Semifinals · Final',
    'Wild card · Semifinals · Final',
    'Wild card · Semifinals · Final',
    'Quarterfinals · Semifinals · Final',
    ...Array(7).fill('Wild card · Quarterfinals · Semifinals · Final'),
    'Round of 16 · Quarterfinals · Semifinals · Final',
  ];
  assertEquals(Array.from({ length: 15 }, (_, i) => mobilePlan(i + 2)!.rounds.join(' · ')), expected);
  assertEquals(Array.from({ length: 15 }, (_, i) => webPlan(i + 2)!.rounds.join(' · ')), expected);
});

Deno.test('playoffLine: the design board copy, identical on mobile and web', () => {
  assertEquals(mobileLine(2), '2 teams · 1 week of playoffs · no byes');
  assertEquals(mobileLine(7), '7 teams · 3 weeks of playoffs · the top seed gets a first-round bye');
  assertEquals(mobileLine(6), '6 teams · 3 weeks of playoffs · the top 2 seeds get first-round byes');
  assertEquals(mobileLine(16), '16 teams · 4 weeks of playoffs · no byes');
  assertEquals(mobileLine(null), null);
  for (let p = -1; p <= 20; p++) assertEquals(webLine(p), mobileLine(p), `P=${p}`);
});

Deno.test('playoffRoundLabelForWeek: week num_weeks + r is round r; regular weeks and bad input are null', () => {
  // 10-week season, 6 playoff teams: weeks 11/12/13 = Wild card / Semifinals / Final.
  assertEquals([10, 11, 12, 13, 14].map((w) => mobileWeek(w, 10, 6)), [null, 'Wild card', 'Semifinals', 'Final', null]);
  assertEquals(mobileWeek(5, 4, 2), 'Final');
  assertEquals(mobileWeek(11, 10, null), null);
  assertEquals(mobileWeek(null, 10, 4), null);
  for (let p = 2; p <= 16; p++) {
    for (let w = 1; w <= 20; w++) assertEquals(webWeek(w, 8, p), mobileWeek(w, 8, p), `P=${p} w=${w}`);
  }
});

// ── playoffRoundShortName (B7, Design Lead ruling, 2026-09-30): the season
// chart's week chips, mobile-only (not mirrored to web/server -- a chip-
// width display concern, not shared playoff structure). ────────────────────

Deno.test('playoffRoundShortName: WC / QF / SF / F / R16', () => {
  assertEquals(playoffRoundShortName('Wild card'), 'WC');
  assertEquals(playoffRoundShortName('Quarterfinals'), 'QF');
  assertEquals(playoffRoundShortName('Semifinals'), 'SF');
  assertEquals(playoffRoundShortName('Final'), 'F');
  assertEquals(playoffRoundShortName('Round of 16'), 'R16');
});

Deno.test('playoffRoundShortName: an unrecognized round name passes through unchanged, never blank', () => {
  assertEquals(playoffRoundShortName('Some Future Round'), 'Some Future Round');
});

// ── B7 bullet 3 (Orchestrator, 2026-09-30): confirms playoffRoundLabelForWeek
// is keyed on the bracket ADDRESS (week - numWeeks, the round offset), never
// on an absolute week number -- so a fixture using a short (numWeeks=6)
// regular season instead of a long one (numWeeks=14) gets IDENTICAL round
// labels and chips for the same bracket, as long as its playoff week
// numbers are derived the same way the backend does: week = numWeeks +
// round. No code changes were needed for this: the function already
// computes `plan.rounds[week - numWeeks - 1]`, which is round-offset-only
// by construction; this test exists to pin that invariant, not to fix a bug. ─

Deno.test('playoffRoundLabelForWeek: a 6-team bracket gives IDENTICAL round labels at numWeeks=6 and numWeeks=14, given week = numWeeks + round', () => {
  for (let round = 1; round <= 3; round++) {
    const short = mobileWeek(6 + round, 6, 6);
    const long = mobileWeek(14 + round, 14, 6);
    assertEquals(short, long, `round ${round}`);
  }
});
