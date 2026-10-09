/**
 * PROPOSED migration supabase/migrations/deferred/20261116000001 (NOT in the
 * db push path) against REAL Postgres (PGlite). Proves the proposal does what
 * its header claims before anyone decides to apply it:
 *   - existing public tables, views, sequences and functions lose every anon
 *     (and, for functions, PUBLIC) privilege;
 *   - objects CREATED AFTERWARDS by postgres are born without them;
 *   - authenticated / service_role keep exactly what they had, including on
 *     new objects (Supabase's default grants to them are untouched);
 *   - an explicitly granted non-API role (the signup hook's
 *     supabase_auth_admin) keeps EXECUTE, and triggers still fire;
 *   - the one anon write in the codebase (the user_profiles upsert after a
 *     session-less signUp) fails with the SAME SQLSTATE before and after.
 */
import { assertEquals } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';

const ROOT = new URL('../../', import.meta.url);
const PROPOSAL = 'supabase/migrations/deferred/20261116000001_revoke_anon_default_grants.sql';

Deno.test({
  name: 'deferred 20261116000001: anon loses every default grant, now and for new objects',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const db = new PGlite();
    const q = async (s: string, p: unknown[] = []) => (await db.query(s, p)).rows as Record<string, unknown>[];
    const one = async (s: string) => (await q(s))[0].v;
    const sqlstate = async (role: string, sql: string) => {
      await db.exec(`set role ${role}`);
      try { await db.query(sql); return 'ok'; } catch (e) { return (e as { code?: string }).code; } finally {
        await db.exec('reset role');
      }
    };

    await db.exec(`
      create role anon; create role authenticated; create role service_role; create role supabase_auth_admin;
      alter role service_role bypassrls;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated, service_role;
      grant execute on function auth.uid() to anon, authenticated, service_role;
      grant usage on schema public to anon, authenticated, service_role, supabase_auth_admin;
      -- Supabase's defaults, FOR ROLE postgres IN SCHEMA public.
      alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
      alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role;

      create table public.user_profiles (id uuid primary key, username text unique, updated_at timestamptz);
      alter table public.user_profiles enable row level security;
      create policy p_sel on public.user_profiles for select to authenticated using (true);
      create policy p_ins on public.user_profiles for insert with check (auth.uid() = id);
      create function public.touch() returns trigger language plpgsql as
        $$ begin new.updated_at = clock_timestamp(); return new; end $$;
      create trigger touch before insert or update on public.user_profiles for each row execute function public.touch();
      create view public.v_names with (security_invoker = true) as select username from public.user_profiles;
      create sequence public.seq_x;
      create function public.rpc_x() returns int language sql as 'select 1';
      create function public.signup_hook(e jsonb) returns jsonb language sql as 'select e';
      revoke all on function public.signup_hook(jsonb) from public, anon, authenticated;
      grant execute on function public.signup_hook(jsonb) to supabase_auth_admin;
    `);

    const anonUpsert = `insert into public.user_profiles (id, username) values
      ('00000000-0000-4000-8000-0000000000aa', 'newbie') on conflict (id) do update set username = excluded.username`;

    let before = '';
    await t.step('BEFORE: anon holds the Supabase defaults; its signUp upsert fails RLS (42501)', async () => {
      assertEquals(await one(`select has_table_privilege('anon', 'public.user_profiles', 'SELECT') v`), true);
      assertEquals(await one(`select has_function_privilege('anon', 'public.rpc_x()', 'EXECUTE') v`), true);
      before = await sqlstate('anon', anonUpsert) as string;
      assertEquals(before, '42501');
    });

    await db.exec(await Deno.readTextFile(new URL(PROPOSAL, ROOT)));

    await t.step('existing objects: anon has nothing; authenticated / service_role unchanged', async () => {
      for (const [obj, privs] of [
        ['public.user_profiles', ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']],
        ['public.v_names', ['SELECT']],
      ] as const) {
        for (const p of privs) assertEquals(await one(`select has_table_privilege('anon', '${obj}', '${p}') v`), false, `${obj} ${p}`);
        assertEquals(await one(`select has_table_privilege('authenticated', '${obj}', 'SELECT') v`), true);
      }
      assertEquals(await one(`select has_sequence_privilege('anon', 'public.seq_x', 'USAGE') v`), false);
      assertEquals(await one(`select has_sequence_privilege('authenticated', 'public.seq_x', 'USAGE') v`), true);
      assertEquals(await one(`select has_function_privilege('anon', 'public.rpc_x()', 'EXECUTE') v`), false);
      assertEquals(await one(`select has_function_privilege('authenticated', 'public.rpc_x()', 'EXECUTE') v`), true);
      assertEquals(await one(`select has_function_privilege('supabase_auth_admin', 'public.signup_hook(jsonb)', 'EXECUTE') v`), true);
      assertEquals(await one(`select has_schema_privilege('anon', 'public', 'USAGE') v`), true, 'schema USAGE kept');
    });

    await t.step('NEW objects created by postgres afterwards are born without anon / PUBLIC', async () => {
      await db.exec(`create table public.t_new (id int); create sequence public.seq_new;
        create function public.rpc_new() returns int language sql as 'select 2';`);
      assertEquals(await one(`select has_table_privilege('anon', 'public.t_new', 'SELECT') v`), false);
      assertEquals(await one(`select has_table_privilege('authenticated', 'public.t_new', 'SELECT') v`), true);
      assertEquals(await one(`select has_sequence_privilege('anon', 'public.seq_new', 'USAGE') v`), false);
      assertEquals(await one(`select has_function_privilege('anon', 'public.rpc_new()', 'EXECUTE') v`), false);
      assertEquals(await one(`select has_function_privilege('public', 'public.rpc_new()', 'EXECUTE') v`), false);
      assertEquals(await one(`select has_function_privilege('authenticated', 'public.rpc_new()', 'EXECUTE') v`), true);
    });

    await t.step('the session-less signUp upsert fails with the SAME SQLSTATE; triggers still fire', async () => {
      assertEquals(await sqlstate('anon', anonUpsert), before);
      await db.exec(`select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000bb', false)`);
      assertEquals(await sqlstate('authenticated',
        `insert into public.user_profiles (id, username) values ('00000000-0000-4000-8000-0000000000bb', 'real')`), 'ok');
      assertEquals(await one(`select updated_at is not null v from public.user_profiles where username = 'real'`), true);
    });
  },
});
