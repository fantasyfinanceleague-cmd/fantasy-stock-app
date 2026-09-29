/**
 * Hermetic unit tests for components/sp/logic/tug.ts — no RN, run with:
 *
 *   deno test apps/mobile/tests-deno/
 *
 * Formula pinned by the Orchestrator (2026-09-26, matching web):
 *   p = 0.5 + 0.5 * (you - opp) / max(|you| + |opp|, 1), clamped [0.08, 0.92].
 */
import { assertEquals } from 'jsr:@std/assert';
import { tugRatio, leaderOf, hasLeadChanged, tugAccessibilityLabel } from '../components/sp/logic/tug.ts';

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

// tugAccessibilityLabel — Design Lead (2026-09-26): dollars only, never a
// percentage. The visual ratio is a clamped layout fraction, not a
// probability; reading it aloud as one would imply a win probability, which
// is ruled out product-wide.

Deno.test('tugAccessibilityLabel: you leading says "You lead by $X"', () => {
  assertEquals(tugAccessibilityLabel(117.4, 100, 'Priya'), 'You lead by $17.40');
});

Deno.test('tugAccessibilityLabel: opponent leading uses their name, third person', () => {
  assertEquals(tugAccessibilityLabel(100, 117.4, 'Priya'), 'Priya leads by $17.40');
});

Deno.test('tugAccessibilityLabel: a tie says exactly "Tied"', () => {
  assertEquals(tugAccessibilityLabel(50, 50, 'Priya'), 'Tied');
  assertEquals(tugAccessibilityLabel(0, 0, 'Priya'), 'Tied');
});

Deno.test('tugAccessibilityLabel: the gap uses the minus sign convention, not a raw negative', () => {
  // formatMoney(Math.abs(...)) is always non-negative here, so U+2212 never
  // appears in a lead label — this pins that the label never reads like
  // "leads by -$17.40".
  const label = tugAccessibilityLabel(100, 200, 'Priya');
  assertEquals(label.includes('−'), false);
  assertEquals(label.includes('-'), false);
});

Deno.test('tugAccessibilityLabel: never contains a percent sign, for any inputs', () => {
  const cases: Array<[number, number]> = [
    [117.4, 100],
    [100, 117.4],
    [0, 0],
    [-50, 50],
    [10000, 0.01],
  ];
  for (const [you, opponent] of cases) {
    assertEquals(tugAccessibilityLabel(you, opponent, 'Priya').includes('%'), false);
  }
});
