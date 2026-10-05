/**
 * 20261028000000_matchups_baseline_marker.sql against REAL Postgres (PGlite =
 * Postgres 16 in WASM). NOT hermetic: the first run fetches
 * npm:@electric-sql/pglite. Run instructions: supabase/tests/README.md.
 *
 * The migration is loaded VERBATIM onto a replica of matchups. Supabase's default
 * privileges are simulated first (anon, authenticated and service_role get ALL on
 * new tables), so the grant assertions prove the explicit revokes work. Clients
 * keep SELECT (members read the league's matchups). Only service_role may set the
 * marker.
 */
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';

const ROOT = new URL('../../', import.meta.url);
const MIGRATION = await Deno.readTextFile(new URL('supabase/migrations/20261028000000_matchups_baseline_marker.sql', ROOT));

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
create table matchups (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null, week_number int not null, team1_user_id text, team2_user_id text,
  week_start timestamptz, week_end timestamptz, created_at timestamptz default now());
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
  name: 'matchups.baseline_completed_at (20261028000000) on real Postgres (PGlite)',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const db = new PGlite();
    await db.exec(SCHEMA);
    // Before the migration, the defaults give clients table-level writes.
    await db.exec(MIGRATION);
    const LEAGUE = (await db.query<{ league_id: string }>(
      "insert into matchups (league_id, week_number) values (gen_random_uuid(), 1) returning league_id")).rows[0].league_id;

    await t.step('the column exists, is nullable, and defaults to NULL (no marker until week-start sets it)', async () => {
      const r = await db.query<{ is_nullable: string; column_default: string | null }>(
        "select is_nullable, column_default from information_schema.columns where table_name='matchups' and column_name='baseline_completed_at'");
      assertEquals(r.rows[0].is_nullable, 'YES');
      assertEquals(r.rows[0].column_default, null);
      const n = await db.query<{ n: number }>("select count(*)::int as n from matchups where baseline_completed_at is not null");
      assertEquals(n.rows[0].n, 0);
    });

    await t.step('anon and authenticated hold NO write privilege on matchups (table or column level)', async () => {
      for (const role of ['anon', 'authenticated']) {
        for (const priv of ['INSERT', 'UPDATE', 'DELETE']) {
          const r = await db.query<{ ok: boolean }>(`select has_table_privilege($1, 'public.matchups', $2) as ok`, [role, priv]);
          assert(!r.rows[0].ok, `${role} still has ${priv} on matchups`);
        }
        const c = await db.query<{ ok: boolean }>(
          `select has_column_privilege($1, 'public.matchups', 'baseline_completed_at', 'UPDATE') as ok`, [role]);
        assert(!c.rows[0].ok, `${role} can UPDATE the marker column`);
      }
    });

    await t.step('authenticated keeps SELECT (members read their league matchups)', async () => {
      const r = await db.query<{ ok: boolean }>("select has_table_privilege('authenticated','public.matchups','SELECT') as ok");
      assert(r.rows[0].ok, 'the migration removed authenticated SELECT');
    });

    await t.step('service_role can set the marker', async () => {
      await db.exec("select set_config('request.jwt.claim.role', 'service_role', false)");
      await asRole(db, 'service_role',
        "update matchups set baseline_completed_at = now() where league_id = $1 and week_number = 1", [LEAGUE]);
      await db.exec("select set_config('request.jwt.claim.role', '', false)");
      const r = await db.query<{ n: number }>("select count(*)::int as n from matchups where baseline_completed_at is not null");
      assertEquals(r.rows[0].n, 1);
    });

    await t.step('an authenticated client that tries to set the marker is denied with 42501 and nothing changes', async () => {
      const err = await assertRejects(() => asRole(db, 'authenticated',
        "update matchups set baseline_completed_at = now() where league_id = $1", [LEAGUE])) as Error & { code?: string };
      assertEquals(err.code, '42501');
    });

    await t.step('anon is denied an UPDATE with 42501 too', async () => {
      const err = await assertRejects(() => asRole(db, 'anon',
        "update matchups set week_number = 2 where league_id = $1", [LEAGUE])) as Error & { code?: string };
      assertEquals(err.code, '42501');
    });

    await db.close();
  },
});
