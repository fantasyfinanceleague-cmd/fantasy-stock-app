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

Deno.test('both: no run log is written (cron_job_status only, approved)', async () => {
  for (const f of FILES) {
    const src = await Deno.readTextFile(f);
    assertFalse(src.includes("cron_job_runs"), `${f}: still writes the run log`);
  }
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

Deno.test('S9 rows-only: week-end gates on baseline ROWS, and no marker remains anywhere', async () => {
  const src = await Deno.readTextFile(FILES[1]);
  assert(src.includes('weekEndBaselineGate({ openHolderCount, openPositionsMissingRows })'),
    'week-end does not gate on the per-holder rows evidence');
  for (const f of FILES) {
    const t = await Deno.readTextFile(f);
    assertFalse(t.includes('baseline_completed_at'), `${f.pathname}: the dropped marker column is still referenced`);
    assertFalse(t.includes('markBaseline'), `${f.pathname}: a marker write is still present`);
  }
});

for (const f of FILES) {
  const nm = f.pathname.split('/').slice(-2)[0];
  Deno.test(`${nm}: a refused league-week writes NOTHING before it continues (handler-level)`, async () => {
    const src = await Deno.readTextFile(f);
    // The refusal branches: the S9 gate (week-end) and the window refusal (both).
    const markers = nm === 'snapshot-week-end'
      ? ["if (baselineGate !== 'proceed') {", "if (windowPlan.action === 'refuse') {"]
      : ["if (earlyWindowPlan.action === 'refuse') {"];
    for (const m of markers) {
      const start = src.indexOf(m);
      assert(start >= 0, `${nm}: refusal branch not found: ${m}`);
      const end = src.indexOf('continue;', start);
      const body = src.slice(start, end);
      assertFalse(/\.(upsert|insert|update|delete)\(/.test(body),
        `${nm}: a refused league-week writes before it continues (${m})`);
    }
  });
}

Deno.test('S3: a clean success reports its work count, and the status rule clears a stale retrying (job-status unit tests)', async () => {
  const src = await Deno.readTextFile(FILES[0]);
  assert(src.includes("'success', retryAttempt, undefined, totalSnapshots);"), 'week-start success does not report its work count');
  const js = await Deno.readTextFile(new URL('../functions/_shared/job-status.ts', import.meta.url));
  assert(js.includes("existing?.status === 'retrying'"), 'the status rule does not clear a stale retrying');
});

Deno.test('snapshot-week-end: the S9 gate runs BEFORE the window-complete skip (the complete check reads CLOSE holders)', async () => {
  const src = await Deno.readTextFile(FILES[1]);
  const gate = src.indexOf('weekEndBaselineGate({');
  const complete = src.indexOf("if (coverage === 'complete') {");
  assert(gate > 0 && complete > 0, 'gate or complete skip not found');
  assert(gate < complete, 'the complete skip runs before the S9 gate, so a holder who sold out before close passes unchecked');
});

Deno.test('retrying is written ONLY when a retry was actually scheduled (both handlers)', async () => {
  for (const f of FILES) {
    const src = await Deno.readTextFile(f);
    assertFalse(/await scheduleRetry\(supabase, JOB_NAME, retryAttempt \+ 1\);\s*\n\s*await updateJobStatus\(supabase, JOB_NAME, 'retrying'/.test(src),
      `${f.pathname}: 'retrying' is written without checking that the retry was scheduled`);
    assert(src.includes("scheduled ? 'retrying' : 'failed'"), `${f.pathname}: retry status is not conditional on the schedule result`);
  }
});

Deno.test('trade ledger is read snapshot-consistently: server-side cut, keyset paging (both handlers)', async () => {
  for (const f of FILES) {
    const src = await Deno.readTextFile(f);
    assert(src.includes('readAllTrades(supabase, leagueId,'), `${f.pathname}: trades are not read through the paged reader`);
    assert(src.includes("q.gt('id', lastId)") && src.includes(".order('id')"), `${f.pathname}: the trade reader is not keyset-paged by id`);
    assert(src.includes("q.lt('created_at', cutIso)") && src.includes("q.lte('created_at', cutIso)"), `${f.pathname}: the trade cut is not applied server-side`);
    assertFalse(/\.range\(from/.test(src), `${f.pathname}: offset paging is back (a mid-run insert shifts pages)`);
  }
});

Deno.test("one league's failed or truncated matchups read does not abort the other leagues (both handlers)", async () => {
  for (const f of FILES) {
    const src = await Deno.readTextFile(f);
    assert(src.includes('rows = await readLeagueMatchupRows(supabase, league.id);'), `${f.pathname}: the per-league read is not isolated`);
  }
});

