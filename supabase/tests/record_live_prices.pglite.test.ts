/**
 * 20261122000000: symbols.last_price_at + public.record_live_prices, against
 * REAL Postgres (PGlite = Postgres 16 in WASM). NOT hermetic: the first run
 * fetches npm:@electric-sql/pglite. Run instructions: supabase/tests/README.md.
 *
 * The migration is loaded VERBATIM onto a replica of prod's symbols table
 * (made out-of-band, so no migration creates it) and Supabase's default
 * privileges, which grant EXECUTE on every new function to anon AND
 * authenticated separately from PUBLIC. So the revokes are proven, not assumed.
 *
 * What it proves: the column exists; anon and authenticated cannot execute the
 * function (has_function_privilege AND an actual call refused 42501), the
 * service role can; proacl lists no anon / authenticated / bare PUBLIC entry;
 * the update path writes last_price + last_price_at; an unknown symbol is never
 * inserted; NULL / <= 0 prices are ignored; a duplicated symbol takes its LAST
 * price; unequal array lengths are refused (22023) and write nothing; the
 * updated_at trigger still fires on a price change; the migration re-applies.
 */
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';

const ROOT = new URL('../../', import.meta.url);
const MIGRATION = 'supabase/migrations/20261122000000_symbols_last_price_at.sql';
const FN = 'public.record_live_prices(text[], numeric[])';

const SCHEMA = `
create role anon; create role authenticated; create role service_role;
alter role service_role bypassrls;
grant usage on schema public to anon, authenticated, service_role;
-- Supabase's default privileges: ALL on tables, EXECUTE on functions, to the API roles.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

-- Prod shape (out-of-band table) with the 20260811000007 updated_at trigger.
create table public.symbols (
  symbol text primary key, name text not null, exchange text not null, active boolean default true,
  is_draftable boolean not null default false, last_price numeric, market_cap numeric,
  price_unsupported boolean not null default false, enriched_at timestamptz, updated_at timestamptz);
create function public.symbols_touch_updated_at() returns trigger language plpgsql as
  $$ begin new.updated_at := now(); return new; end; $$;
create trigger symbols_touch_updated_at before update on public.symbols for each row
  when (old.last_price is distinct from new.last_price or old.name is distinct from new.name)
  execute function public.symbols_touch_updated_at();
grant all on public.symbols to service_role;
`;

// deno-lint-ignore no-explicit-any
type Row = any;

Deno.test({
  name: '20261122000000: record_live_prices on real Postgres (PGlite)',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const db = new PGlite();
    const q = async (s: string, p: unknown[] = []) => (await db.query(s, p)).rows as Row[];
    const as = async <T>(role: string, fn: () => Promise<T>): Promise<T> => {
      await db.exec(`set role ${role}`);
      try {
        return await fn();
      } finally {
        await db.exec('reset role').catch(() => {});
      }
    };
    const call = (syms: unknown[], prices: unknown[]) =>
      q(`select public.record_live_prices($1::text[], $2::numeric[]) as n`, [syms, prices]).then((r) => Number(r[0].n));
    const row = async (sym: string) => (await q(`select * from public.symbols where symbol = $1`, [sym]))[0];

    await db.exec(SCHEMA);
    await db.exec(`insert into public.symbols (symbol, name, exchange, last_price) values
      ('AAPL', 'Apple', 'NASDAQ', 200), ('MSFT', 'Microsoft', 'NASDAQ', 400), ('BRK.B', 'Berkshire', 'NYSE', 450);`);

    const migration = await Deno.readTextFile(new URL(MIGRATION, ROOT));
    await db.exec(migration);

    await t.step('the column exists, timestamptz, NULL for every existing row (age unknown = stale)', async () => {
      const c = await q(`select data_type from information_schema.columns where table_schema = 'public' and table_name = 'symbols' and column_name = 'last_price_at'`);
      assertEquals(c[0]?.data_type, 'timestamp with time zone');
      assertEquals(Number((await q(`select count(*) as n from public.symbols where last_price_at is not null`))[0].n), 0);
    });

    await t.step('grants: service_role only; anon / authenticated / PUBLIC hold no EXECUTE (by name, not just PUBLIC)', async () => {
      const priv = (await q(`select has_function_privilege('anon', '${FN}', 'EXECUTE') as a,
                                    has_function_privilege('authenticated', '${FN}', 'EXECUTE') as u,
                                    has_function_privilege('service_role', '${FN}', 'EXECUTE') as s`))[0];
      assertEquals([priv.a, priv.u, priv.s], [false, false, true]);
      const acl = String((await q(`select proacl::text as acl from pg_proc where proname = 'record_live_prices'`))[0].acl);
      assert(!/(^|[{,])anon=/.test(acl), `anon in proacl: ${acl}`);
      assert(!/(^|[{,])authenticated=/.test(acl), `authenticated in proacl: ${acl}`);
      assert(!/(^|[{,])=X/.test(acl), `bare PUBLIC in proacl: ${acl}`);
      assert(/service_role=X/.test(acl), `service_role missing: ${acl}`);
      for (const role of ['anon', 'authenticated']) {
        await assertRejects(() => as(role, () => call(['AAPL'], [1])), Error, 'permission denied');
      }
      assertEquals(Number((await row('AAPL')).last_price), 200, 'a refused call wrote nothing');
    });

    await t.step('update path: last_price and last_price_at written, matched upper-cased; updated_at trigger still fires', async () => {
      const n = await as('service_role', () => call(['aapl', 'BRK.B'], [201.5, 455]));
      assertEquals(n, 2);
      const a = await row('AAPL');
      assertEquals(Number(a.last_price), 201.5);
      assert(a.last_price_at != null && a.updated_at != null);
      assertEquals(Number((await row('BRK.B')).last_price), 455);
      assertEquals(Number((await row('MSFT')).last_price), 400, 'an unlisted symbol is untouched');
      assertEquals((await row('MSFT')).last_price_at, null);
    });

    await t.step('an unknown symbol is never inserted', async () => {
      const n = await as('service_role', () => call(['NOPE', 'MSFT'], [10, 401]));
      assertEquals(n, 1);
      assertEquals(Number((await q(`select count(*) as n from public.symbols`))[0].n), 3);
      assertEquals(await row('NOPE'), undefined);
    });

    await t.step('NULL, zero and negative prices (and NULL symbols) are ignored', async () => {
      const n = await as('service_role', () => call(['AAPL', 'MSFT', 'BRK.B', null], [null, 0, -5, 9]));
      assertEquals(n, 0);
      assertEquals(Number((await row('AAPL')).last_price), 201.5);
      assertEquals(Number((await row('MSFT')).last_price), 401);
      assertEquals(Number((await row('BRK.B')).last_price), 455);
    });

    await t.step('a symbol listed twice takes its LAST price', async () => {
      assertEquals(await as('service_role', () => call(['AAPL', 'aapl'], [210, 211])), 1);
      assertEquals(Number((await row('AAPL')).last_price), 211);
    });

    await t.step('unequal array lengths are refused (22023) and write nothing; empty arrays write nothing', async () => {
      const before = Number((await row('AAPL')).last_price);
      const err = await assertRejects(() => as('service_role', () => call(['AAPL', 'MSFT'], [1])));
      assertEquals((err as { code?: string }).code, '22023');
      await assertRejects(() => as('service_role', () => call(['AAPL'], [1, 2])));
      assertEquals(Number((await row('AAPL')).last_price), before);
      assertEquals(await as('service_role', () => call([], [])), 0);
      assertEquals(Number((await q(`select public.record_live_prices(null, null) as n`))[0].n), 0);
    });

    await t.step('the migration re-applies cleanly (idempotent), grants unchanged', async () => {
      await db.exec(migration);
      const priv = (await q(`select has_function_privilege('anon', '${FN}', 'EXECUTE') as a,
                                    has_function_privilege('authenticated', '${FN}', 'EXECUTE') as u`))[0];
      assertEquals([priv.a, priv.u], [false, false]);
    });
  },
});
