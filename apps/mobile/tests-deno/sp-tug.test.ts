/**
 * Hermetic unit tests for components/sp/logic/tug.ts — no RN, run with:
 *
 *   deno test apps/mobile/tests-deno/
 *
 * Formula pinned by the Orchestrator (2026-09-26, matching web):
 *   p = 0.5 + 0.5 * (you - opp) / max(|you| + |opp|, 1), clamped [0.08, 0.92].
 */
import { assertEquals } from 'jsr:@std/assert';
import { tugRatio, leaderOf, hasLeadChanged } from '../components/sp/logic/tug.ts';

Deno.test('tugRatio: both zero is exactly dead even', () => {
  assertEquals(tugRatio(0, 0), 0.5);
});

Deno.test('tugRatio: an even split with a large denominator is exactly dead even', () => {
  assertEquals(tugRatio(100, 100), 0.5);
});

Deno.test('tugRatio: you leading pushes the ratio above 0.5', () => {
  assertEquals(tugRatio(200, 100), 0.5 + 0.5 * (100 / 300));
});

Deno.test('tugRatio: opponent leading pushes the ratio below 0.5', () => {
  assertEquals(tugRatio(100, 200), 0.5 + 0.5 * (-100 / 300));
});

Deno.test('tugRatio: clamps to 0.92 on an overwhelming lead', () => {
  assertEquals(tugRatio(10000, 0), 0.92);
});

Deno.test('tugRatio: clamps to 0.08 on an overwhelming deficit', () => {
  assertEquals(tugRatio(0, 10000), 0.08);
});

Deno.test('tugRatio: the $1 floor keeps small opening gains from swinging wildly', () => {
  // Without the floor, 0.01 vs 0 would divide by 0.01 and slam to the clamp.
  // With the floor (denom = max(0.01, 1) = 1), it's a gentle nudge.
  const p = tugRatio(0.01, 0);
  assertEquals(p, 0.5 + 0.5 * (0.01 / 1));
  assertEquals(p < 0.51, true);
});

Deno.test('leaderOf: you, opponent, and tie', () => {
  assertEquals(leaderOf(10, 5), 'you');
  assertEquals(leaderOf(5, 10), 'opponent');
  assertEquals(leaderOf(5, 5), 'tie');
});

Deno.test('hasLeadChanged: true when the leader flips', () => {
  assertEquals(hasLeadChanged(10, 5, 5, 10), true);
});

Deno.test('hasLeadChanged: true when a lead narrows to a tie', () => {
  assertEquals(hasLeadChanged(10, 5, 8, 8), true);
});

Deno.test('hasLeadChanged: false when the same side keeps leading', () => {
  assertEquals(hasLeadChanged(10, 5, 20, 5), false);
});

Deno.test('hasLeadChanged: false when both sides stay tied', () => {
  assertEquals(hasLeadChanged(5, 5, 8, 8), false);
});
