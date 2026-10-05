/**
 * Structural guard for the snapshot-jobs hardening (S8 week selection, the
 * same-day status rule, the per-participant closed gate, instant compares,
 * and no internal error text in 500 bodies). The pure rules are unit-tested
 * in _shared/week-select.test.ts; neither handler imports a test, so this reads
 * both index.ts files as TEXT. Reads files only, no network or DB:
 *   deno test --allow-read supabase/tests/snapshot_jobs_wiring.test.ts
 */
import { assert, assertFalse } from 'jsr:@std/assert';

const FILES = [
  new URL('../functions/snapshot-week-start/index.ts', import.meta.url),
  new URL('../functions/snapshot-week-end/index.ts', import.meta.url),
];

for (const file of FILES) {
  const name = file.pathname.split('/').slice(-2)[0];
  const read = () => Deno.readTextFile(file);

  Deno.test(`${name} S8: target weeks come from selectTargetWeeks, not leagues.current_week`, async () => {
    const src = await read();
    assert(src.includes('selectTargetWeeks('), `${name}: week selection is not window-based`);
    assertFalse(/const currentWeek = league\.current_week/.test(src),
      `${name}: still keys the week on league.current_week (S8)`);
  });

  Deno.test(`${name}: every success status write states its work count`, async () => {
    const src = await read();
    assertFalse(/'success', retryAttempt\);/.test(src),
      `${name}: a success status is written without a work count (the no-op overwrite defect)`);
  });

  Deno.test(`${name}: the same-day status write goes through the shared overwrite rule`, async () => {
    const src = await read();
    assert(src.includes('shouldWriteJobStatus('), `${name}: updateJobStatus does not consult shouldWriteJobStatus`);
    assert(src.includes(".maybeSingle()"), `${name}: updateJobStatus does not read the existing row before writing`);
  });

  Deno.test(`${name}: no internal error text in a 500 response body`, async () => {
    const src = await read();
    assertFalse(/message:\s*errorMessage/.test(src),
      `${name}: an error body returns the raw error text (String(e)) to the cron caller`);
  });

  Deno.test(`${name}: trade windows are compared by instant, not by ISO string`, async () => {
    const src = await read();
    assertFalse(/created_at\s*<=?[^,)\n]*toISOString\(\)/.test(src),
      `${name}: a trade window compares created_at as a string against an ISO cut`);
    assertFalse(/created_at\s*<=?\s*cut\w*Iso/.test(src),
      `${name}: a trade window compares created_at as a string against an ISO cut`);
  });
}

Deno.test('snapshot-week-start: the existence-only alreadyEndPriced check is gone; closed-ness is per-participant', async () => {
  const src = await Deno.readTextFile(FILES[0]);
  assertFalse(src.includes('const alreadyEndPriced = existingSnapshots.some'),
    'the existence-only alreadyEndPriced guard is back');
  assert(src.includes('classifyCloseCoverage(userHoldings, existingSnapshots)'),
    'week-start does not use the per-participant closed gate');
});

Deno.test('snapshot-week-start: every completion path sets the marker on matchups (S9)', async () => {
  const src = await Deno.readTextFile(FILES[0]);
  const n = (src.match(/await markBaseline\(supabase, leagueId, currentWeek\)/g) ?? []).length;
  assert(n >= 4, `week-start sets the marker on ${n} path(s); need at least 4 (none_expected, complete, closed-complete, post-upsert)`);
  assert(src.includes(".from('matchups')\n    .update({ baseline_completed_at"),
    'the marker is not written to matchups.baseline_completed_at');
});

Deno.test('snapshot-week-end: holdings need the matchups marker, and the gate is consulted (S9)', async () => {
  const src = await Deno.readTextFile(FILES[1]);
  assert(src.includes('weekEndBaselineGate({ needsBaseline, markerSet, markerReadOk, openHoldersAllHaveRows })'), 'week-end does not consult the baseline gate');
  assert(src.includes(".select('baseline_completed_at')"), 'week-end does not read the marker from matchups');
});

Deno.test('both: no run log is written (cron_job_status only, approved)', async () => {
  for (const f of FILES) {
    const src = await Deno.readTextFile(f);
    assertFalse(src.includes("cron_job_runs"), `${f}: still writes the run log`);
  }
});

Deno.test('snapshot-week-start: the marker is never set at the window rewrite, and the heal sets it only after the upsert succeeds (S9)', async () => {
  const src = await Deno.readTextFile(FILES[0]);
  const rw = src.indexOf('if (windowPlan.rewrite) {');
  const rwEnd = src.indexOf('rewrote matchups window', rw);
  assert(rw >= 0 && rwEnd > rw, 'could not locate the window rewrite block');
  assertFalse(src.slice(rw, rwEnd).includes('markBaseline('),
    'the marker is set inside the window rewrite; it must be set only after rows commit');
  const snapUpsert = src.indexOf('.upsert(snapshots');
  const upsertErr = src.indexOf('if (upsertErr) {', snapUpsert);
  const lastMark = src.lastIndexOf('await markBaseline(');
  assert(snapUpsert >= 0 && upsertErr > snapUpsert && lastMark > upsertErr,
    'the heal sets the marker before checking the upsert error (an aborted write could leave it set)');
});

