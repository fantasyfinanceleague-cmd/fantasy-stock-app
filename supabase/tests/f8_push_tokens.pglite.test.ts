/**
 * F8 phase 2 (20261017000000): expo_push_token moves off user_profiles into the
 * owner-scoped push_tokens table, against REAL Postgres (PGlite = Postgres 16 in
 * WASM). NOT hermetic: the first run fetches npm:@electric-sql/pglite.
 * Run instructions: supabase/tests/README.md.
 *
 * The migration is loaded VERBATIM. The prior state is a minimal replica of
 * user_profiles as prod has it (the token column, its index, the prod SELECT /
 * INSERT / UPDATE policies, membership in supabase_realtime), with Supabase's
 * default table grants simulated, so the anon revoke is proven rather than assumed.
 *
 * What it proves, in the finding's own terms: before, any authenticated user reads
 * every token; after, a user reads, writes and deletes only their own row, anon
 * reaches nothing, the column is gone from the published table (the Realtime
 * vector), and push_tokens is not published.
 */
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';

const ROOT = new URL('../../', import.meta.url);
const MIGRATION = 'supabase/migrations/20261017000000_f8_push_tokens_relocation.sql';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c'; // no token

const SCHEMA = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
-- Supabase grants ALL on every new public table to the API roles; RLS is the barrier.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;

create table user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text, avatar text default '📊',
  expo_push_token text, notifications_enabled boolean default true);
create index idx_user_profiles_push_token on user_profiles(expo_push_token);
alter table user_profiles enable row level security;
-- The three prod policies (db-snapshot 2026-09-30).
create policy "Authenticated users can view profiles" on user_profiles
  for select to authenticated using (true);
create policy "Users can insert own profile" on user_profiles
  for insert with check (auth.uid() = id);
create policy "Users can update own profile" on user_profiles
  for update using (auth.uid() = id);

create publication supabase_realtime;
alter publication supabase_realtime add table user_profiles;
`;

// deno-lint-ignore no-explicit-any
type Row = any;

Deno.test({
  name: 'F8 phase 2: push_tokens relocation on real Postgres (PGlite)',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const db = new PGlite();
    const q = async (s: string, p: unknown[] = []) => (await db.query(s, p)).rows as Row[];
    const as = async <T>(role: string, sub: string | null, fn: () => Promise<T>): Promise<T> => {
      await db.exec(`set role ${role}`);
      await db.exec(`select set_config('request.jwt.claim.sub', '${sub ?? ''}', false)`);
      try { return await fn(); } finally { await db.exec('reset role').catch(() => {}); }
    };

    await db.exec(SCHEMA);
    await db.exec(`insert into auth.users (id) values ('${A}'), ('${B}'), ('${C}');
      insert into user_profiles (id, username, expo_push_token) values
        ('${A}', 'alice', 'ExponentPushToken[aaaa]'),
        ('${B}', 'bob',   'ExponentPushToken[bbbb]'),
        ('${C}', 'carol', null);`);

    await t.step('BEFORE: the finding reproduces (A reads B\'s token)', async () => {
      const rows = await as('authenticated', A, () =>
        q(`select expo_push_token from user_profiles where id = $1`, [B]));
      assertEquals(rows[0].expo_push_token, 'ExponentPushToken[bbbb]');
    });

    await db.exec(await Deno.readTextFile(new URL(MIGRATION, ROOT)));

    await t.step('backfill: every non-null token moved, keyed by user; nulls skipped', async () => {
      const rows = await q(`select user_id::text, token from push_tokens order by user_id`);
      assertEquals(rows, [
        { user_id: A, token: 'ExponentPushToken[aaaa]' },
        { user_id: B, token: 'ExponentPushToken[bbbb]' },
      ]);
    });

    await t.step('the column is gone from user_profiles (closes the Realtime vector)', async () => {
      const cols = await q(`select column_name from information_schema.columns
        where table_name = 'user_profiles' and column_name = 'expo_push_token'`);
      assertEquals(cols.length, 0);
      // Cross-user profile reads still work: username/avatar are a product requirement.
      const rows = await as('authenticated', A, () =>
        q(`select username, avatar, notifications_enabled from user_profiles where id = $1`, [B]));
      assertEquals(rows[0].username, 'bob');
    });

    await t.step('push_tokens is NOT in supabase_realtime; user_profiles still is', async () => {
      const pub = await q(`select tablename from pg_publication_tables
        where pubname = 'supabase_realtime' order by tablename`);
      assertEquals(pub.map((r) => r.tablename), ['user_profiles']);
    });

    await t.step('owner-only read: A sees only A, never B', async () => {
      const rows = await as('authenticated', A, () => q(`select user_id::text, token from push_tokens`));
      assertEquals(rows, [{ user_id: A, token: 'ExponentPushToken[aaaa]' }]);
    });

    await t.step('owner-only writes: A cannot insert, update or delete B\'s row', async () => {
      await assertRejects(
        () => as('authenticated', A, () =>
          q(`insert into push_tokens (user_id, token) values ($1, 'ExponentPushToken[evil]')`, [C])),
        Error, 'row-level security');
      const upd = await as('authenticated', A, () =>
        db.query(`update push_tokens set token = 'ExponentPushToken[evil]' where user_id = $1`, [B]));
      assertEquals(upd.affectedRows, 0);
      const del = await as('authenticated', A, () =>
        db.query(`delete from push_tokens where user_id = $1`, [B]));
      assertEquals(del.affectedRows, 0);
      const b = await q(`select token from push_tokens where user_id = $1`, [B]);
      assertEquals(b[0].token, 'ExponentPushToken[bbbb]');
    });

    await t.step('the 1.1.0 client shapes work for the owner: upsert, then logout delete', async () => {
      // savePushToken: upsert on user_id (a new device for A, then a first token for C).
      await as('authenticated', A, () => q(
        `insert into push_tokens (user_id, token, updated_at) values ($1, 'ExponentPushToken[a2]', now())
         on conflict (user_id) do update set token = excluded.token, updated_at = excluded.updated_at`, [A]));
      await as('authenticated', C, () => q(
        `insert into push_tokens (user_id, token, updated_at) values ($1, 'ExponentPushToken[cccc]', now())
         on conflict (user_id) do update set token = excluded.token, updated_at = excluded.updated_at`, [C]));
      assertEquals((await q(`select token from push_tokens where user_id = $1`, [A]))[0].token, 'ExponentPushToken[a2]');
      // removePushToken: delete own row.
      const del = await as('authenticated', C, () => db.query(`delete from push_tokens where user_id = $1`, [C]));
      assertEquals(del.affectedRows, 1);
    });

    await t.step('anon reaches nothing: every privilege revoked, not just RLS-empty', async () => {
      await assertRejects(() => as('anon', null, () => q(`select * from push_tokens`)), Error, 'permission denied');
      await assertRejects(
        () => as('anon', null, () => q(`insert into push_tokens (user_id, token) values ($1, 'x')`, [A])),
        Error, 'permission denied');
      const grants = await q(`select privilege_type from information_schema.role_table_grants
        where table_name = 'push_tokens' and grantee = 'anon'`);
      assertEquals(grants.length, 0);
    });

    await t.step('service_role (send-notification\'s admin client) reads any token', async () => {
      // service_role bypasses RLS in Supabase via BYPASSRLS; PGlite's replica role
      // lacks that attribute, so grant it here the way Supabase defines the role.
      await db.exec(`alter role service_role bypassrls`);
      const rows = await as('service_role', null, () =>
        q(`select token from push_tokens where user_id = $1`, [B]));
      assertEquals(rows[0].token, 'ExponentPushToken[bbbb]');
    });

    await t.step('deleting the auth user cascades the token away', async () => {
      await q(`delete from user_profiles where id = $1`, [B]);
      await q(`delete from auth.users where id = $1`, [B]);
      const rows = await q(`select 1 from push_tokens where user_id = $1`, [B]);
      assert(rows.length === 0);
    });
  },
});
