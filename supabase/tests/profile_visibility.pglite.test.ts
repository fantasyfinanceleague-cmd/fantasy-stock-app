/**
 * Audit #8 (Giorgio, 2026-10-08, ruling A): a player sees ONLY the name and
 * avatar of users they share a league with -- nothing else, nobody else.
 * Against REAL Postgres (PGlite). Loads VERBATIM:
 *   stage 1  supabase/migrations/20261118000000_get_visible_profiles.sql
 *   stage 2  supabase/migrations/deferred/20261118000001_user_profiles_self_only.sql
 * over a replica of prod: user_profiles with its three prod policies
 * (db-snapshot.json) and Supabase's default grants, plus the league tables the
 * "ever participated" rule reads.
 *
 * Cast: A = caller. L1 = A, B (member), D (LEFT L1 but has drafts + matchups
 * there), F (only a league_standings row in L1), G (only a trade in L1), a bot,
 * and a matchup with a NULL slot. Every participation branch has a POSITIVE case. L2 = C only (a stranger to A). L3 = E, which A LEFT.
 */
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';

const ROOT = new URL('../../', import.meta.url);
const STAGE1 = 'supabase/migrations/20261118000000_get_visible_profiles.sql';
const STAGE2 = 'supabase/migrations/deferred/20261118000001_user_profiles_self_only.sql';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';
const D = '00000000-0000-4000-8000-00000000000d';
const E = '00000000-0000-4000-8000-00000000000e';
const F = '00000000-0000-4000-8000-00000000000f'; // in L1 ONLY via league_standings
const G = '00000000-0000-4000-8000-000000000001'; // in L1 ONLY via trades
const L1 = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';
const L3 = '10000000-0000-4000-8000-000000000003';

const SCHEMA = `
create role anon; create role authenticated; create role service_role;
alter role service_role bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create table public.user_profiles (id uuid primary key references auth.users(id), username text, avatar text,
  notifications_enabled boolean default true, created_at timestamptz default now(), updated_at timestamptz);
create unique index user_profiles_username_unique on public.user_profiles (lower(username)) where username is not null;
alter table public.user_profiles enable row level security;
create policy "Authenticated users can view profiles" on public.user_profiles for select to authenticated using (true);
create policy "Users can insert own profile" on public.user_profiles for insert with check (auth.uid() = id);
create policy "Users can update own profile" on public.user_profiles for update using (auth.uid() = id) with check (auth.uid() = id);

create table public.league_members (league_id uuid, user_id text, primary key (league_id, user_id));
create table public.league_standings (league_id uuid, user_id text);
create table public.matchups (league_id uuid, team1_user_id text, team2_user_id text);
create table public.drafts (league_id uuid, user_id text);
create table public.trades (league_id uuid, user_id uuid);
`;

// deno-lint-ignore no-explicit-any
type Row = any;

Deno.test({
  name: 'audit #8: get_visible_profiles + user_profiles self-only (PGlite)',
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
    const visible = async (caller: string, ids: string[]) =>
      (await as('authenticated', caller, () => q(`select * from public.get_visible_profiles($1) order by username`, [ids])));
    const names = (rows: Row[]) => rows.map((r) => r.username).sort();

    await db.exec(SCHEMA);
    await db.exec(`
      insert into auth.users values ('${A}','a@x.test'),('${B}','b@x.test'),('${C}','c@x.test'),('${D}','d@x.test'),('${E}','e@x.test'),('${F}','f@x.test'),('${G}','g@x.test');
      insert into public.user_profiles (id, username, avatar) values
        ('${A}','alice','🦊'),('${B}','bob','🐻'),('${C}','carol','🐱'),('${D}','dave','🐢'),('${E}','erin','🐝'),('${F}','fred','🦉'),('${G}','gina','🐙');
      insert into public.league_members values ('${L1}','${A}'),('${L1}','${B}'),('${L1}','bot-1'),('${L2}','${C}'),('${L3}','${E}');
      -- D LEFT L1: no membership row, but D's history remains.
      insert into public.drafts values ('${L1}','${D}'),('${L3}','${A}');
      insert into public.matchups values ('${L1}','${A}','${D}'), ('${L1}','${B}', null);
      insert into public.league_standings values ('${L1}','${F}');
      insert into public.trades values ('${L3}','${E}'), ('${L1}','${G}');
    `);

    await t.step('BEFORE: the finding reproduces (A reads a stranger\'s whole row)', async () => {
      const rows = await as('authenticated', A, () =>
        q(`select username, notifications_enabled, created_at from public.user_profiles where id = $1`, [C]));
      assertEquals(rows[0].username, 'carol');
    });

    await db.exec(await Deno.readTextFile(new URL(STAGE1, ROOT)));

    await t.step('stage 1: leaguemates incl. a LEAVER (and self); not a stranger, not a league A left', async () => {
      const rows = await visible(A, [A, B, C, D, E, F, G, 'bot-1', 'not-a-uuid']);
      assertEquals(names(rows), ['alice', 'bob', 'dave', 'fred', 'gina']);
      // Only what was asked for: an unrequested leaguemate is not returned.
      assertEquals(names(await visible(A, [B])), ['bob']);
    });

    await t.step('stage 1: EXACTLY id, username, avatar -- never email, created_at, notifications_enabled', async () => {
      const res = await as('authenticated', A, () => db.query(`select * from public.get_visible_profiles($1)`, [[B]]));
      assertEquals(res.fields.map((f) => f.name), ['id', 'username', 'avatar']);
      assertEquals(res.rows, [{ id: B, username: 'bob', avatar: '🐻' }]);
    });

    await t.step('stage 1: a stranger sees nothing of A\'s league; ids are case-insensitive, deduped', async () => {
      assertEquals(await visible(C, [A, B, D]), []);
      assertEquals(names(await visible(C, [C.toUpperCase(), C])), ['carol']);
    });

    await t.step('stage 1: anon cannot execute; no caller -> 42501; >500 ids -> 22023', async () => {
      await assertRejects(() => as('anon', null, () => q(`select * from public.get_visible_profiles($1)`, [[A]])),
        Error, 'permission denied');
      const noSub = await as('authenticated', null, () => q(`select * from public.get_visible_profiles($1)`, [[A]]))
        .then(() => null, (e) => e);
      assertEquals(noSub?.code, '42501');
      const big = await as('authenticated', A, () =>
        q(`select * from public.get_visible_profiles($1)`, [Array.from({ length: 501 }, () => A)])).then(() => null, (e) => e);
      assertEquals(big?.code, '22023');
      const acl = (await q(`select proacl::text a from pg_proc where proname = 'get_visible_profiles'`))[0].a as string;
      assert(!/anon=|service_role=|[{,]=X/.test(acl), `unexpected grantee in ${acl}`);
    });

    await t.step('stage 1 alone changes nothing: the old direct read still works (clients can move first)', async () => {
      const rows = await as('authenticated', A, () => q(`select username from public.user_profiles where id = $1`, [B]));
      assertEquals(rows[0].username, 'bob');
    });

    await db.exec(await Deno.readTextFile(new URL(STAGE2, ROOT)));

    await t.step('stage 2: a direct SELECT returns the caller\'s OWN row only', async () => {
      const all = await as('authenticated', A, () => q(`select id from public.user_profiles`));
      assertEquals(all.map((r) => r.id), [A]);
      const other = await as('authenticated', A, () => q(`select * from public.user_profiles where id = $1`, [B]));
      assertEquals(other, []);
      await assertRejects(() => as('anon', null, () => q(`select id from public.user_profiles`)), Error, 'permission denied');
    });

    await t.step('stage 2: get_visible_profiles still names leaguemates and the leaver', async () => {
      assertEquals(names(await visible(A, [A, B, C, D, F, G])), ['alice', 'bob', 'dave', 'fred', 'gina']);
    });

    await t.step('stage 2: own-row writes unchanged (signup upsert, Profile edit); others\' rows untouchable', async () => {
      await as('authenticated', A, () => q(`update public.user_profiles set avatar = '🐼' where id = $1`, [A]));
      const upd = await as('authenticated', A, () => db.query(`update public.user_profiles set avatar = 'x' where id = $1`, [B]));
      assertEquals(upd.affectedRows, 0);
      assertEquals((await q(`select avatar from public.user_profiles where id = $1`, [B]))[0].avatar, '🐻');
      // ON CONFLICT DO UPDATE needs the EXISTING row to pass SELECT: the own row
      // does, so the signup upsert and web Profile's upserts keep working...
      await as('authenticated', A, () => q(`insert into public.user_profiles (id, username) values ($1, 'alice2')
        on conflict (id) do update set username = excluded.username`, [A]));
      assertEquals((await q(`select username from public.user_profiles where id = $1`, [A]))[0].username, 'alice2');
      // ...and a name another player holds still surfaces as 23505 (the clients'
      // "username taken" signal), even though that player's row is invisible.
      const taken = await as('authenticated', A, () => q(`insert into public.user_profiles (id, username) values ($1, 'BOB')
        on conflict (id) do update set username = excluded.username`, [A])).then(() => null, (e) => e);
      assertEquals(taken?.code, '23505');
      const pol = await q(`select policyname from pg_policies where tablename = 'user_profiles' order by 1`);
      assertEquals(pol.map((r) => r.policyname),
        ['Users can insert own profile', 'Users can update own profile', 'user_profiles_select_self']);
    });

    await t.step('both stages re-apply cleanly', async () => {
      await db.exec(await Deno.readTextFile(new URL(STAGE1, ROOT)));
      await db.exec(await Deno.readTextFile(new URL(STAGE2, ROOT)));
      assertEquals(names(await visible(A, [B, C, D])), ['bob', 'dave']);
    });
  },
});
