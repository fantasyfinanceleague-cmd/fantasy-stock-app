/**
 * 20261105000007_lock_start_new_league_season.sql against REAL Postgres
 * (PGlite = Postgres 16 in WASM). NOT hermetic: the first run fetches
 * npm:@electric-sql/pglite. Run instructions: supabase/tests/README.md.
 *
 * Loaded VERBATIM (never retyped):
 *   - the function body and its grant lines from 20260718000000, then the
 *     grant lines from 20260718000001 -- the exact prod ACL history;
 *   - the migration under test, whole;
 *   - the POST-PUSH DO-block effect check from that migration's own header,
 *     un-commented, so the HUMAN ACTION query is itself proven to tell PASS
 *     from FAIL (it is run once BEFORE the migration, where it must say FAIL).
 * Supabase's default grants (EXECUTE on new functions to anon, authenticated
 * and service_role) are simulated, so the proacl assertion proves the explicit
 * per-role revokes work -- REVOKE FROM PUBLIC alone would fail it.
 */
import { assert, assertEquals, assertMatch, assertRejects } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';

const ROOT = new URL('../../', import.meta.url);
const mig = (name: string) => Deno.readTextFile(new URL(`supabase/migrations/${name}`, ROOT));
const MIGRATION = '20261105000007_lock_start_new_league_season.sql';

/** The exact text from `start` up to and including the first `end` after it. */
function slice(src: string, start: string, end: string): string {
  const i = src.indexOf(start);
  if (i < 0) throw new Error(`slice start not found: ${start}`);
  const j = src.indexOf(end, i);
  if (j < 0) throw new Error(`slice end not found: ${end}`);
  return src.slice(i, j + end.length);
}
/** Every non-comment line of `src` containing `needle`, verbatim. */
const linesWith = (src: string, needle: string) =>
  src.split('\n').filter((l) => l.includes(needle) && !l.trimStart().startsWith('--')).join('\n');
/** The header's commented-out DO block, with its `--   ` prefix stripped. */
function headerDoBlock(src: string): string {
  const block = slice(src, '--   DO $$', '--   END $$;');
  return block.split('\n').map((l) => l.replace(/^--   ?/, '')).join('\n');
}

const SCHEMA = `
create role anon; create role authenticated; create role service_role;
create schema auth;
-- Supabase's auth.uid(): the legacy per-claim GUC first, else the claims JSON.
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
-- Supabase: every new function gets explicit anon/authenticated/service_role EXECUTE.
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
create table leagues (
  id uuid primary key default gen_random_uuid(), name text, commissioner_id text not null,
  created_at timestamptz not null default now(), current_week int default 1,
  season_status text default 'active');
create table league_seasons (id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade, season_number int not null default 1,
  started_at timestamptz not null default now(), completed_at timestamptz,
  champion_user_id text, runner_up_user_id text, final_standings jsonb,
  created_at timestamptz not null default now(), unique (league_id, season_number));
alter table leagues add column current_season_id uuid references league_seasons(id);
create table league_standings (league_id uuid not null references leagues(id) on delete cascade,
  user_id text not null, wins numeric(5,1) not null default 0, losses numeric(5,1) not null default 0,
  ties numeric(5,1) not null default 0, points_for numeric(12,2) not null default 0,
  points_against numeric(12,2) not null default 0, updated_at timestamptz not null default now(),
  primary key (league_id, user_id));
create table matchups (id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade, week_number int not null,
  team1_user_id text, team2_user_id text, team1_gain numeric(12,2), team2_gain numeric(12,2));
grant select on leagues, league_seasons, league_standings, matchups to anon, authenticated, service_role;
`;

// deno-lint-ignore no-explicit-any
type Row = any;

Deno.test({
  name: 'start_new_league_season lock (20261105000007) on real Postgres (PGlite)',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const db = new PGlite();
    const q = async (s: string, p: unknown[] = []) => (await db.query(s, p)).rows as Row[];
    /** Call the function as an API role with the given JWT sub; always rolled back. */
    const callAs = async (role: string, sub: string | null, league: string) => {
      await db.exec('begin');
      try {
        await db.exec(`set local role ${role}`);
        await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [sub ?? '']);
        return await q(`select public.start_new_league_season($1) as id`, [league]);
      } finally {
        await db.exec('rollback');
      }
    };
    const proacl = async () =>
      (await q(`select p.proacl::text as acl, count(*) over () as n from pg_proc p
                join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'start_new_league_season'`));
    /** Everything the function would touch, for one league. */
    const state = async (league: string) => (await q(`select
        (select count(*)::int from matchups where league_id = $1) as matchups,
        (select count(*)::int from league_seasons where league_id = $1) as seasons,
        (select coalesce(sum(wins + losses + ties), 0)::float8 from league_standings where league_id = $1) as record,
        (select season_status from leagues where id = $1) as season_status,
        (select current_week from leagues where id = $1) as current_week,
        (select current_season_id from leagues where id = $1) as current_season_id`, [league]))[0];

    // ---- prior state, verbatim (prod ACL history) -----------------------------
    await db.exec(SCHEMA);
    const lockdown = await mig('20260718000000_lockdown_start_new_league_season.sql');
    await db.exec(slice(lockdown, 'CREATE OR REPLACE FUNCTION start_new_league_season(', '$$;'));
    await db.exec(linesWith(lockdown, 'ON FUNCTION start_new_league_season(uuid)'));
    const revokeAnon = await mig('20260718000001_lockdown_function_grants_revoke_anon.sql');
    await db.exec(linesWith(revokeAnon, 'ON FUNCTION start_new_league_season(uuid)'));
    const migration = await mig(MIGRATION);
    const effectCheck = headerDoBlock(migration);

    // ---- fixtures ---------------------------------------------------------------
    const COMM = '00000000-0000-4000-8000-000000000001';
    const MEMBER = '00000000-0000-4000-8000-000000000002';
    // A completed season with history: the function's own gates would PASS for COMM.
    const [lg] = await q(`insert into leagues (name, commissioner_id, current_week, season_status, created_at)
      values ('done', $1, 14, 'completed', '2026-09-01') returning id`, [COMM]);
    const league = lg.id as string;
    const [s1] = await q(`insert into league_seasons (league_id, season_number, completed_at)
      values ($1, 1, now()) returning id`, [league]);
    await q(`update leagues set current_season_id = $1 where id = $2`, [s1.id, league]);
    for (let w = 1; w <= 3; w++) {
      await q(`insert into matchups (league_id, week_number, team1_user_id, team2_user_id, team1_gain, team2_gain)
        values ($1, $2, $3, $4, 10, 5)`, [league, w, COMM, MEMBER]);
    }
    await q(`insert into league_standings (league_id, user_id, wins, losses) values ($1, $2, 3, 0), ($1, $3, 0, 3)`,
      [league, COMM, MEMBER]);
    // A NEWER completed league whose commissioner is a bot id: the effect check
    // must never pick it (it orders by created_at desc, so it would come first).
    await q(`insert into leagues (name, commissioner_id, current_week, season_status, created_at)
      values ('bot-run', 'bot-1', 14, 'completed', '2026-10-01')`);
    const before = await state(league);
    assertEquals(before.matchups, 3);

    await t.step('pre-state mirrors prod: authenticated AND service_role can execute', async () => {
      const [r] = await proacl();
      assertEquals(Number(r.n), 1, 'exactly one overload');
      assert(r.acl.includes('authenticated=X/'), `authenticated grant expected before the lock: ${r.acl}`);
      assert(r.acl.includes('service_role=X/'), `Supabase default service_role grant expected: ${r.acl}`);
      assert(!r.acl.includes('anon=X/'), `anon already revoked by 20260718000001: ${r.acl}`);
    });

    await t.step('pre-state: the commissioner reaches the body and it DELETEs history (rolled back)', async () => {
      await db.exec('begin');
      try {
        await db.exec('set local role authenticated');
        await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [COMM]);
        await q(`select public.start_new_league_season($1)`, [league]);
        await db.exec('reset role');
        assertEquals((await state(league)).matchups, 0, 'the destructive DELETE is what the lock prevents');
      } finally {
        await db.exec('rollback');
      }
      assertEquals(await state(league), before, 'rolled back');
    });

    await t.step('the header effect check says FAIL before the migration (it is not a tautology)', async () => {
      const err = await assertRejects(() => db.exec(effectCheck)) as Error;
      assertMatch(err.message, /PHASE0 EFFECT TEST: FAIL -- the call was ALLOWED/);
      assert(err.message.includes(`league ${league}`), `must pick the UUID-shaped commissioner's league, not the bot's: ${err.message}`);
      assertMatch(err.message, /matchups 3 -> 0/, 'the body ran inside the block');
      assertEquals(await state(league), before, 'the closing RAISE rolled the DELETE back');
    });

    // ---- the migration under test, whole ---------------------------------------
    await db.exec(migration);

    await t.step('proacl is owner-only: no PUBLIC, anon, authenticated or service_role', async () => {
      const [r] = await proacl();
      assertEquals(Number(r.n), 1, 'still exactly one overload (not dropped)');
      assertEquals(r.acl, '{postgres=X/postgres}');
    });

    await t.step('an authenticated commissioner is denied with 42501 and nothing changes', async () => {
      const err = await assertRejects(() => callAs('authenticated', COMM, league)) as Error & { code?: string };
      assertEquals(err.code, '42501');
      assertMatch(err.message, /permission denied for function start_new_league_season/);
      assertEquals(await state(league), before);
    });

    await t.step('anon and service_role are denied with 42501 too', async () => {
      for (const role of ['anon', 'service_role']) {
        const err = await assertRejects(() => callAs(role, null, league)) as Error & { code?: string };
        assertEquals(err.code, '42501', role);
      }
      assertEquals(await state(league), before);
    });

    await t.step('the owner keeps EXECUTE (restorable): reaches the body, whose own gate refuses', async () => {
      // As postgres with no JWT, auth.uid() is NULL, so the in-function commissioner
      // gate raises -- a P0001, not a 42501, which proves EXECUTE itself survived.
      const err = await assertRejects(() =>
        q(`select public.start_new_league_season($1)`, [league])) as Error & { code?: string };
      assertEquals(err.code, 'P0001');
      assertMatch(err.message, /Only the commissioner can start a new season/);
      assertEquals(await state(league), before);
    });

    await t.step('the header effect check says PASS after the migration, with nothing changed', async () => {
      const err = await assertRejects(() => db.exec(effectCheck)) as Error;
      assertMatch(err.message, /PHASE0 EFFECT TEST: PASS -- 42501 permission denied for function start_new_league_season/);
      assert(err.message.includes(`league ${league}`), err.message);
      assertMatch(err.message, /matchups 3 -> 3 \| league_seasons 1 -> 1/);
      assertEquals(await state(league), before);
    });

    await t.step('re-applying the migration is a no-op (idempotent revokes)', async () => {
      await db.exec(migration);
      assertEquals((await proacl())[0].acl, '{postgres=X/postgres}');
    });

    await db.close();
  },
});
