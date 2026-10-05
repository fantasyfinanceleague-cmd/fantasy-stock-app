/**
 * Tests for ./baseline.ts (S9). Hermetic: no DB. The column's grants are covered by
 * supabase/tests/baseline_marker.pglite.test.ts.
 */
import { assertEquals } from 'jsr:@std/assert';
import { weekEndBaselineGate, type BaselineEvidence } from './baseline.ts';

const base: BaselineEvidence = { needsBaseline: true, markerSet: false, markerReadOk: true, openHoldersAllHaveRows: false };

Deno.test('S9 refuse: holdings, no marker, and the open holders have no rows -> the baseline never ran', () => {
  assertEquals(weekEndBaselineGate(base), 'refuse_no_baseline');
});

Deno.test('S9 PARTIAL refuse: no marker, and an open holder is missing a row -> refuse', () => {
  assertEquals(weekEndBaselineGate({ ...base, openHoldersAllHaveRows: false }), 'refuse_no_baseline');
});

Deno.test('S9 recoverable: refuse -> late week-start heal sets the marker -> the same close proceeds', () => {
  let e = base;
  assertEquals(weekEndBaselineGate(e), 'refuse_no_baseline');
  e = { ...e, markerSet: true, openHoldersAllHaveRows: true };
  assertEquals(weekEndBaselineGate(e), 'proceed');
});

Deno.test('cc26857: every holder bought mid-week (nobody held at the open) with the marker set by week-start -> proceed', () => {
  assertEquals(weekEndBaselineGate({ needsBaseline: true, markerSet: true, markerReadOk: true, openHoldersAllHaveRows: null }), 'proceed');
});

Deno.test('cc26857 without the marker: nobody held at the open and no marker -> refuse (cannot tell "never ran" from "ran, nothing held")', () => {
  assertEquals(weekEndBaselineGate({ needsBaseline: true, markerSet: false, markerReadOk: true, openHoldersAllHaveRows: null }), 'refuse_no_baseline');
});

Deno.test('legacy: no marker, but every open holder already has a row (baselined before deploy) -> proceed, not a stall', () => {
  assertEquals(weekEndBaselineGate({ ...base, openHoldersAllHaveRows: true }), 'proceed');
});

Deno.test('S9: nothing held at either cut needs no evidence', () => {
  assertEquals(weekEndBaselineGate({ ...base, needsBaseline: false }), 'proceed');
});

Deno.test('S9 fail closed: an unreadable marker refuses, even when every row is present', () => {
  assertEquals(weekEndBaselineGate({ ...base, markerReadOk: false, openHoldersAllHaveRows: true }), 'refuse_marker_unreadable');
});
