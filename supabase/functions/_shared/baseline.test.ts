/**
 * Tests for ./baseline.ts (S9). Keyed on the OPEN cut, per participant. Hermetic:
 * no DB. The DB side of the marker is covered by
 * supabase/tests/baseline_marker.pglite.test.ts.
 */
import { assertEquals } from 'jsr:@std/assert';
import { baselineMarkerRow, weekEndBaselineGate, type BaselineEvidence } from './baseline.ts';

// A holder held at the open and has NO row: the baseline never ran for them.
const base: BaselineEvidence = {
  anyOpenHoldings: true,
  openHoldersMissingRows: 2,
  markerPresent: false,
  markerMatchesWindow: false,
  markerReadOk: true,
};

Deno.test('S9 refuse: open holders with no rows and no marker -> the baseline never ran', () => {
  assertEquals(weekEndBaselineGate(base), 'refuse_no_baseline');
});

Deno.test('S9 PARTIAL refuse: some open holders have rows, one does not, no marker -> refuse (the existence bypass)', () => {
  assertEquals(weekEndBaselineGate({ ...base, openHoldersMissingRows: 1 }), 'refuse_no_baseline');
});

Deno.test('S9 recoverable: after the late week-start heal (rows for all, marker for this window) -> proceed', () => {
  const healed: BaselineEvidence = { ...base, openHoldersMissingRows: 0, markerPresent: true, markerMatchesWindow: true };
  assertEquals(weekEndBaselineGate(healed), 'proceed');
});

Deno.test('S9 zero rows with the marker set is legitimate (everyone bought mid-week; nothing held at open) -> proceed', () => {
  assertEquals(weekEndBaselineGate({ anyOpenHoldings: false, openHoldersMissingRows: 0, markerPresent: true, markerMatchesWindow: true, markerReadOk: true }), 'proceed');
});

Deno.test('S9: nothing held at the open -> proceed, even with no rows and no marker', () => {
  assertEquals(weekEndBaselineGate({ ...base, anyOpenHoldings: false, openHoldersMissingRows: 0 }), 'proceed');
});

Deno.test('S9: a legacy week where every open holder already has a row (no marker yet) -> proceed', () => {
  assertEquals(weekEndBaselineGate({ ...base, openHoldersMissingRows: 0, markerPresent: false }), 'proceed');
});

Deno.test('S9 stale marker: a marker from a prior season (different open) does not vouch for this week', () => {
  // The row exists but for another window, and an open holder lacks a row -> refuse.
  assertEquals(weekEndBaselineGate({ ...base, markerPresent: true, markerMatchesWindow: false }), 'refuse_no_baseline');
});

Deno.test('S9 fail closed: an unreadable marker refuses, even when every row is present', () => {
  assertEquals(weekEndBaselineGate({ ...base, openHoldersMissingRows: 0, markerReadOk: false }), 'refuse_marker_unreadable');
});

Deno.test('S9: the marker row is keyed by league and week and carries the open and its session date', () => {
  const open = new Date('2026-10-05T13:30:00.000Z');
  assertEquals(baselineMarkerRow('L1', 3, open, '2026-10-05', 6, 14), {
    league_id: 'L1',
    week_number: 3,
    open_at: '2026-10-05T13:30:00.000Z',
    open_session_date: '2026-10-05',
    participants: 6,
    rows_written: 14,
  });
});

Deno.test('S9 sequence: refuse -> late heal -> close', () => {
  let e: BaselineEvidence = base;
  assertEquals(weekEndBaselineGate(e), 'refuse_no_baseline');
  e = { ...e, openHoldersMissingRows: 0, markerPresent: true, markerMatchesWindow: true };
  assertEquals(weekEndBaselineGate(e), 'proceed');
});
