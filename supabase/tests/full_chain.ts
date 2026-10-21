/**
 * The WHOLE migration chain on PGlite (shared helper, not a test).
 *
 * Most suites here load a hand-written replica plus the few migrations under
 * test. That proves a function's own logic but not that nothing ELSE in the live
 * schema (a trigger from another feature, a later CHECK) refuses it. This loads
 * every file in supabase/migrations/ (not deferred/) in version order, the way
 * `supabase db push` applied them, on top of:
 *
 *   PLATFORM  what Supabase provides before any migration: the API roles with
 *             Supabase's default per-role grants (so `REVOKE ... FROM PUBLIC`
 *             alone visibly fails a proacl check, CLAUDE.md), auth.users +
 *             auth.uid()/role()/jwt(), the supabase_realtime publication, and
 *             stubs for pg_cron (cron.schedule/unschedule over a cron.job
 *             table), pg_net (net.http_post) and vault (secrets +
 *             decrypted_secrets + create_secret). `create extension` lines are
 *             stripped: the stubs stand in for them.
 *   DASHBOARD the tables prod created by hand before migrations tracked them
 *             (drafts, draft_sessions, draft_settings, symbols), with the
 *             columns the first migration that touches each one expects.
 *             Prod's drafts.id is a uuid (20261005000000's league_activity
 *             UNIONs it with trades.id).
 *   ORDER     20250818225829_create_leagues runs FIRST: 20250118000000
 *             (create_trades) references leagues, which existed in prod before
 *             either file was tracked. Two seed-data files that insert rows for
 *             prod-only league ids (20260125100000/01) are skipped: they create
 *             no schema.
 *
 * Without the baseline 59 of 160 migrations fail on PGlite. With it, all apply.
 * `untilBefore` stops the chain before a version (e.g. to prove a hazard the
 * next migration fixes, then apply the rest with `from`).
 */
import type { PGlite } from 'npm:@electric-sql/pglite@0.2';

const MIGRATIONS = new URL('../migrations/', import.meta.url);

export const PLATFORM = `
create role anon; create role authenticated; create role service_role;
create role supabase_admin; create role authenticator; create role supabase_auth_admin;
alter role service_role bypassrls;
create schema auth; create schema extensions; create schema cron; create schema net; create schema vault;
create table auth.users (id uuid primary key, email text, created_at timestamptz default now(), updated_at timestamptz,
  aud text, role text, instance_id uuid, raw_user_meta_data jsonb, raw_app_meta_data jsonb,
  email_confirmed_at timestamptz, deleted_at timestamptz, is_anonymous boolean default false);
-- Supabase's own definitions: the legacy per-claim GUC, else the claims JSON.
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
create function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
-- Supabase: every new table/function is born with explicit per-role grants.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
create publication supabase_realtime;
create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text,
  active boolean default true);
create table cron.job_run_details (runid bigserial, jobid bigint, status text, start_time timestamptz,
  end_time timestamptz, return_message text);
create function cron.schedule(job_name text, schedule text, command text) returns bigint language plpgsql as $$
declare v bigint; begin
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid into v; return v; end $$;
create function cron.unschedule(job_name text) returns boolean language plpgsql as $$
begin delete from cron.job where jobname = job_name; return found; end $$;
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}',
  headers jsonb default '{}', timeout_milliseconds int default 5000) returns bigint
  language sql as $$ select 1::bigint $$;
create table net._http_response (id bigint, status_code int, content text, created timestamptz,
  error_msg text, timed_out boolean);
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text,
  description text);
create view vault.decrypted_secrets as
  select id, name, secret as decrypted_secret, description from vault.secrets;
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
  returns uuid language sql as $$
  insert into vault.secrets (name, secret, description) values (new_name, new_secret, new_description) returning id $$;
`;

export const DASHBOARD = `
create table public.drafts (id uuid primary key default gen_random_uuid(), league_id uuid, user_id text,
  symbol text, entry_price numeric, quantity numeric, round int, pick_number int,
  created_at timestamptz default now());
create table public.draft_sessions (id serial primary key, league_id uuid);
create table public.draft_settings (id serial primary key);
create table public.symbols (symbol text primary key, name text, exchange text, is_etf boolean default false,
  active boolean default true, updated_at timestamptz default now());
`;

const FIRST = ['20250818225829_create_leagues.sql'];
const SKIP = ['20260125100000_add_test_completed_season.sql', '20260125100001_add_more_test_seasons.sql'];

export async function migrationFiles(): Promise<string[]> {
  const files: string[] = [];
  for await (const e of Deno.readDir(MIGRATIONS)) {
    if (e.isFile && /^\d{14}_.*\.sql$/.test(e.name)) files.push(e.name);
  }
  return files.sort();
}

const strip = (sql: string) =>
  sql.replace(/create extension[^;]*;/gi, '').replace(/comment on extension[^;]*;/gi, '');

export const readMigration = (name: string) => Deno.readTextFile(new URL(name, MIGRATIONS));

/** Apply PLATFORM + DASHBOARD + every migration with version < untilBefore (all when omitted). */
export async function loadChain(db: PGlite, opts: { untilBefore?: string } = {}): Promise<string[]> {
  await db.exec(PLATFORM);
  await db.exec(DASHBOARD);
  for (const f of FIRST) await db.exec(strip(await readMigration(f)));
  const applied = [...FIRST];
  for (const f of await migrationFiles()) {
    if (FIRST.includes(f) || SKIP.includes(f)) continue;
    if (opts.untilBefore && f >= opts.untilBefore) break;
    try {
      await db.exec(strip(await readMigration(f)));
    } catch (e) {
      throw new Error(`full chain: ${f} failed: ${(e as Error).message}`);
    }
    applied.push(f);
  }
  return applied;
}

/** Apply every migration with version >= from (after loadChain({ untilBefore: from })). */
export async function applyFrom(db: PGlite, from: string): Promise<string[]> {
  const applied: string[] = [];
  for (const f of await migrationFiles()) {
    if (f < from || FIRST.includes(f) || SKIP.includes(f)) continue;
    await db.exec(strip(await readMigration(f)));
    applied.push(f);
  }
  return applied;
}
