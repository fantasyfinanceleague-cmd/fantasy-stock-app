/**
 * 20261028000000_week_baselines.sql and 20261028000001_cron_job_runs.sql against
 * REAL Postgres (PGlite = Postgres 16 in WASM). NOT hermetic: the first run fetches
 * npm:@electric-sql/pglite. Run instructions: supabase/tests/README.md.
 *
 * Both migrations are loaded VERBATIM. Supabase's default privileges are simulated
 * (anon, authenticated and service_role get ALL on new public tables), so the
 * grant assertions prove the explicit per-role revokes work. REVOKE ... FROM PUBLIC
 * alone would fail them. Also proves: RLS on, service_role-only access, and that the
 * run log is append-only for every role, including the superuser.
 */
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';

const ROOT = new URL('../../', import.meta.url);
const mig = (name: string) => Deno.readTextFile(new URL(`supabase/migrations/${name}`, ROOT));
const WEEK_BASELINES = '20261028000000_week_baselines.sql';
const CRON_RUNS = '20261028000001_cron_job_runs.sql';

const SCHEMA = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  ) $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
-- Supabase default privileges: new public tables get ALL for these three roles.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
create table leagues (id uuid primary key default gen_random_uuid(), name text);
`;

async function asRole(db: PGlite, role: string, sql: string, params: unknown[] = []) {
  await db.exec(`set role ${role}`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec('reset role');
  }
}

Deno.test({
  name: 'baseline marker (20261028000000) and append-only run log (20261028000001) on real Postgres (PGlite)',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const db = new PGlite();
    await db.exec(SCHEMA);
    await db.exec(await mig(WEEK_BASELINES));
    await db.exec(await mig(CRON_RUNS));
    const LEAGUE = (await db.query<{ id: string }>("insert into leagues (name) values ('L') returning id")).rows[0].id;

    await t.step('both tables have RLS enabled', async () => {
      const r = await db.query<{ relname: string; relrowsecurity: boolean }>(
        "select relname, relrowsecurity from pg_class where relname in ('week_baselines','cron_job_runs') order by relname");
      assertEquals(r.rows.map((x) => x.relrowsecurity), [true, true]);
    });

    await t.step('anon and authenticated have NO table privileges on either table (explicit revokes)', async () => {
      for (const role of ['anon', 'authenticated']) {
        for (const tbl of ['public.week_baselines', 'public.cron_job_runs']) {
          for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
            const r = await db.query<{ ok: boolean }>(
              `select has_table_privilege($1, $2, $3) as ok`, [role, tbl, priv]);
            assert(!r.rows[0].ok, `${role} still has ${priv} on ${tbl}`);
          }
        }
      }
    });

    await t.step('service_role keeps what the jobs need: week_baselines full, cron_job_runs SELECT+INSERT only', async () => {
      const wb = await db.query<{ ok: boolean }>("select has_table_privilege('service_role','public.week_baselines','UPDATE') as ok");
      assert(wb.rows[0].ok, 'service_role lost UPDATE on week_baselines (the marker upsert needs it)');
      const cr = await db.query<{ upd: boolean; ins: boolean }>(
        "select has_table_privilege('service_role','public.cron_job_runs','UPDATE') as upd, has_table_privilege('service_role','public.cron_job_runs','INSERT') as ins");
      assert(!cr.rows[0].upd, 'service_role can UPDATE the run log');
      assert(cr.rows[0].ins, 'service_role cannot INSERT the run log');
    });

    await t.step('anon is denied with 42501 on both tables', async () => {
      for (const tbl of ['week_baselines', 'cron_job_runs']) {
        const err = await assertRejects(() => asRole(db, 'anon', `select * from ${tbl}`)) as Error & { code?: string };
        assertEquals(err.code, '42501');
      }
    });

    await t.step('the trigger function is not executable by anon, authenticated or service_role', async () => {
      for (const role of ['anon', 'authenticated', 'service_role']) {
        const r = await db.query<{ ok: boolean }>(
          `select has_function_privilege($1, 'public.cron_job_runs_block_mutation()', 'EXECUTE') as ok`, [role]);
        assert(!r.rows[0].ok, `${role} can EXECUTE the trigger function`);
      }
    });

    await t.step('week_baselines: the marker upsert is idempotent on (league_id, week_number)', async () => {
      const row = (rows: number) => ({ l: LEAGUE, w: 3, rows });
      const up = (rows: number) => db.query(
        `insert into week_baselines (league_id, week_number, open_at, open_session_date, participants, rows_written)
         values ($1, $2, '2026-10-05T13:30:00Z', '2026-10-05', 6, $3)
         on conflict (league_id, week_number) do update set rows_written = excluded.rows_written, completed_at = now()`,
        [row(0).l, row(0).w, rows]);
      await up(14);
      await up(16);
      const r = await db.query<{ n: number; rows_written: number }>(
        'select count(*)::int as n, max(rows_written)::int as rows_written from week_baselines where league_id = $1', [LEAGUE]);
      assertEquals(r.rows[0], { n: 1, rows_written: 16 });
    });

    await t.step('cron_job_runs is append-only: UPDATE and DELETE raise, even as the superuser', async () => {
      await db.query(
        `insert into cron_job_runs (job_name, status, work, written, message) values ('snapshot-week-end', 'success', 3, true, 'work=3')`);
      await assertRejects(() => db.query("update cron_job_runs set work = 0 where job_name = 'snapshot-week-end'"),
        Error, 'append-only');
      await assertRejects(() => db.query("delete from cron_job_runs where job_name = 'snapshot-week-end'"),
        Error, 'append-only');
      const r = await db.query<{ work: number }>("select work from cron_job_runs where job_name = 'snapshot-week-end'");
      assertEquals(r.rows[0].work, 3);
    });

    await t.step('cron_job_runs cannot be TRUNCATED, even as the superuser', async () => {
      await assertRejects(() => db.query('truncate cron_job_runs'), Error, 'append-only');
    });

    await t.step('service_role positive path: the marker upsert and the run-log insert both succeed', async () => {
      await db.exec("select set_config('request.jwt.claim.role', 'service_role', false)");
      await asRole(db, 'service_role', `insert into week_baselines (league_id, week_number, open_at, open_session_date)
        values ($1, 9, '2026-10-05T13:30:00Z', '2026-10-05')
        on conflict (league_id, week_number) do update set rows_written = 1`, [LEAGUE]);
      await asRole(db, 'service_role', `insert into cron_job_runs (job_name, status, work, written) values ('snapshot-week-start', 'success', 0, false)`);
      await db.exec("select set_config('request.jwt.claim.role', '', false)");
      const r = await db.query<{ n: number }>("select count(*)::int as n from cron_job_runs where job_name = 'snapshot-week-start'");
      assertEquals(r.rows[0].n, 1);
    });

    await t.step('anon and authenticated cannot use the run-log identity sequence', async () => {
      for (const role of ['anon', 'authenticated']) {
        const r = await db.query<{ ok: boolean }>(
          `select has_sequence_privilege($1, 'public.cron_job_runs_id_seq', 'USAGE') as ok`, [role]);
        assert(!r.rows[0].ok, `${role} can use cron_job_runs_id_seq`);
      }
    });

    await t.step('cron_job_runs status is constrained to the terminal statuses (running is never logged)', async () => {
      await assertRejects(() => db.query(
        `insert into cron_job_runs (job_name, status, written) values ('x', 'running', true)`));
    });

    await db.close();
  },
});
