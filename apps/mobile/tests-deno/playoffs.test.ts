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
import { playoffPlan as mobilePlan } from '../lib/playoffs.ts';
// Plain ESM .js; Deno imports it directly and type-checks it via its JSDoc.
import { playoffPlan as webPlan } from '../../web/src/utils/playoffs.js';
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
