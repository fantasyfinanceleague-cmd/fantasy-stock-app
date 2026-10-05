/**
 * Tests for ./baseline.ts (S9). Hermetic: no DB. The column's grants are covered by
 * supabase/tests/baseline_marker.pglite.test.ts.
 */
import { assertEquals } from 'jsr:@std/assert';
import { weekEndBaselineGate, type BaselineEvidence } from './baseline.ts';

// A partial baseline: two holders at the open, one with no row.
const partial: BaselineEvidence = {
  needsBaseline: true, markerSet: false, markerReadOk: true, openHolderCount: 2, openHoldersMissingRows: 1,
};

Deno.test('S9 refuse: holders at the open with a missing row and no marker -> the baseline is partial', () => {
  assertEquals(weekEndBaselineGate(partial), 'refuse_no_baseline');
});

Deno.test('S1: a STALE marker cannot override per-holder evidence: marker set, a holder still missing -> refuse', () => {
  assertEquals(weekEndBaselineGate({ ...partial, markerSet: true }), 'refuse_no_baseline');
});

Deno.test('S9 recoverable: refuse -> late week-start heal writes every row (and the marker) -> the same close proceeds', () => {
  let e = partial;
  assertEquals(weekEndBaselineGate(e), 'refuse_no_baseline');
  e = { ...e, openHoldersMissingRows: 0, markerSet: true };
  assertEquals(weekEndBaselineGate(e), 'proceed');
});

Deno.test('legacy: every holder at the open has a row (baselined before the marker existed) -> proceed, not a stall', () => {
  assertEquals(weekEndBaselineGate({ ...partial, openHoldersMissingRows: 0 }), 'proceed');
});

Deno.test('cc26857: every holder bought mid-week (nobody held at the open) with the marker set -> proceed', () => {
  assertEquals(weekEndBaselineGate({
    needsBaseline: true, markerSet: true, markerReadOk: true, openHolderCount: 0, openHoldersMissingRows: 0,
  }), 'proceed');
});

Deno.test('cc26857 without the marker: nobody held at the open and no marker -> refuse ("never ran" vs "ran, nothing held")', () => {
  assertEquals(weekEndBaselineGate({
    needsBaseline: true, markerSet: false, markerReadOk: true, openHolderCount: 0, openHoldersMissingRows: 0,
  }), 'refuse_no_baseline');
});

Deno.test('S9: nothing held at either cut needs no evidence', () => {
  assertEquals(weekEndBaselineGate({ ...partial, needsBaseline: false }), 'proceed');
});

Deno.test('S9 fail closed: an unreadable marker refuses, even when every row is present', () => {
  assertEquals(weekEndBaselineGate({ ...partial, markerReadOk: false, openHoldersMissingRows: 0 }), 'refuse_marker_unreadable');
});
