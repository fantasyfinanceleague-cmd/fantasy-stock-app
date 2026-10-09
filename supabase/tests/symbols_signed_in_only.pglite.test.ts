/**
 * 20261114000000: public.symbols becomes signed-in only, against REAL Postgres
 * (PGlite = Postgres 16 in WASM). NOT hermetic: the first run fetches
 * npm:@electric-sql/pglite. Run instructions: supabase/tests/README.md.
 *
 * The migration is loaded VERBATIM. symbols is created by no migration (it was
 * made out-of-band), so the prior state is a replica of prod's: the table, RLS
 * on, the single PUBLIC policy "read symbols" (db-snapshot.json), and
 * Supabase's default ALL grants to the API roles -- so the anon revoke is
 * proven rather than assumed (CLAUDE.md: Supabase grants anon by default).
 *
 * What it proves: before, anon reads every row (the scraping finding); after,
 * anon is REFUSED (42501, not 0 rows -- the grant is gone, not just filtered),
 * a signed-in player still reads every row, the signed-in player cannot write
 * or TRUNCATE, service_role (refresh/enrich/draft-write) still reads and
 * writes, exactly one policy remains, and the migration re-applies cleanly.
 */
import { assertEquals, assertRejects } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';

const ROOT = new URL('../../', import.meta.url);
const MIGRATION = 'supabase/migrations/20261114000000_symbols_signed_in_only.sql';
const A = '00000000-0000-4000-8000-00000000000a';

const SCHEMA = `
create role anon; create role authenticated; create role service_role;
-- Supabase defines service_role with BYPASSRLS.
alter role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
-- Supabase grants ALL on every new public table to the API roles; RLS is the barrier.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;

-- Prod shape (out-of-band table; the columns the readers use).
create table public.symbols (
  symbol text primary key, name text, active boolean default true,
  is_draftable boolean default false, last_price numeric, gics_industry text,
  market_cap numeric, price_unsupported boolean default false);
alter table public.symbols enable row level security;
-- The one prod policy (db-snapshot.json, captured 2026-10-07).
create policy "read symbols" on public.symbols for select using (true);
-- The table was made out-of-band, so a bare PUBLIC grant cannot be ruled out
-- from the repo; seed one so the migration's REVOKE ... FROM public is tested.
grant select on public.symbols to public;
`;

// deno-lint-ignore no-explicit-any
type Row = any;

Deno.test({
  name: '20261114000000: symbols signed-in only on real Postgres (PGlite)',
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
    const count = async (role: string, sub: string | null) =>
      Number((await as(role, sub, () => q(`select count(*)::int as n from public.symbols`)))[0].n);

    await db.exec(SCHEMA);
    await db.exec(`insert into public.symbols (symbol, name, is_draftable, last_price) values
      ('AAPL', 'Apple Inc.', true, 200), ('MSFT', 'Microsoft Corp.', true, 400), ('ZZZW', 'Warrant', false, null);`);

    await t.step('BEFORE: the finding reproduces (anon reads every row; PUBLIC holds a grant)', async () => {
      assertEquals(await count('anon', null), 3);
      const acl = (await q(`select relacl::text as acl from pg_class where oid = 'public.symbols'::regclass`))[0].acl;
      assertEquals(/(^|[{,])=r/.test(acl), true, `seed PUBLIC grant missing: ${acl}`);
    });

    const migration = await Deno.readTextFile(new URL(MIGRATION, ROOT));
    await db.exec(migration);

    await t.step('anon is REFUSED by the grant (42501), not merely filtered to 0 rows', async () => {
      await assertRejects(() => count('anon', null), Error, 'permission denied for table symbols');
      const grants = await q(`select privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'symbols' and grantee in ('anon', 'PUBLIC')`);
      assertEquals(grants, []);
      const acl = (await q(`select relacl::text as acl from pg_class where oid = 'public.symbols'::regclass`))[0].acl;
      // aclitem text: "grantee=privs/grantor"; an empty grantee is PUBLIC.
      assertEquals(/(^|[{,])=/.test(acl), false, `PUBLIC still granted: ${acl}`);
      assertEquals(/anon=/.test(acl), false, `anon still granted: ${acl}`);
    });

    await t.step('a signed-in player reads every row (search / names / categoryData unaffected)', async () => {
      assertEquals(await count('authenticated', A), 3);
      const rows = await as('authenticated', A, () =>
        q(`select name from public.symbols where symbol = 'AAPL'`));
      assertEquals(rows[0].name, 'Apple Inc.');
    });

    await t.step('authenticated holds SELECT only: no write, no TRUNCATE (which RLS does not govern)', async () => {
      const privs = await q(`select privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'symbols' and grantee = 'authenticated'`);
      assertEquals(privs.map((r) => r.privilege_type), ['SELECT']);
      for (const sql of [
        `insert into public.symbols (symbol, name) values ('EVIL', 'x')`,
        `update public.symbols set last_price = 1`,
        `delete from public.symbols`,
        `truncate public.symbols`,
      ]) {
        await assertRejects(() => as('authenticated', A, () => q(sql)), Error, 'permission denied');
      }
      assertEquals(await count('service_role', null), 3);
    });

    await t.step('service_role (refresh/enrich-symbols, draft-write last_price) reads and writes', async () => {
      await as('service_role', null, () =>
        q(`update public.symbols set last_price = 201 where symbol = 'AAPL'`));
      await as('service_role', null, () =>
        q(`insert into public.symbols (symbol, name) values ('NEW', 'New Listing')
           on conflict (symbol) do update set name = excluded.name`));
      assertEquals(await count('service_role', null), 4);
    });

    await t.step('exactly one policy remains: symbols_select_authenticated, SELECT, to authenticated', async () => {
      const pol = await q(`select policyname, roles::text as roles, cmd, qual from pg_policies
        where schemaname = 'public' and tablename = 'symbols'`);
      assertEquals(pol, [{ policyname: 'symbols_select_authenticated', roles: '{authenticated}', cmd: 'SELECT', qual: 'true' }]);
    });

    await t.step('re-applying the migration is clean and changes nothing', async () => {
      await db.exec(migration);
      await assertRejects(() => count('anon', null), Error, 'permission denied');
      assertEquals(await count('authenticated', A), 4);
      const pol = await q(`select count(*)::int as n from pg_policies where tablename = 'symbols'`);
      assertEquals(pol[0].n, 1);
    });
  },
});
