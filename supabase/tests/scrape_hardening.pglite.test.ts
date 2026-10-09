/**
 * 20261116000000 (scrape hardening) against REAL Postgres (PGlite = Postgres 16
 * in WASM). NOT hermetic: the first run fetches npm:@electric-sql/pglite.
 *
 * The migration is loaded VERBATIM over a replica of prod's prior state (the
 * objects as their migrations / db-snapshot.json define them), with Supabase's
 * default grants simulated: ALL on tables and EXECUTE on functions for the API
 * roles, plus Postgres' own PUBLIC EXECUTE. Each section is proven both ways:
 * the scrape surface is closed AND the legitimate caller is unaffected.
 */
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';

const ROOT = new URL('../../', import.meta.url);
const MIGRATION = 'supabase/migrations/20261116000000_scrape_hardening.sql';

const A = '00000000-0000-4000-8000-00000000000a'; // caller
const B = '00000000-0000-4000-8000-00000000000b'; // A's leaguemate
const C = '00000000-0000-4000-8000-00000000000c'; // stranger (no shared league)
const BOT = 'bot-1'; // a league member with no auth.users row
const L1 = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';
const CAT = '20000000-0000-4000-8000-000000000001';

const SCHEMA = `
create role anon; create role authenticated; create role service_role;
alter role service_role bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

-- user_profiles + its updated_at trigger (20251210100000).
create table public.user_profiles (id uuid primary key, username text, updated_at timestamptz default now());
alter table public.user_profiles enable row level security;
create policy "Authenticated users can view profiles" on public.user_profiles for select to authenticated using (true);
create policy "Users can update own profile" on public.user_profiles for update using (auth.uid() = id);
create function public.update_user_profiles_updated_at() returns trigger language plpgsql as
  $$ begin new.updated_at = clock_timestamp(); return new; end $$;
create trigger trg_user_profiles_updated_at before update on public.user_profiles
  for each row execute function public.update_user_profiles_updated_at();

-- symbols touch trigger (20260811000007) and the category cap trigger (20260810000003), as stubs.
create table public.symbols (symbol text primary key, name text, updated_at timestamptz);
create function public.symbols_touch_updated_at() returns trigger language plpgsql as
  $$ begin new.updated_at = clock_timestamp(); return new; end $$;
create trigger symbols_touch_updated_at before update on public.symbols
  for each row execute function public.symbols_touch_updated_at();
create table public.categories (id uuid primary key, name text);
create table public.symbol_category_overrides (
  id uuid primary key default gen_random_uuid(), symbol text not null,
  category_id uuid not null references public.categories(id), justification text not null,
  created_at timestamptz not null default now(), unique (symbol, category_id));
create function public.enforce_symbol_category_cap() returns trigger language plpgsql as $$ begin return new; end $$;
create trigger enforce_symbol_category_cap before insert on public.symbol_category_overrides
  for each row execute function public.enforce_symbol_category_cap();
alter table public.symbol_category_overrides enable row level security;
create policy "symbol_category_overrides_select_authenticated" on public.symbol_category_overrides
  for select to authenticated using (true);

-- splits (20260810000006).
create table public.splits (id uuid primary key default gen_random_uuid(), symbol text, ratio numeric);
alter table public.splits enable row level security;
create policy "splits_select_authenticated" on public.splits for select to authenticated using (true);

-- league_members (user_id is text in prod).
create table public.league_members (league_id uuid, user_id text, primary key (league_id, user_id));

-- The limiter, verbatim from 20260716000000 (service_role-only EXECUTE).
create table public.rate_limit_counters (bucket text not null, subject text not null,
  window_start timestamptz not null, hits int not null default 0, primary key (bucket, subject, window_start));
alter table public.rate_limit_counters enable row level security;
create function public.check_and_bump_rate_limit(p_bucket text, p_subject text, p_limit int, p_window_seconds int default 60)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_win  timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits int;
begin
  insert into rate_limit_counters (bucket, subject, window_start, hits)
  values (p_bucket, p_subject, v_win, 1)
  on conflict (bucket, subject, window_start) do update set hits = rate_limit_counters.hits + 1
  returning hits into v_hits;
  return v_hits <= p_limit;
end; $$;
revoke all on function public.check_and_bump_rate_limit(text, text, int, int) from public, anon, authenticated;

-- check_usernames as prod has it (20261007000000: STABLE, no limit).
create function public.check_usernames(p_candidates text[]) returns table (username text, status text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  return query select c, case when exists (select 1 from public.user_profiles p where lower(p.username) = lower(c)
    and p.id <> auth.uid()) then 'taken' else 'available' end from unnest(p_candidates) c;
end; $$;
revoke all on function public.check_usernames(text[]) from public, anon, authenticated;
grant execute on function public.check_usernames(text[]) to authenticated;

-- get_real_user_ids as prod has it (20250122000000 + 20260724000000).
create function public.get_real_user_ids(user_ids text[]) returns text[] language sql security definer
  set search_path = public as $$ select array_agg(id::text) from auth.users where id::text = any(user_ids); $$;
revoke all on function public.get_real_user_ids(text[]) from public, anon;
grant execute on function public.get_real_user_ids(text[]) to authenticated;
`;

// deno-lint-ignore no-explicit-any
type Row = any;

Deno.test({
  name: '20261116000000: scrape hardening on real Postgres (PGlite)',
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
    const canExec = async (role: string, fn: string) =>
      (await q(`select has_function_privilege($1, $2, 'EXECUTE') as ok`, [role, fn]))[0].ok as boolean;
    const TRIGGER_FNS = [
      'public.enforce_symbol_category_cap()', 'public.symbols_touch_updated_at()',
      'public.update_user_profiles_updated_at()',
    ];

    await db.exec(SCHEMA);
    await db.exec(`
      insert into auth.users (id) values ('${A}'), ('${B}'), ('${C}');
      insert into public.user_profiles (id, username, updated_at) values
        ('${A}', 'alice', '2020-01-01'), ('${B}', 'bob', '2020-01-01'), ('${C}', 'carol', '2020-01-01');
      insert into public.league_members values ('${L1}', '${A}'), ('${L1}', '${B}'), ('${L1}', '${BOT}'), ('${L2}', '${C}');
      insert into public.categories values ('${CAT}', 'Tech');
      insert into public.symbol_category_overrides (symbol, category_id, justification)
        values ('AAPL', '${CAT}', 'internal curation note');
      insert into public.splits (symbol, ratio) values ('NVDA', 10);
    `);

    await t.step('BEFORE: every finding reproduces', async () => {
      for (const fn of TRIGGER_FNS) {
        assertEquals(await canExec('anon', fn), true, fn);
        assertEquals(await canExec('public', fn), true, fn);
      }
      const j = await as('authenticated', A, () => q(`select justification from public.symbol_category_overrides`));
      assertEquals(j[0].justification, 'internal curation note');
      assertEquals((await as('authenticated', A, () => q(`select count(*)::int n from public.splits`)))[0].n, 1);
      const ids = await as('authenticated', A, () => q(`select public.get_real_user_ids($1) r`, [[C]]));
      assertEquals(ids[0].r, [C], 'a stranger is confirmed real');
    });

    const migration = await Deno.readTextFile(new URL(MIGRATION, ROOT));
    await db.exec(migration);

    await t.step('1. trigger functions: no PUBLIC/anon/authenticated EXECUTE; triggers still fire', async () => {
      for (const fn of TRIGGER_FNS) {
        for (const role of ['public', 'anon', 'authenticated']) assertEquals(await canExec(role, fn), false, `${role} ${fn}`);
        assertEquals(await canExec('service_role', fn), true, fn);
      }
      // An authenticated player's own profile update still bumps updated_at.
      await as('authenticated', A, () => q(`update public.user_profiles set username = 'alice2' where id = $1`, [A]));
      const p = await q(`select updated_at > '2021-01-01' as bumped from public.user_profiles where id = $1`, [A]);
      assertEquals(p[0].bumped, true);
      // service_role writers (refresh-symbols, curation) still fire theirs.
      await as('service_role', null, async () => {
        await q(`insert into public.symbols (symbol, name) values ('AAPL', 'Apple')`);
        await q(`update public.symbols set name = 'Apple Inc.' where symbol = 'AAPL'`);
        await q(`insert into public.symbol_category_overrides (symbol, category_id, justification) values ('MSFT', '${CAT}', 'x')`);
      });
      assertEquals((await q(`select updated_at is not null as ok from public.symbols`))[0].ok, true);
    });

    await t.step('2. check_usernames: works for a player, 61st call in a minute is PT429, VOLATILE', async () => {
      const rows = await as('authenticated', A, () => q(`select * from public.check_usernames($1)`, [['bob', 'zed_new']]));
      assertEquals(rows.map((r) => r.status), ['taken', 'available']);
      for (let i = 0; i < 59; i++) await as('authenticated', A, () => q(`select * from public.check_usernames($1)`, [['zz_x']]));
      const err = await as('authenticated', A, () => q(`select * from public.check_usernames($1)`, [['zz_x']]))
        .then(() => null, (e) => e);
      assert(err, 'the 61st call in one minute was allowed');
      assertEquals(err.code, 'PT429');
      // Another player is unaffected by A's counter.
      const other = await as('authenticated', B, () => q(`select * from public.check_usernames($1)`, [['zz_y']]));
      assertEquals(other.length, 1);
      assertEquals((await q(`select provolatile from pg_proc where proname = 'check_usernames'`))[0].provolatile, 'v');
      assertEquals(await canExec('anon', 'public.check_usernames(text[])'), false);
      assertEquals(await canExec('authenticated', 'public.check_usernames(text[])'), true);
    });

    await t.step('2b. the hour window refuses on its own (600/h), and bumps on every call', async () => {
      await q(`insert into public.rate_limit_counters (bucket, subject, window_start, hits) values
        ('check-usernames-hour', 'user:${C}', to_timestamp(floor(extract(epoch from now()) / 3600) * 3600), 600)`);
      const err = await as('authenticated', C, () => q(`select * from public.check_usernames($1)`, [['zz_z']]))
        .then(() => null, (e) => e);
      assertEquals(err?.code, 'PT429');
      const hits = await q(`select bucket, hits from public.rate_limit_counters where subject = 'user:${B}' order by bucket`);
      assertEquals(hits, [{ bucket: 'check-usernames', hits: 1 }, { bucket: 'check-usernames-hour', hits: 1 }]);
    });

    await t.step('3. get_real_user_ids: same answer for the league, nothing for a stranger probe', async () => {
      const mine = await as('authenticated', A, () => q(`select public.get_real_user_ids($1) r`, [[A, B, BOT, C]]));
      assertEquals([...mine[0].r].sort(), [A, B].sort(), 'leaguemates + self only; the bot and the stranger are absent');
      const probe = await as('authenticated', C, () => q(`select public.get_real_user_ids($1) r`, [[A, B]]));
      assertEquals(probe[0].r, null);
      assertEquals(await canExec('anon', 'public.get_real_user_ids(text[])'), false);
    });

    await t.step('4. justification hidden; symbol / category_id (what clients select) still readable', async () => {
      const ok = await as('authenticated', A, () =>
        q(`select symbol, category_id from public.symbol_category_overrides where symbol = 'AAPL'`));
      assertEquals(ok.length, 1);
      await assertRejects(() => as('authenticated', A, () => q(`select justification from public.symbol_category_overrides`)),
        Error, 'permission denied');
      await assertRejects(() => as('anon', null, () => q(`select symbol from public.symbol_category_overrides`)),
        Error, 'permission denied');
      for (const sql of [
        `insert into public.symbol_category_overrides (symbol, category_id, justification) values ('X', '${CAT}', 'x')`,
        `update public.symbol_category_overrides set symbol = 'Y'`,
        `delete from public.symbol_category_overrides`,
        `truncate public.symbol_category_overrides`,
      ]) {
        await assertRejects(() => as('authenticated', A, () => q(sql)), Error, 'permission denied');
      }
      const svc = await as('service_role', null, () => q(`select justification from public.symbol_category_overrides where symbol = 'AAPL'`));
      assertEquals(svc[0].justification, 'internal curation note');
    });

    await t.step('5. splits: service_role only, no policy left', async () => {
      await assertRejects(() => as('authenticated', A, () => q(`select * from public.splits`)), Error, 'permission denied');
      await assertRejects(() => as('anon', null, () => q(`select * from public.splits`)), Error, 'permission denied');
      assertEquals((await as('service_role', null, () => q(`select count(*)::int n from public.splits`)))[0].n, 1);
      assertEquals((await q(`select count(*)::int n from pg_policies where tablename = 'splits'`))[0].n, 0);
    });

    await t.step('re-applying the migration is clean', async () => {
      await db.exec(migration);
      assertEquals(await canExec('anon', 'public.symbols_touch_updated_at()'), false);
      // count(*) needs SELECT on any one column, so a head-count read still works.
      assertEquals((await as('authenticated', A, () =>
        q(`select count(*)::int n from public.symbol_category_overrides`)))[0].n, 2);
    });
  },
});
