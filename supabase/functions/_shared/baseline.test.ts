/**
 * Tests for ./baseline.ts (S9). Hermetic: no DB. The column's grants are covered by
 * supabase/tests/baseline_marker.pglite.test.ts.
 */
import { assertEquals } from 'jsr:@std/assert';
import { weekEndBaselineGate } from './baseline.ts';

Deno.test('S9 refuse: holdings and no marker -> the baseline never ran, so refuse', () => {
  assertEquals(weekEndBaselineGate({ needsBaseline: true, markerSet: false, markerReadOk: true }), 'refuse_no_baseline');
});

Deno.test('S9 recoverable: refuse -> late week-start heal sets the marker -> the same close proceeds', () => {
  let e = { needsBaseline: true, markerSet: false, markerReadOk: true };
  assertEquals(weekEndBaselineGate(e), 'refuse_no_baseline');
  e = { ...e, markerSet: true };
  assertEquals(weekEndBaselineGate(e), 'proceed');
});

Deno.test('cc26857: every holder bought mid-week (zero baseline rows, marker set by week-start) -> close proceeds', () => {
  assertEquals(weekEndBaselineGate({ needsBaseline: true, markerSet: true, markerReadOk: true }), 'proceed');
});

Deno.test('S9: nothing held at either cut needs no marker', () => {
  assertEquals(weekEndBaselineGate({ needsBaseline: false, markerSet: false, markerReadOk: true }), 'proceed');
});

Deno.test('S9 fail closed: an unreadable marker refuses, even when it would read as set', () => {
  assertEquals(weekEndBaselineGate({ needsBaseline: true, markerSet: true, markerReadOk: false }), 'refuse_marker_unreadable');
});
