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
  const n = (src.match(/await markBaseline\(supabase, leagueId, currentWeek, marks\)/g) ?? []).length;
  assert(n >= 4, `week-start sets the marker on ${n} path(s); need at least 4 (none_expected, complete, closed-complete, post-upsert)`);
  assert(src.includes(".from('matchups')\n    .update({ baseline_completed_at"),
    'the marker is not written to matchups.baseline_completed_at');
});

Deno.test('snapshot-week-end: holdings need the matchups marker, and the gate is consulted (S9)', async () => {
  const src = await Deno.readTextFile(FILES[1]);
  assert(src.includes('weekEndBaselineGate({'), 'week-end does not consult the baseline gate');
  assert(src.includes('openHolderCount: openHolderIds.length'), 'week-end does not pass the per-holder evidence to the gate');
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

for (const f of FILES) {
  const nm = f.pathname.split('/').slice(-2)[0];
  Deno.test(`${nm} truncation: every coverage-feeding read asks for an exact count`, async () => {
    const src = await Deno.readTextFile(f);
    const blocks = src.split('checkSnapshotReads({').length - 1;
    assert(blocks >= 2, `${nm}: expected checkSnapshotReads blocks`);
    const exact = src.split("{ count: 'exact' }").length - 1;
    assert(exact >= 5, `${nm}: only ${exact} exact-count reads; drafts, trades, snapshots, matchups and the per-league read must all be counted`);
  });

  Deno.test(`${nm} S2: matchups are read per league, never one .in() across leagues (1000-row cap)`, async () => {
    const src = await Deno.readTextFile(f);
    assertFalse(src.includes(".in('league_id', leagues"), `${nm}: a cross-league .in() read would truncate at the PostgREST cap`);
    assert(src.includes('readLeagueMatchupRows(supabase, league.id)'), `${nm}: matchups are not read per league`);
    assert(src.includes("{ count: 'exact' }"), `${nm}: the reads have no exact-count (truncation) guard`);
  });

  Deno.test(`${nm} B1: a refused window on a SCORED past week is a skip, not a failure`, async () => {
    const src = await Deno.readTextFile(f);
    assert(src.includes('isScoredWeek(matchups)'), `${nm}: refusal path does not check for a scored week`);
    assert(src.includes("'scored_past_window'"), `${nm}: scored skip is not reported`);
  });
}

Deno.test('snapshot-week-start S3: newly set markers count as work', async () => {
  const src = await Deno.readTextFile(FILES[0]);
  assert(src.includes('totalSnapshots + marks.set'), 'a marker-only heal would report work=0 and stay at retrying');
});

Deno.test('refresh-market-calendar B1: the lookback covers a full season', async () => {
  const src = await Deno.readTextFile(new URL('../functions/refresh-market-calendar/index.ts', import.meta.url));
  const m = /const LOOKBACK_DAYS = (\d+);/.exec(src);
  assert(m, 'LOOKBACK_DAYS not found');
  assert(Number(m[1]) >= 120, `LOOKBACK_DAYS is ${m[1]}; must cover a season (>= 120) or old weeks refuse no_coverage`);
});

Deno.test('B2: a week-end heal cron runs Mon and Tue after week-start, idempotently, with no key literal', async () => {
  const sql = await Deno.readTextFile(new URL('../migrations/20261028000002_snapshot_week_end_heal_cron.sql', import.meta.url));
  assert(/cron\.schedule\(\s*'snapshot-week-end-heal',\s*'30 15 \* \* 1,2'/.test(sql), 'heal cron is not scheduled Mon/Tue 15:30Z');
  assert(sql.includes("cron.unschedule('snapshot-week-end-heal')"), 'heal cron is not idempotent (no unschedule first)');
  assert(sql.includes("decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_apikey'"), 'heal cron does not send the apikey from vault');
  assertFalse(/eyJ[A-Za-z0-9_-]{20,}|sb_secret_/.test(sql), 'a key-shaped literal appears in the migration');
  assert(sql.includes("'X-Retry-Attempt', '3'"), 'heal does not stop at max retries: it could clobber a Friday retry-2 job');
  assert(sql.includes('timeout_milliseconds := 60000'), 'heal uses the 5 s pg_net default timeout');
});

