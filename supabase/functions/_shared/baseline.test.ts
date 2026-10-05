/**
 * Tests for ./baseline.ts (S9, rows only). Hermetic: no DB.
 */
import { assertEquals } from 'jsr:@std/assert';
import { weekEndBaselineGate } from './baseline.ts';

Deno.test('S9 refuse: a holder at the open has no baseline row -> the baseline is partial or never ran', () => {
  assertEquals(weekEndBaselineGate({ openHolderCount: 2, openPositionsMissingRows: 1 }), 'refuse_no_baseline');
});

Deno.test('S9 recoverable: refuse -> late week-start heal writes every missing row -> the same close proceeds', () => {
  let e = { openHolderCount: 2, openPositionsMissingRows: 1 };
  assertEquals(weekEndBaselineGate(e), 'refuse_no_baseline');
  e = { openHolderCount: 2, openPositionsMissingRows: 0 };
  assertEquals(weekEndBaselineGate(e), 'proceed');
});

Deno.test('cc26857: nobody held at the open (every holder bought mid-week) -> proceed, no marker needed', () => {
  assertEquals(weekEndBaselineGate({ openHolderCount: 0, openPositionsMissingRows: 0 }), 'proceed');
});

Deno.test('legacy: every holder at the open already has a row (baselined before any marker) -> proceed, not a stall', () => {
  assertEquals(weekEndBaselineGate({ openHolderCount: 3, openPositionsMissingRows: 0 }), 'proceed');
});

Deno.test('S9: a single missing holder refuses even when every other holder has a row (no partial portfolio)', () => {
  assertEquals(weekEndBaselineGate({ openHolderCount: 5, openPositionsMissingRows: 1 }), 'refuse_no_baseline');
});
