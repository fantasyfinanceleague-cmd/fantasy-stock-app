/**
 * 20261116000001: the daily purge of public.rate_limit_counters, against REAL
 * Postgres (PGlite). pg_cron is not available in PGlite, so cron.job /
 * cron.schedule / cron.unschedule are stubbed with pg_cron's by-name semantics;
 * the migration is loaded VERBATIM (twice: it must be idempotent) and the
 * scheduled COMMAND is then executed exactly as pg_cron would run it.
 *
 * What it proves: one job, named, daily, plain SQL (no net.http_post, so the
 * timeout rule does not apply); and the command deletes only dead windows --
 * rows older than two days go, every live window survives, including the
 * current hourly window check_usernames uses and rows from yesterday.
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';

const ROOT = new URL('../../', import.meta.url);
const MIGRATION = 'supabase/migrations/20261116000001_purge_rate_limit_counters.sql';

Deno.test({
  name: '20261116000001: purge_rate_limit_counters (PGlite, stub pg_cron)',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const db = new PGlite();
    const q = async (s: string) => (await db.query(s)).rows as Record<string, unknown>[];
    await db.exec(`
      create schema cron;
      create table cron.job (jobid serial primary key, jobname text unique, schedule text, command text);
      create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql as $$
        insert into cron.job (jobname, schedule, command) values (p_name, p_schedule, p_command)
        on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
        returning jobid $$;
      create function cron.unschedule(p_name text) returns boolean language sql as $$
        delete from cron.job where jobname = p_name returning true $$;
      create table public.rate_limit_counters (bucket text not null, subject text not null,
        window_start timestamptz not null, hits int not null default 0, primary key (bucket, subject, window_start));
      alter table public.rate_limit_counters enable row level security;
      insert into public.rate_limit_counters values
        ('quote', 'user:a', now() - interval '30 days', 5),
        ('quote', 'user:a', now() - interval '3 days', 5),
        ('quote', 'user:a', now() - interval '2 days 1 minute', 5),
        ('quote', 'user:a', now() - interval '1 day', 5),
        ('quote', 'user:a', date_trunc('minute', now()), 1),
        ('check-usernames-hour', 'user:a', to_timestamp(floor(extract(epoch from now()) / 3600) * 3600), 7),
        ('ticker-quotes-anon', 'all', date_trunc('minute', now()), 3);
    `);
    const migration = await Deno.readTextFile(new URL(MIGRATION, ROOT));
    await db.exec(migration);
    await db.exec(migration);

    let command = '';
    await t.step('exactly one daily, named, plain-SQL job (idempotent re-apply)', async () => {
      const jobs = await q(`select jobname, schedule, command from cron.job`);
      assertEquals(jobs.length, 1);
      assertEquals(jobs[0].jobname, 'purge_rate_limit_counters');
      assertEquals(jobs[0].schedule, '37 4 * * *');
      command = String(jobs[0].command);
      assert(!/net\.http_post/.test(command), 'a plain-SQL purge must not call pg_net');
      assert(/delete from public\.rate_limit_counters/.test(command));
    });

    await t.step('the command deletes only windows older than two days', async () => {
      await db.exec(command);
      const left = await q(`select bucket, (now() - window_start) < interval '2 days' as live
        from public.rate_limit_counters order by window_start`);
      assertEquals(left.length, 4, 'the three dead windows go; four live ones stay');
      assert(left.every((r) => r.live === true));
      assertEquals((await q(`select hits from public.rate_limit_counters where bucket = 'check-usernames-hour'`))[0].hits, 7,
        'the current hourly check_usernames window survives');
    });
  },
});
