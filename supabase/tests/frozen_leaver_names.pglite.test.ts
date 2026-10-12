/**
 * Frozen leaver names (Giorgio, 2026-10-11, board #call-leaver-names, "A with
 * frozen names"): a manager who LEFT a league stays named in the seasons they
 * played with you, frozen as they were when they left; a rename or avatar
 * change after they leave must not reach their former leaguemates.
 *
 * Against REAL Postgres (PGlite). NOT hermetic: the first run fetches
 * npm:@electric-sql/pglite. Run: `deno test --allow-read --allow-env supabase/tests/`
 *
 * Loaded VERBATIM (never retyped), in apply order:
 *   prior state  is_member (sliced from 20260712000000); 20261004000000 whole
 *                (participant_display_name + get_league_display_names);
 *                20261011000000 whole (league_standings_ranked); 20261014000000
 *                whole (get_season_result); get_renewal_roster,
 *                get_league_history, get_season_matchups + their grant lines
 *                (sliced from 20261115000003); 20261115000005 whole
 *                (get_home_summary); 20261118000000 + 20261118000001 whole
 *                (get_visible_profiles, user_profiles self-only).
 *   under test   20261119000000 + 20261119000001, whole.
 *   effect test  docs/security/frozen-leaver-names-effect-test.sql, whole.
 * Supabase's default grants are simulated, so the proacl comparisons prove the
 * re-created functions kept their ACLs.
 *
 * Cast: A = the viewer. B leaves L1 after the season, then renames and
 * changes avatar. N (no username) leaves L1 too. P was hidden BEFORE the
 * migration (the backfill case). L1 is a completed matchup league; L2 is a
 * later league where B is a CURRENT member with A.
 */
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';
import { assertReplicaDefaultMatchesProd } from './replica_defaults.ts';

const ROOT = new URL('../../', import.meta.url);
const mig = (name: string) => Deno.readTextFile(new URL(`supabase/migrations/${name}`, ROOT));
const FREEZE = '20261119000000_frozen_leaver_names.sql';
const CALLERS = '20261119000001_frozen_leaver_names_callers.sql';
const EFFECT_TEST = new URL('docs/security/frozen-leaver-names-effect-test.sql', ROOT);

/** The exact text from `start` up to and including the first `end` after it. */
function slice(src: string, start: string, end: string): string {
  const i = src.indexOf(start);
  if (i < 0) throw new Error(`slice start not found: ${start}`);
  const j = src.indexOf(end, i);
  if (j < 0) throw new Error(`slice end not found: ${end}`);
  return src.slice(i, j + end.length);
}
/** The non-comment revoke/grant lines of `src` for one function, verbatim. */
const grantLines = (src: string, fn: string) =>
  src.split('\n').filter((l) => /^(revoke|grant)\b/.test(l) && l.includes(`public.${fn}(`)).join('\n');

/**
 * Every re-created caller: its LATEST source and the league expression its
 * resolver call must use. The ONLY allowed difference from the source body is
 * `public.participant_display_name(` -> `public.league_participant_display_name(<league>, `.
 */
const CALLER_SOURCES: { fn: string; sig: string; file: string; league: string }[] = [
  { fn: 'get_league_display_names', sig: '(uuid)', file: '20261004000000_participant_display_names.sql', league: 'p_league_id' },
  { fn: 'get_home_summary', sig: '()', file: '20261115000005_run_it_back_home_summary.sql', league: 'l.id' },
  { fn: 'get_season_result', sig: '(uuid, uuid)', file: '20261014000000_get_season_result_rpc.sql', league: 'p_league_id' },
  { fn: 'get_renewal_roster', sig: '(uuid)', file: '20261115000003_run_it_back_rpcs.sql', league: 'p_league_id' },
  { fn: 'get_league_history', sig: '(uuid)', file: '20261115000003_run_it_back_rpcs.sql', league: 'l.id' },
  { fn: 'get_season_matchups', sig: '(uuid)', file: '20261115000003_run_it_back_rpcs.sql', league: 'l.id' },
];

Deno.test('frozen leaver names: each re-created caller is its latest body with ONLY the resolver swap', async () => {
  const mine = await mig(CALLERS);
  // No later migration may redefine a caller (else "latest" moved under us).
  const all: string[] = [];
  for await (const e of Deno.readDir(new URL('supabase/migrations/', ROOT))) if (e.isFile && e.name.endsWith('.sql')) all.push(e.name);
  all.sort();
  for (const c of CALLER_SOURCES) {
    const head = `create or replace function public.${c.fn}(`;
    const definers = [];
    for (const f of all) if ((await mig(f)).includes(head)) definers.push(f);
    assertEquals(definers.at(-1), CALLERS, `${c.fn}: the latest definition must be ${CALLERS}`);
    assertEquals(definers.at(-2), c.file, `${c.fn}: the superseded definition must be ${c.file}`);

    const src = slice(await mig(c.file), head, '\n$$;');
    const got = slice(mine, head, '\n$$;');
    const want = src.split('public.participant_display_name(').join(`public.league_participant_display_name(${c.league}, `);
    assert(want !== src, `${c.fn}: the source had no participant_display_name call to switch`);
    assertEquals(got, want, `${c.fn}: body differs from ${c.file} beyond the resolver swap`);
    assert(!/[^_]participant_display_name\(/.test(got), `${c.fn}: a bare participant_display_name call remains`);
    // The source's grants are re-asserted verbatim.
    assert(mine.includes(grantLines(await mig(c.file), c.fn)), `${c.fn}: grant lines not re-asserted verbatim`);
  }
});

const SCHEMA = `
create role anon; create role authenticated; create role service_role;
alter role service_role bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text, created_at timestamptz, updated_at timestamptz,
  aud text, role text, instance_id uuid, raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
-- Supabase: every new function/table gets explicit per-role grants.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create table public.user_profiles (id uuid primary key references auth.users(id), username text, avatar text,
  notifications_enabled boolean default true, created_at timestamptz default now(), updated_at timestamptz,
  constraint user_profiles_username_format check (username is null or username ~ '^[A-Za-z0-9_]{3,20}$'));
create unique index user_profiles_username_unique on public.user_profiles (lower(username)) where username is not null;
alter table public.user_profiles enable row level security;
create policy "Authenticated users can view profiles" on public.user_profiles for select to authenticated using (true);
create policy "Users can insert own profile" on public.user_profiles for insert with check (auth.uid() = id);
create policy "Users can update own profile" on public.user_profiles for update using (auth.uid() = id) with check (auth.uid() = id);

create table public.leagues (
  id uuid primary key default gen_random_uuid(), name text not null, commissioner_id text not null,
  invite_code text unique not null default substr(md5(random()::text), 1, 10),
  num_participants int not null default 8, draft_status text not null default 'not_started',
  draft_date timestamptz, draft_started_at timestamptz,
  -- league_type default = PROD's ('duration'); replica_defaults.ts guards it.
  league_type text not null default 'duration', num_weeks int, current_week int default 1,
  playoff_teams int default 4, season_status text default 'active',
  league_start_date timestamptz, league_end_date timestamptz, created_at timestamptz not null default now(),
  previous_league_id uuid references public.leagues(id), lineage_id uuid, season_number int not null default 1);
-- role: NO default, like prod (effect_test_fixture_columns.test.ts).
create table public.league_members (league_id uuid not null references public.leagues(id) on delete cascade,
  user_id text not null, role text not null check (role in ('commissioner', 'member')),
  joined_at timestamptz not null default now(), hidden_at timestamptz, primary key (league_id, user_id));
create table public.league_standings (league_id uuid not null references public.leagues(id) on delete cascade,
  user_id text not null, wins numeric(5,1) not null default 0, losses numeric(5,1) not null default 0,
  ties numeric(5,1) not null default 0, points_for numeric(12,2) not null default 0,
  points_against numeric(12,2) not null default 0, updated_at timestamptz not null default now(),
  primary key (league_id, user_id));
create table public.matchups (id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade, week_number int not null,
  team1_user_id text, team2_user_id text, team1_gain numeric(12,2), team2_gain numeric(12,2),
  winner_user_id text, week_start timestamptz, week_end timestamptz, is_playoff boolean default false,
  is_tie boolean default false, playoff_round_number smallint, bracket_position smallint);
create table public.league_seasons (id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade, season_number int not null default 1,
  started_at timestamptz not null default now(), completed_at timestamptz,
  champion_user_id text, runner_up_user_id text, final_standings jsonb,
  created_at timestamptz not null default now(), unique (league_id, season_number));
alter table public.leagues add column current_season_id uuid references public.league_seasons(id);
create table public.drafts (league_id uuid, user_id text);
create table public.trades (league_id uuid, user_id uuid);
create table public.league_renewal_responses (league_id uuid, user_id text, status text, decided_by text,
  responded_at timestamptz, nudge_count smallint default 0, last_nudged_at timestamptz,
  primary key (league_id, user_id));
`;

// deno-lint-ignore no-explicit-any
type Row = any;

const A = '00000000-0000-4000-8000-0000000000a1';
const B = '00000000-0000-4000-8000-0000000000b1';
const N = '00000000-0000-4000-8000-0000000000e1'; // no username
const P = '00000000-0000-4000-8000-0000000000f1'; // hidden BEFORE the migration (backfill)
const L1 = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';
const S1 = '20000000-0000-4000-8000-000000000001';
const RE_CREATED = ['get_league_display_names', 'get_home_summary', 'get_season_result', 'get_renewal_roster',
  'get_league_history', 'get_season_matchups', 'get_visible_profiles'];

Deno.test({
  name: 'frozen leaver names on real Postgres (PGlite)',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const db = new PGlite();
    const q = async (s: string, p: unknown[] = []) => (await db.query(s, p)).rows as Row[];
    const as = async <T>(role: string, sub: string | null, fn: () => Promise<T>): Promise<T> => {
      await db.exec(`set role ${role}`);
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [sub ?? '']);
      try { return await fn(); } finally {
        await db.exec('reset role').catch(() => {});
        await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
      }
    };
    const asA = <T>(fn: () => Promise<T>) => as('authenticated', A, fn);
    const acls = async () => Object.fromEntries((await q(
      `select proname, proacl::text a from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and proname = any($1)`, [RE_CREATED])).map((r) => [r.proname, r.a]));
    const visible = (ids: string[]) =>
      asA(() => q(`select id, username, avatar from public.get_visible_profiles($1) order by id`, [ids]));
    const leagueNames = async (lg: string) => Object.fromEntries((await asA(() =>
      q(`select user_id, display_name from public.get_league_display_names($1)`, [lg]))).map((r) => [r.user_id, r.display_name]));
    const member = async (lg: string, u: string) =>
      (await q(`select frozen_username, frozen_avatar, frozen_at, hidden_at from public.league_members
                 where league_id = $1 and user_id = $2`, [lg, u]))[0];
    const applyAll = async () => { await db.exec(await mig(FREEZE)); await db.exec(await mig(CALLERS)); };

    // ---- prior state, verbatim ----------------------------------------------------
    await db.exec(SCHEMA);
    await db.exec(slice(await mig('20260712000000_rls_b1_00_helpers.sql'), 'create or replace function public.is_member(', '$$;'));
    await db.exec(await mig('20261004000000_participant_display_names.sql'));
    await db.exec(await mig('20261011000000_league_standings_ranked.sql'));
    await db.exec(await mig('20261014000000_get_season_result_rpc.sql'));
    const rib = await mig('20261115000003_run_it_back_rpcs.sql');
    for (const fn of ['get_renewal_roster', 'get_league_history', 'get_season_matchups']) {
      await db.exec(slice(rib, `create or replace function public.${fn}(`, '\n$$;'));
      await db.exec(grantLines(rib, fn));
    }
    await db.exec(await mig('20261115000005_run_it_back_home_summary.sql'));
    await db.exec(await mig('20261118000000_get_visible_profiles.sql'));
    await db.exec(await mig('20261118000001_user_profiles_self_only.sql'));

    // ---- fixture ------------------------------------------------------------------
    await db.exec(`
      insert into auth.users (id) values ('${A}'), ('${B}'), ('${N}'), ('${P}');
      insert into public.user_profiles (id, username, avatar) values
        ('${A}', 'ana', 'A1'), ('${B}', 'bob', 'B1'), ('${N}', null, 'N1'), ('${P}', 'pia', 'P1');
      insert into public.leagues (id, name, commissioner_id, league_type, draft_status, season_status,
                                  num_participants, playoff_teams, num_weeks, current_week)
        values ('${L1}', 'L1', '${A}', 'matchup', 'completed', 'completed', 4, 2, 1, 2);
      insert into public.league_members (league_id, user_id, role) values
        ('${L1}', '${A}', 'commissioner'), ('${L1}', '${B}', 'member'), ('${L1}', '${N}', 'member'),
        ('${L1}', 'bot-1', 'member');
      insert into public.league_members (league_id, user_id, role, hidden_at) values
        ('${L1}', '${P}', 'member', now() - interval '3 days');
      insert into public.matchups (league_id, week_number, team1_user_id, team2_user_id, team1_gain, team2_gain,
                                   winner_user_id, is_playoff, playoff_round_number, bracket_position) values
        ('${L1}', 1, '${A}', '${B}', 10, 20, '${B}', false, null, null),
        ('${L1}', 1, '${N}', 'bot-1', 5, 7, 'bot-1', false, null, null),
        ('${L1}', 2, '${B}', '${A}', 30, 15, '${B}', true, 1, 0);
      insert into public.league_standings (league_id, user_id, wins, losses, points_for) values
        ('${L1}', '${B}', 1, 0, 20), ('${L1}', '${A}', 0, 1, 10), ('${L1}', 'bot-1', 1, 0, 7), ('${L1}', '${N}', 0, 1, 5);
      insert into public.league_seasons (id, league_id, season_number, completed_at, champion_user_id, runner_up_user_id, final_standings)
        values ('${S1}', '${L1}', 1, now(), '${B}', '${A}', '[
          {"user_id":"${B}","rank":1,"wins":1,"losses":0,"ties":0,"points_for":20},
          {"user_id":"${A}","rank":2,"wins":0,"losses":1,"ties":0,"points_for":10},
          {"user_id":"bot-1","rank":3,"wins":1,"losses":0,"ties":0,"points_for":7},
          {"user_id":"${N}","rank":4,"wins":0,"losses":1,"ties":0,"points_for":5}]');
      update public.leagues set current_season_id = '${S1}' where id = '${L1}';
    `);
    const aclsBefore = await acls();
    assertEquals(Object.keys(aclsBefore).length, RE_CREATED.length);

    await t.step('replica league_type default matches prod', async () => {
      await assertReplicaDefaultMatchesProd(q, 'leagues', 'league_type');
    });

    // ---- apply ------------------------------------------------------------------------
    await applyAll();

    await t.step('backfill: a row hidden before the migration is frozen at its current profile', async () => {
      const p = await member(L1, P);
      assertEquals([p.frozen_username, p.frozen_avatar], ['pia', 'P1']);
      assert(p.frozen_at !== null);
      // Not-hidden rows carry no snapshot.
      const b = await member(L1, B);
      assertEquals([b.frozen_username, b.frozen_avatar, b.frozen_at], [null, null, null]);
      await q(`update public.user_profiles set username = 'pia2' where id = $1`, [P]);
      assertEquals((await leagueNames(L1))[P], 'pia');
    });

    await t.step('grants: every re-created function kept its ACL; the new two have NO API grant', async () => {
      assertEquals(await acls(), aclsBefore);
      for (const fn of ['league_participant_display_name(uuid, text)', 'league_members_freeze_leaver()']) {
        for (const role of ['anon', 'authenticated', 'service_role', 'public']) {
          const [r] = await q(`select has_function_privilege($1, $2, 'execute') x`, [role, `public.${fn}`]);
          assertEquals(r.x, false, `${role} can execute ${fn}`);
        }
        const [p] = await q(`select prosecdef, proconfig::text c from pg_proc where oid = $1::regprocedure`, [`public.${fn}`]);
        assertEquals([p.prosecdef, p.c], [true, '{"search_path=public, pg_temp"}']);
      }
      await assertRejects(() => asA(() => q(`select public.league_participant_display_name($1, $2)`, [L1, B])),
        Error, 'permission denied');
    });

    await t.step('hiding snapshots the CURRENT profile; then B renames + changes avatar', async () => {
      await q(`update public.league_members set hidden_at = now()
                where league_id = $1 and user_id = any($2) and hidden_at is null`, [L1, [B, N]]);
      const b = await member(L1, B);
      assertEquals([b.frozen_username, b.frozen_avatar], ['bob', 'B1']);
      const n = await member(L1, N);
      assertEquals([n.frozen_username, n.frozen_avatar], [null, 'N1']);
      assert(n.frozen_at !== null, 'a null-username leaver is still snapshotted');
      await q(`update public.user_profiles set username = 'bobby', avatar = 'B2' where id = $1`, [B]);
    });

    await t.step('the trigger ignores unrelated updates and forged frozen writes', async () => {
      const before = await member(L1, B);
      await q(`update public.league_members set role = 'member', joined_at = joined_at where league_id = $1 and user_id = $2`, [L1, B]);
      await q(`update public.league_members set hidden_at = hidden_at + interval '1 second' where league_id = $1 and user_id = $2`, [L1, B]);
      await q(`update public.league_members set frozen_username = 'forged', frozen_avatar = 'X', frozen_at = null
                where league_id = $1 and user_id = $2`, [L1, B]);
      const after = await member(L1, B);
      assertEquals([after.frozen_username, after.frozen_avatar, String(after.frozen_at)],
        [before.frozen_username, before.frozen_avatar, String(before.frozen_at)]);
      // A row cannot be BORN with a forged snapshot either.
      await q(`insert into public.leagues (id, name, commissioner_id, league_type) values (gen_random_uuid(), 'x', $1, 'matchup')`, [A]);
      const [lx] = await q(`select id from public.leagues where name = 'x'`);
      await q(`insert into public.league_members (league_id, user_id, role, hidden_at, frozen_username, frozen_avatar)
               values ($1, $2, 'member', now(), 'forged', 'X'), ($1, $3, 'member', null, 'forged', 'X')`, [lx.id, B, A]);
      assertEquals([(await member(lx.id, B)).frozen_username, (await member(lx.id, A)).frozen_username], ['bobby', null]);
      await q(`delete from public.leagues where id = $1`, [lx.id]);
    });

    await t.step('A sees B as they LEFT: get_visible_profiles', async () => {
      assertEquals(await visible([B, N]), [
        { id: B, username: 'bob', avatar: 'B1' },
        { id: N, username: null, avatar: 'N1' },
      ]);
      // The caller's own id is always live.
      assertEquals(await visible([A]), [{ id: A, username: 'ana', avatar: 'A1' }]);
    });

    await t.step('A sees B as they LEFT: get_league_display_names (missing-username fallback = participant_display_name)', async () => {
      const names = await leagueNames(L1);
      assertEquals(names[B], 'bob');
      // Same fallback participant_display_name gives a live member with no username.
      const [pd] = await q(`select public.participant_display_name($1) x`, [N]);
      assertEquals(pd.x, 'Player ' + N.slice(0, 4).toUpperCase());
      assertEquals(names[N], pd.x);
      assertEquals(names['bot-1'], 'Ticker Tina');
    });

    await t.step('A sees B as they LEFT: get_league_history + get_season_matchups', async () => {
      const [h] = await asA(() => q(`select * from public.get_league_history($1)`, [L1]));
      assertEquals(h.champion_display_name, 'bob');
      assertEquals(h.runner_up_display_name, 'ana');
      const fs = Object.fromEntries(h.final_standings.map((e: Row) => [e.user_id, e.display_name]));
      assertEquals([fs[B], fs[N]], ['bob', 'Player ' + N.slice(0, 4).toUpperCase()]);
      const mus = await asA(() => q(`select * from public.get_season_matchups($1)`, [L1]));
      const bNames = mus.flatMap((m: Row) => [m.team1_user_id === B ? m.team1_display_name : null,
        m.team2_user_id === B ? m.team2_display_name : null]).filter((x: unknown) => x !== null);
      assertEquals(bNames, ['bob', 'bob']);
    });

    await t.step('A sees B as they LEFT: get_season_result + get_home_summary', async () => {
      const [r] = await asA(() => q(`select status, reason, champion_display_name from public.get_season_result($1)`, [L1]));
      assertEquals([r.status, r.reason, r.champion_display_name], ['complete', null, 'bob']);
      const [h] = await asA(() => q(`select * from public.get_home_summary() where league_id = $1`, [L1]));
      assertEquals([h.team1_user_id, h.team1_display_name], [B, 'bob']);
    });

    await t.step('a league where B is still a CURRENT member with A: live there and by id; still frozen in L1', async () => {
      await q(`insert into public.leagues (id, name, commissioner_id, league_type) values ($1, 'L2', $2, 'matchup')`, [L2, A]);
      await q(`insert into public.league_members (league_id, user_id, role) values ($1, $2, 'commissioner'), ($1, $3, 'member')`,
        [L2, A, B]);
      assertEquals((await leagueNames(L2))[B], 'bobby');
      assertEquals(await visible([B]), [{ id: B, username: 'bobby', avatar: 'B2' }]);
      assertEquals((await leagueNames(L1))[B], 'bob');
      // N shares no live league with A: still frozen by id.
      assertEquals(await visible([N]), [{ id: N, username: null, avatar: 'N1' }]);
      await q(`delete from public.league_members where league_id = $1`, [L2]);
      assertEquals(await visible([B]), [{ id: B, username: 'bob', avatar: 'B1' }]);
    });

    await t.step('unhide clears the snapshot: B is live in L1 again', async () => {
      await q(`update public.league_members set hidden_at = null where league_id = $1 and user_id = $2`, [L1, B]);
      const b = await member(L1, B);
      assertEquals([b.frozen_username, b.frozen_avatar, b.frozen_at], [null, null, null]);
      assertEquals((await leagueNames(L1))[B], 'bobby');
      assertEquals(await visible([B]), [{ id: B, username: 'bobby', avatar: 'B2' }]);
      // Hidden again: frozen at the profile of THIS hide.
      await q(`update public.league_members set hidden_at = now() where league_id = $1 and user_id = $2`, [L1, B]);
      await q(`update public.user_profiles set username = 'bobcat' where id = $1`, [B]);
      assertEquals((await leagueNames(L1))[B], 'bobby');
    });

    await t.step('existing guards of get_visible_profiles are unchanged', async () => {
      const shape = await asA(() => db.query(`select * from public.get_visible_profiles($1)`, [[B]]));
      assertEquals(shape.fields.map((f) => f.name), ['id', 'username', 'avatar']);
      assertEquals(await visible(['bot-1', 'not-a-uuid']), []);
      const noSub = await as('authenticated', null, () => q(`select * from public.get_visible_profiles($1)`, [[A]]))
        .then(() => null, (e) => e);
      assertEquals(noSub?.code, '42501');
      const big = await asA(() => q(`select * from public.get_visible_profiles($1)`, [Array.from({ length: 501 }, () => A)]))
        .then(() => null, (e) => e);
      assertEquals(big?.code, '22023');
      await assertRejects(() => as('anon', null, () => q(`select * from public.get_visible_profiles($1)`, [[A]])),
        Error, 'permission denied');
    });

    await t.step('both migrations re-apply cleanly, without re-snapshotting', async () => {
      await applyAll();
      assertEquals(await acls(), aclsBefore);
      assertEquals((await member(L1, P)).frozen_username, 'pia');
      assertEquals((await leagueNames(L1))[B], 'bobby');
      assertEquals((await leagueNames(L1))[P], 'pia');
    });

    await t.step('the prod effect test passes on this replica', async () => {
      const sql = await Deno.readTextFile(EFFECT_TEST);
      const err = await db.exec(sql).then(() => null, (e) => e);
      assert(err, 'the effect test must end by raising');
      const msg = String(err.message);
      assert(msg.startsWith('FROZEN LEAVER NAMES EFFECT TEST: PASS (16/16 lines PASS)'), msg);
      assert(!/FAIL/.test(msg), msg);
      // Rolled back: no fixture league survives.
      assertEquals((await q(`select count(*)::int n from public.leagues where name like '__FROZEN_%'`))[0].n, 0);
    });
  },
});
