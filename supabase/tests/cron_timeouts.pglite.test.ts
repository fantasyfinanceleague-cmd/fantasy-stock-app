/**
 * 20261108000000_cron_explicit_timeouts.sql and 20261108000001_schedule_snapshot_retry_timeout.sql
 * against REAL Postgres (PGlite = Postgres 16 in WASM), with pg_cron stubbed.
 * NOT hermetic: the first run fetches npm:@electric-sql/pglite (see README.md).
 *   deno test --allow-read --allow-env supabase/tests/cron_timeouts.pglite.test.ts
 *
 * pg_cron, pg_net and vault are untestable here (CLAUDE.md "No local Postgres"), so
 * cron.job / cron.schedule / cron.unschedule are stubs with pg_cron's name-keyed
 * upsert semantics. That is enough for what is at stake: the migration's TEXT. Its
 * commands are never executed, only stored and compared.
 *
 * The live cron rows are seeded from supabase/tests/fixtures/cron_jobs_before_20261108.json (frozen; was docs/architecture/db-snapshot.json) (the six jobs
 * it captured) and from the two heal-cron migrations that postdate it, then the
 * migration runs over them. Every rescheduled command must equal its live
 * predecessor modulo the timeout: a copy that drifted (a missing X-Retry-Attempt
 * header, a changed URL) fails here before it can be pushed.
 *
 * It also holds the GUARD: no cron job that stays scheduled may lack an explicit
 * timeout (see `scheduledJobs`, tested against synthetic input so the guard itself
 * is proven to fail).
 */
import { assert, assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';

const ROOT = new URL('../../', import.meta.url);
const MIGRATIONS_DIR = new URL('supabase/migrations/', ROOT);
const mig = (name: string) => Deno.readTextFile(new URL(name, MIGRATIONS_DIR));
const TIMEOUT_MIGRATION = '20261108000000_cron_explicit_timeouts.sql';
const RETRY_MIGRATION = '20261108000001_schedule_snapshot_retry_timeout.sql';
const STRIP_TIMEOUT = /,?\s*timeout_milliseconds\s*:=\s*\d+/gi;
const norm = (cmd: string) => cmd.replace(STRIP_TIMEOUT, '').replace(/\s+/g, ' ').trim().toLowerCase();

// ---------------------------------------------------------------------------
// Pure: which cron jobs are still scheduled after the migrations, and with what
// ---------------------------------------------------------------------------

export interface ScheduledJob { name: string; schedule: string; command: string; file: string }

/**
 * Replay cron.schedule / cron.unschedule over migration files in order. A job whose
 * LAST event is an unschedule (sync-alpaca-orders) is gone and ignored. Only literal
 * names are tracked; names built at runtime (the retry jobs) are covered by the
 * function-body check instead.
 */
export function scheduledJobs(files: Array<{ name: string; sql: string }>): ScheduledJob[] {
  const live = new Map<string, ScheduledJob>();
  const ev = /cron\.(un)?schedule\(\s*'([^']+)'(?:\s*,\s*'([^']+)'\s*,\s*\$(\w*)\$([\s\S]*?)\$\4\$)?/dgi;
  for (const f of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    // Blank comment lines IN PLACE (same length) so a commented-out schedule is not
    // seen, while match offsets still index the original text, whose command keeps
    // its inline comments (the live row stores them verbatim).
    const blanked = f.sql.replace(/^[ \t]*--.*$/gm, (c) => ' '.repeat(c.length));
    for (const m of blanked.matchAll(ev)) {
      const [, un, name, schedule] = m;
      if (un) live.delete(name);
      else if (schedule !== undefined) {
        const [a, b] = m.indices![5]!;
        live.set(name, { name, schedule, command: f.sql.slice(a, b), file: f.name });
      }
    }
  }
  return [...live.values()];
}

/**
 * Jobs that POST over pg_net without an explicit timeout above the platform's 150 s
 * request idle timeout. Only net.http_post schedules are in scope: a plain-SQL job
 * (e.g. a purge of cron.job_run_details) has no pg_net request and no timeout to set.
 */
export function jobsWithoutTimeout(jobs: ScheduledJob[]): string[] {
  return jobs.filter((j) => {
    if (!/net\.http_post\s*\(/i.test(j.command)) return false;
    const m = /timeout_milliseconds\s*:=\s*(\d+)/i.exec(j.command);
    return !m || Number(m[1]) <= 150_000;
  }).map((j) => `${j.name} (${j.file})`);
}

async function migrationFiles() {
  const out: Array<{ name: string; sql: string }> = [];
  // readDir is NOT recursive: deferred/ is never read, as `supabase db push` ignores it.
  // A deferred cron joins the guard the moment it is promoted into migrations/.
  for await (const e of Deno.readDir(MIGRATIONS_DIR)) {
    if (e.isFile && e.name.endsWith('.sql')) out.push({ name: e.name, sql: await mig(e.name) });
  }
  return out;
}

Deno.test('GUARD: every cron job still scheduled after all migrations has an explicit timeout above 150 s', async () => {
  const jobs = scheduledJobs(await migrationFiles());
  assert(jobs.length >= 9, `expected the nine rescheduled jobs at least, parsed ${jobs.length}`);
  assertEquals(jobsWithoutTimeout(jobs), [], 'a cron http_post without timeout_milliseconds makes net._http_response unreadable (success-signals #8)');
});

Deno.test('GUARD self-test: it fails an http_post with no/short timeout; ignores unscheduled, commented-out and plain-SQL jobs', () => {
  const files = [
    { name: '1_a.sql', sql: `select cron.schedule('bare', '* * * * *', $$ select net.http_post(url := 'x') $$);` },
    { name: '2_b.sql', sql: `select cron.schedule('short', '* * * * *', $$ select net.http_post(url := 'x', timeout_milliseconds := 30000) $$);` },
    { name: '3_c.sql', sql: `select cron.schedule('ok', '* * * * *', $$ select net.http_post(url := 'x', timeout_milliseconds := 180000) $$);` },
    // scheduled, then unscheduled and never rescheduled: gone, must be ignored
    { name: '4_d.sql', sql: `select cron.schedule('gone', '* * * * *', $$ select net.http_post(url := 'x') $$);\nselect cron.unschedule('gone');` },
    // a later reschedule of 'bare' with a timeout supersedes the earlier one
    { name: '5_e.sql', sql: `select cron.unschedule('bare') where exists (select 1);\nselect cron.schedule('bare', '* * * * *', $$ select net.http_post(url := 'x', timeout_milliseconds := 180000) $$);` },
    // a commented-out schedule is not a schedule
    { name: '6_f.sql', sql: `-- select cron.schedule('commented', '* * * * *', $$ select net.http_post(url := 'x') $$);` },
    // plain SQL, no pg_net request: NOT in scope (e.g. a daily purge of cron.job_run_details)
    { name: '7_g.sql', sql: `select cron.schedule('purge-run-details', '0 3 * * *', $$ delete from cron.job_run_details where end_time < now() - interval '7 days' $$);` },
    // the sweep shape: sub-minute schedule, http_post guarded by a WHERE EXISTS, with a timeout
    { name: '8_h.sql', sql: `select cron.schedule('sweep', '10 seconds', $cmd$ select net.http_post(url := 'x', timeout_milliseconds := 180000) where exists (select 1) $cmd$);` },
  ];
  const jobs = scheduledJobs(files);
  assertEquals(jobs.map((j) => j.name).sort(), ['bare', 'ok', 'purge-run-details', 'short', 'sweep']);
  assertEquals(jobsWithoutTimeout(jobs), ['short (2_b.sql)']);
  // and without the later reschedule, 'bare' is flagged
  assertEquals(jobsWithoutTimeout(scheduledJobs(files.filter((f) => f.name !== '5_e.sql'))).sort(), ['bare (1_a.sql)', 'short (2_b.sql)']);
});

Deno.test('GUARD: the retry function\'s latest definition puts a timeout on EVERY generated http_post', async () => {
  const files = (await migrationFiles()).sort((a, b) => a.name.localeCompare(b.name));
  const defs = files.filter((f) => /CREATE OR REPLACE FUNCTION\s+(public\.)?schedule_snapshot_retry/i.test(f.sql));
  const latest = defs.at(-1)!;
  assertEquals(latest.name, RETRY_MIGRATION);
  const code = latest.sql.replace(/^\s*--.*$/gm, ''); // header prose mentions both
  const posts = (code.match(/net\.http_post\(/g) ?? []).length;
  const timeouts = (code.match(/timeout_milliseconds := 180000/g) ?? []).length;
  assertEquals(posts, 2, 'one http_post per job branch');
  assertEquals(timeouts, posts);
});

// ---------------------------------------------------------------------------
// PGlite: the migration over the live rows
// ---------------------------------------------------------------------------

const STUB = `
create schema cron;
create table cron.job (jobid serial primary key, jobname text unique, schedule text, command text, active boolean default true);
-- pg_cron semantics: schedule(name, ...) upserts by name; unschedule(name) deletes it.
create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql as $$
  insert into cron.job(jobname, schedule, command) values (p_name, p_schedule, p_command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid $$;
create function cron.unschedule(p_name text) returns boolean language plpgsql as $$
begin delete from cron.job where jobname = p_name; return found; end $$;
create role service_role; create role anon; create role authenticated;
create table public.cron_job_status (id uuid primary key default gen_random_uuid(), job_name text not null,
  run_date date not null default current_date, status text not null check (status in ('running','success','failed','retrying')),
  attempt_number int default 1, error_message text, created_at timestamptz default now(), updated_at timestamptz default now(),
  unique (job_name, run_date));
`;

interface LiveJob { jobname: string; schedule: string; command: string }

async function liveRows(): Promise<LiveJob[]> {
  // A FROZEN baseline: the live rows before 20261108000000 was applied. Reading the
  // evolving docs/architecture/db-snapshot.json broke this test on the first re-capture
  // after the migration (it then contained the post-migration jobs).
  const snap = JSON.parse(await Deno.readTextFile(new URL('supabase/tests/fixtures/cron_jobs_before_20261108.json', ROOT)));
  const rows: LiveJob[] = snap.cronJobs.map((j: LiveJob) => ({ jobname: j.jobname, schedule: j.schedule, command: j.command }));
  // The heal crons postdate the snapshot (#86 / #98): take their commands from the migrations that schedule them.
  const have = new Set(rows.map((r) => r.jobname));
  // Replay only the migrations BEFORE the one under test, or its reschedules would win.
  const prior = (await migrationFiles()).filter((f) => f.name < TIMEOUT_MIGRATION);
  const later = scheduledJobs(prior).filter((j) =>
    !have.has(j.name) && (j.file === '20261019000000_process_week_results_heal_crons.sql' || j.file === '20261028000002_snapshot_week_end_heal_cron.sql'));
  for (const j of later) rows.push({ jobname: j.name, schedule: j.schedule, command: j.command });
  return rows;
}

async function freshDb(): Promise<{ db: PGlite; live: LiveJob[] }> {
  const db = new PGlite();
  await db.exec(STUB);
  const live = await liveRows();
  for (const r of live) await db.query('select cron.schedule($1,$2,$3)', [r.jobname, r.schedule, r.command]);
  return { db, live };
}

const EXPECTED_JOBS = [
  'enrich_symbols_10min', 'process-weekly-matchups', 'process-weekly-matchups-heal-2200z', 'process-weekly-matchups-heal-sat',
  'refresh_market_calendar_daily', 'refresh_symbols_daily', 'snapshot-week-end', 'snapshot-week-end-heal', 'snapshot-week-start',
];

Deno.test('the nine live jobs are the ones the migration reschedules (snapshot + heal migrations)', async () => {
  const { live } = await freshDb();
  assertEquals(live.map((l) => l.jobname).sort(), EXPECTED_JOBS);
});

Deno.test('rescheduling: same schedule, same command modulo the timeout, timeout 180000, no duplicates', async () => {
  const { db, live } = await freshDb();
  await db.exec(await mig(TIMEOUT_MIGRATION));
  const after = (await db.query<LiveJob>('select jobname, schedule, command from cron.job order by jobname')).rows;
  assertEquals(after.map((a) => a.jobname), EXPECTED_JOBS, 'no job added or dropped');
  for (const a of after) {
    const before = live.find((l) => l.jobname === a.jobname)!;
    assertEquals(a.schedule, before.schedule, `${a.jobname}: schedule changed`);
    assertEquals(norm(a.command), norm(before.command), `${a.jobname}: command drifted from the live row`);
    assertStringIncludes(a.command, 'timeout_milliseconds := 180000');
    assertEquals((a.command.match(/timeout_milliseconds/g) ?? []).length, 1, `${a.jobname}: exactly one timeout`);
  }
});

Deno.test('the key comes from the vault; no key literal is in any rescheduled command', async () => {
  const { db } = await freshDb();
  await db.exec(await mig(TIMEOUT_MIGRATION));
  const cmds = (await db.query<{ command: string }>('select command from cron.job')).rows;
  for (const { command } of cmds) {
    assertStringIncludes(command.toLowerCase(), "vault.decrypted_secrets where name = 'cron_apikey'");
    assert(!/eyJ[A-Za-z0-9_-]{20,}|sb_secret_|service_role_key/i.test(command), 'key-shaped literal in a cron command');
  }
});

Deno.test('the snapshot-week-end-heal command keeps its X-Retry-Attempt: 3 header', async () => {
  const { db } = await freshDb();
  await db.exec(await mig(TIMEOUT_MIGRATION));
  const { rows } = await db.query<{ command: string }>(`select command from cron.job where jobname = 'snapshot-week-end-heal'`);
  assertStringIncludes(rows[0].command, `'X-Retry-Attempt', '3'`);
});

Deno.test('idempotent: a second run changes nothing', async () => {
  const { db } = await freshDb();
  await db.exec(await mig(TIMEOUT_MIGRATION));
  const first = (await db.query('select jobname, schedule, command from cron.job order by jobname')).rows;
  await db.exec(await mig(TIMEOUT_MIGRATION));
  assertEquals((await db.query('select jobname, schedule, command from cron.job order by jobname')).rows, first);
});

Deno.test('PRE-FLIGHT: a job missing live aborts the migration and changes NOTHING', async () => {
  const { db } = await freshDb();
  await db.query(`select cron.unschedule('snapshot-week-end-heal')`);
  const before = (await db.query('select jobname, command from cron.job order by jobname')).rows;
  const sql = await mig(TIMEOUT_MIGRATION);
  await assertRejects(() => db.exec(sql), Error, 'is not scheduled live');
  assertEquals((await db.query('select jobname, command from cron.job order by jobname')).rows, before);
});

Deno.test('PRE-FLIGHT: a live schedule that differs aborts the migration and changes NOTHING', async () => {
  const { db } = await freshDb();
  await db.query(`update cron.job set schedule = '0 3 * * 5' where jobname = 'process-weekly-matchups'`);
  const before = (await db.query('select jobname, command from cron.job order by jobname')).rows;
  const sql = await mig(TIMEOUT_MIGRATION);
  await assertRejects(() => db.exec(sql), Error, 'is scheduled "0 3 * * 5" live');
  assertEquals((await db.query('select jobname, command from cron.job order by jobname')).rows, before);
});

Deno.test('PRE-FLIGHT: a PAUSED job (active = false) aborts the migration: it must not be silently re-enabled', async () => {
  const { db } = await freshDb();
  await db.query(`update cron.job set active = false where jobname = 'enrich_symbols_10min'`);
  const before = (await db.query('select jobname, command, active from cron.job order by jobname')).rows;
  const sql = await mig(TIMEOUT_MIGRATION);
  await assertRejects(() => db.exec(sql), Error, 'is paused');
  assertEquals((await db.query('select jobname, command, active from cron.job order by jobname')).rows, before);
});

Deno.test('the migration is ONE statement, so it is atomic however the CLI sends it', async () => {
  // db.query uses the extended protocol, which refuses more than one command: the same
  // restriction the CLI's per-statement prepared sends hit (CLAUDE.md, "atomic" trap).
  const { db } = await freshDb();
  await db.query(await mig(TIMEOUT_MIGRATION));
  const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from cron.job where command like '%timeout_milliseconds := 180000%'`);
  assertEquals(rows[0].n, 9);
});

Deno.test('a failure MID-SEQUENCE rolls every job back (no job is left unscheduled)', async () => {
  const { db, live } = await freshDb();
  // The fifth reschedule blows up, after four jobs were already unscheduled and rescheduled.
  await db.exec(`
    create or replace function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language plpgsql as $$
    begin
      if p_name = 'snapshot-week-end' then raise exception 'simulated cron.schedule failure'; end if;
      insert into cron.job(jobname, schedule, command) values (p_name, p_schedule, p_command)
      on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command;
      return 1;
    end $$;`);
  const before = (await db.query('select jobname, schedule, command from cron.job order by jobname')).rows;
  await assertRejects(async () => await db.query(await mig(TIMEOUT_MIGRATION)), Error, 'simulated cron.schedule failure');
  assertEquals((await db.query('select jobname, schedule, command from cron.job order by jobname')).rows, before);
  assertEquals(before.length, live.length);
});

// ---------------------------------------------------------------------------
// The retry function
// ---------------------------------------------------------------------------

async function withRetryFn(db: PGlite, upTo: string) {
  // The prior definition, then the one under test. Loaded VERBATIM.
  const prior = await mig('20260727000000_fix_schedule_snapshot_retry_cron_expression.sql');
  const start = prior.indexOf('CREATE OR REPLACE FUNCTION schedule_snapshot_retry(');
  const end = prior.indexOf("';\n", prior.indexOf('COMMENT ON FUNCTION schedule_snapshot_retry')) + 3;
  await db.exec(prior.slice(start, end));
  if (upTo === 'new') await db.exec(await mig(RETRY_MIGRATION));
}

Deno.test('schedule_snapshot_retry (before): the generated one-shot job has NO timeout (the defect this fixes)', async () => {
  const { db } = await freshDb();
  await withRetryFn(db, 'old');
  await db.query(`select schedule_snapshot_retry('snapshot-week-end', 2)`);
  const { rows } = await db.query<{ command: string }>(`select command from cron.job where jobname = 'snapshot-week-end-retry-2'`);
  assert(!rows[0].command.includes('timeout_milliseconds'));
});

for (const job of ['snapshot-week-end', 'snapshot-week-start']) {
  Deno.test(`schedule_snapshot_retry (after) ${job}: one-shot job carries the timeout, header, vault key; 'retrying' is recorded`, async () => {
    const { db } = await freshDb();
    await withRetryFn(db, 'new');
    await db.query('select schedule_snapshot_retry($1, 2)', [job]);
    const { rows } = await db.query<{ command: string; schedule: string }>('select command, schedule from cron.job where jobname = $1', [`${job}-retry-2`]);
    assertEquals(rows.length, 1);
    assertStringIncludes(rows[0].command, 'timeout_milliseconds := 180000');
    assertStringIncludes(rows[0].command, `'X-Retry-Attempt', '2'`);
    assertStringIncludes(rows[0].command, `functions/v1/${job}'`);
    assertStringIncludes(rows[0].command, `cron.unschedule('${job}-retry-2')`);
    assertStringIncludes(rows[0].command, "name = 'cron_apikey'");
    assert(/^\d{1,2} \d{1,2} \d{1,2} \d{1,2} \*$/.test(rows[0].schedule), `five-field cron expression, got ${rows[0].schedule}`);
    const st = await db.query<{ status: string; attempt_number: number }>('select status, attempt_number from cron_job_status where job_name = $1', [job]);
    assertEquals(st.rows, [{ status: 'retrying', attempt_number: 2 }]);
  });
}

Deno.test('schedule_snapshot_retry (after): an unknown job still raises, and records nothing', async () => {
  const { db } = await freshDb();
  await withRetryFn(db, 'new');
  await assertRejects(() => db.query(`select schedule_snapshot_retry('nope', 1)`), Error, 'Unknown job name');
  assertEquals((await db.query('select 1 from cron_job_status')).rows.length, 0);
});

Deno.test('schedule_snapshot_retry (after): search_path pin and security definer are carried forward', async () => {
  const { db } = await freshDb();
  await withRetryFn(db, 'new');
  const { rows } = await db.query<{ proconfig: string[]; prosecdef: boolean }>(
    `select proconfig, prosecdef from pg_proc where proname = 'schedule_snapshot_retry'`);
  assertEquals(rows[0].proconfig, ['search_path=public']);
  assertEquals(rows[0].prosecdef, true);
});
