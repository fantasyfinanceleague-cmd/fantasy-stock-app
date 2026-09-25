/**
 * finalize_league_draft against REAL Postgres (PGlite = Postgres 16 in WASM).
 * NOT hermetic: the first run fetches npm:@electric-sql/pglite. Kept outside
 * supabase/functions/ so `deno test supabase/functions/` stays offline.
 * Run instructions: supabase/tests/README.md.
 *
 * Why this exists: PL/pgSQL resolves names at EXECUTION time, and a migration
 * applying cleanly says nothing about whether its function body works
 * (CLAUDE.md). This loads the migration file VERBATIM on a minimal replica of
 * the schema — with Supabase's explicit anon/authenticated default EXECUTE grants
 * simulated — and drives it with payloads from the real planner
 * (_shared/schedule.ts), so the TS <-> SQL contract is exercised end to end.
 *
 * PR #9's leagues column-guard trigger is loaded verbatim too, when available:
 *   1. supabase/migrations/*_leagues_member_draft_complete_column_guard.sql
 *      (once PR #9 is merged), else
 *   2. the path in env PR9_TRIGGER_SQL (see README for the `git show` command),
 *   else those steps are reported as ignored — never silently passed.
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';
import { planSeason } from '../functions/_shared/schedule.ts';

const ROOT = new URL('../../', import.meta.url);
const MIGRATION = new URL('supabase/migrations/20260926000000_finalize_league_draft_rpc.sql', ROOT);

async function findTriggerSql(): Promise<string | null> {
  for await (const e of Deno.readDir(new URL('supabase/migrations/', ROOT))) {
    if (e.isFile && e.name.endsWith('_leagues_member_draft_complete_column_guard.sql')) {
      return await Deno.readTextFile(new URL(`supabase/migrations/${e.name}`, ROOT));
    }
  }
  const p = Deno.env.get('PR9_TRIGGER_SQL');
  return p ? await Deno.readTextFile(p) : null;
}

const SCHEMA = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
-- Supabase: every new function gets explicit anon/authenticated/service_role EXECUTE.
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
create table leagues (
  id uuid primary key default gen_random_uuid(), name text, commissioner_id text not null,
  draft_status text default 'not_started', draft_date timestamptz, num_rounds int not null default 6,
  created_at timestamptz not null default now(), league_type text not null default 'duration',
  num_weeks int, current_week int default 1, duration_days int not null default 30,
  league_start_date timestamptz, league_end_date timestamptz, playoff_teams int default 4,
  season_status text default 'active');
create table league_members (league_id uuid not null references leagues(id) on delete cascade,
  user_id text not null, role text not null default 'member', primary key (league_id, user_id));
create table matchups (id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade, week_number int not null,
  team1_user_id text, team2_user_id text, team1_gain numeric, team2_gain numeric, winner_user_id text,
  week_start timestamptz, week_end timestamptz, is_playoff boolean default false, playoff_round text,
  unique(league_id, week_number, team1_user_id), unique(league_id, week_number, team2_user_id));
create table league_standings (league_id uuid not null references leagues(id) on delete cascade,
  user_id text not null, wins numeric(5,1) not null default 0, losses numeric(5,1) not null default 0,
  ties numeric(5,1) not null default 0, points_for numeric(12,2) not null default 0,
  points_against numeric(12,2) not null default 0, updated_at timestamptz not null default now(),
  primary key (league_id, user_id));
create table league_seasons (id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade, season_number int not null default 1,
  started_at timestamptz not null default now(), unique(league_id, season_number));
alter table leagues add column current_season_id uuid references league_seasons(id);
create table drafts (id serial, league_id uuid, user_id text, symbol text);
`;

const NOW = new Date('2026-09-24T18:00:00Z');
// deno-lint-ignore no-explicit-any
type Row = any;

Deno.test({
  name: 'finalize_league_draft on real Postgres (PGlite)',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const db = new PGlite();
    const q = async (s: string, p: unknown[] = []) => (await db.query(s, p)).rows as Row[];
    const migration = await Deno.readTextFile(MIGRATION);
    const trigger = await findTriggerSql();

    await db.exec(SCHEMA);
    // Seeded BEFORE the migration, for the backfill: completed with no season,
    // and an in_progress league the backfill must not touch.
    const [pre] = await q(`insert into leagues (name, commissioner_id, draft_status, draft_date, league_type)
      values ('pre', 'c', 'completed', '2026-03-01T00:00Z', 'matchup') returning id`);
    const [preOpen] = await q(`insert into leagues (name, commissioner_id, draft_status) values ('open','c','in_progress') returning id`);
    if (trigger) await db.exec(trigger);
    await db.exec(migration);

    async function mkLeague(type: string, members: string[], extra: Record<string, unknown> = {}) {
      const row: Record<string, unknown> = { name: 't', commissioner_id: members[0] ?? 'c', draft_status: 'in_progress', league_type: type, ...extra };
      const cols = Object.keys(row);
      const [l] = await q(`insert into leagues (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')}) returning *`, Object.values(row));
      for (const m of members) await q(`insert into league_members values ($1,$2,'member')`, [l.id, m]);
      return l;
    }
    function payload(l: Row, members: string[], now = NOW) {
      const p = planSeason({ leagueType: l.league_type, commissionerId: l.commissioner_id, memberIds: members,
        numWeeks: l.num_weeks, durationDays: l.duration_days, now });
      if (!p.ok) throw new Error(p.reason);
      return p;
    }
    const fin = async (id: string, roster: string[], start: string, end: string, m: unknown) =>
      (await q(`select finalize_league_draft($1,$2,$3,$4,$5::jsonb) r`, [id, roster, start, end, JSON.stringify(m)]))[0].r;
    const finPlan = (l: Row, p: Row, m: unknown = p.matchups) => fin(l.id, p.roster, p.leagueStart, p.leagueEnd, m);
    const lg = async (id: string) => (await q(`select * from leagues where id=$1`, [id]))[0];
    const cnt = async (tbl: string, id: string) => (await q(`select count(*)::int n from ${tbl} where league_id=$1`, [id]))[0].n;

    await t.step('grants: service_role only; search_path pinned', async () => {
      const [r] = await q(`select proacl::text a, proconfig::text c from pg_proc where proname='finalize_league_draft'`);
      assert(!/anon=|authenticated=/.test(r.a), r.a);
      assert(!/(^|[{,])=X/.test(r.a), `PUBLIC still has EXECUTE: ${r.a}`);
      assert(/service_role=X/.test(r.a), r.a);
      assert(r.c.includes('search_path=public, pg_temp'), r.c);
    });

    await t.step('backfill: season 1 for completed leagues only; idempotent re-run', async () => {
      const [bf] = await q(`select s.season_number, s.started_at::text st from leagues l
        join league_seasons s on s.id = l.current_season_id where l.id=$1`, [pre.id]);
      assertEquals(bf.season_number, 1);
      assert(bf.st.startsWith('2026-03-01'), bf.st); // COALESCE(league_start_date, draft_date, ...)
      assertEquals((await lg(preOpen.id)).current_season_id, null);
      await db.exec(migration);
      assertEquals((await q(`select count(*)::int n from league_seasons`))[0].n, 1);
    });

    await t.step('happy path: matchup league writes everything; re-run is a no-op', async () => {
      const mem = ['c', 'a', 'b', 'd'];
      const l = await mkLeague('matchup', mem, { num_weeks: 3 });
      const p = payload(l, mem);
      assertEquals(await finPlan(l, p), { status: 'finalized', matchups_inserted: 6, standings_inserted: 4, season_created: true });
      const L = await lg(l.id);
      assertEquals([L.draft_status, L.num_weeks], ['completed', 3]);
      assert(L.current_season_id !== null);
      assertEquals(new Date(L.league_start_date).toISOString(), p.leagueStart);
      assertEquals(new Date(L.league_end_date).toISOString(), p.leagueEnd);
      const ids = await q(`select team1_user_id a, team2_user_id b from matchups where league_id=$1`, [l.id]);
      assert(ids.every((x: Row) => mem.includes(x.a) && mem.includes(x.b)), 'team ids are the exact roster strings');
      assertEquals(await finPlan(l, p), { status: 'already_finalized', matchups_inserted: 0, standings_inserted: 0, season_created: false });
      assertEquals([await cnt('matchups', l.id), await cnt('league_standings', l.id)], [6, 4]);
    });

    await t.step('odd roster with num_weeks NULL: coalesced to members-1, one bye per week', async () => {
      const mem = ['c', 'a', 'b', 'd', 'e'];
      const l = await mkLeague('matchup', mem);
      assertEquals((await finPlan(l, payload(l, mem))).status, 'finalized');
      assertEquals((await lg(l.id)).num_weeks, 4);
      assertEquals((await q(`select count(*)::int n from matchups where league_id=$1 and team2_user_id is null`, [l.id]))[0].n, 4);
    });

    await t.step('duration league: dates + season, no matchups/standings, num_weeks untouched', async () => {
      const mem = ['c', 'a'];
      const l = await mkLeague('duration', mem, { duration_days: 7 });
      const p = payload(l, mem);
      assertEquals(await finPlan(l, p), { status: 'finalized', matchups_inserted: 0, standings_inserted: 0, season_created: true });
      const L = await lg(l.id);
      assertEquals([L.draft_status, L.num_weeks], ['completed', null]);
      assertEquals(new Date(L.league_end_date).toISOString(), p.leagueEnd);
      const bad = [{ week_number: 1, team1_user_id: 'c', team2_user_id: 'a', week_start: p.leagueStart, week_end: p.leagueEnd }];
      assertEquals((await finPlan(l, p, bad)).detail, 'duration_has_matchups');
    });

    // Every refusal must write NOTHING and leave the draft in_progress (healable).
    const refusals: Array<[string, (p: Row, l: Row) => Promise<Row>, string]> = [
      ['non-member team id', (p, l) => finPlan(l, p, p.matchups.map((m: Row, i: number) => i === 0 ? { ...m, team2_user_id: 'intruder' } : m)), 'row_fields'],
      ['week gap', (p, l) => finPlan(l, p, p.matchups.map((m: Row) => m.week_number === 2 ? { ...m, week_number: 4 } : m)), 'week_coverage'],
      ['member twice in a week', (p, l) => finPlan(l, p, p.matchups.map((m: Row, i: number) => i === 1 ? { ...m, team1_user_id: 'c', team2_user_id: 'a' } : m)), 'week_coverage'],
      ['truncated payload', (p, l) => finPlan(l, p, p.matchups.slice(0, -1)), 'week_coverage'],
      ['self pairing', (p, l) => finPlan(l, p, p.matchups.map((m: Row, i: number) => i === 0 ? { ...m, team2_user_id: m.team1_user_id } : m)), 'row_fields'],
      ['non-integer week', (p, l) => finPlan(l, p, p.matchups.map((m: Row, i: number) => i === 0 ? { ...m, week_number: 'x' } : m)), 'field_types'],
      ['bad timestamp', (p, l) => finPlan(l, p, p.matchups.map((m: Row, i: number) => i === 0 ? { ...m, week_start: 'soon' } : m)), 'field_types'],
      ['non-object element', (p, l) => finPlan(l, p, [...p.matchups, 7]), 'field_types'],
      ['matchups not an array', (p, l) => finPlan(l, p, { a: 1 }), 'matchups_not_array'],
      ['num_weeks mismatch', (p, l) => finPlan(l, p, p.matchups.filter((m: Row) => m.week_number <= 2)), 'num_weeks_mismatch'],
      ['extra db member', async (p, l) => { await q(`insert into league_members values ($1,'late','member')`, [l.id]); return finPlan(l, p); }, 'roster_mismatch'],
      ['payload non-member', (p, l) => fin(l.id, [...p.roster, 'ghost'], p.leagueStart, p.leagueEnd, p.matchups), 'roster_mismatch'],
      ['duplicate roster id', (p, l) => fin(l.id, [...p.roster, 'a'], p.leagueStart, p.leagueEnd, p.matchups), 'member_ids'],
      ['inverted window', (p, l) => fin(l.id, p.roster, p.leagueEnd, p.leagueStart, p.matchups), 'league_window'],
    ];
    for (const [label, act, want] of refusals) {
      await t.step(`refusal writes nothing: ${label}`, async () => {
        const mem = ['c', 'a', 'b', 'd'];
        const l = await mkLeague('matchup', mem, { num_weeks: 3 });
        const r = await act(payload(l, mem), l);
        assertEquals(r.status, 'refused');
        assert(r.reason === want || r.detail === want, JSON.stringify(r));
        const L = await lg(l.id);
        assertEquals([L.draft_status, L.current_season_id, L.league_start_date], ['in_progress', null, null]);
        assertEquals([await cnt('matchups', l.id), await cnt('league_standings', l.id)], [0, 0]);
      });
    }

    await t.step('refusal: draft not started', async () => {
      const l = await mkLeague('matchup', ['c', 'a'], { draft_status: 'not_started' });
      assertEquals((await finPlan(l, payload(l, ['c', 'a']))).reason, 'draft_not_started');
    });

    await t.step('partial schedule is refused (schedule_mismatch), not read as done', async () => {
      const mem = ['c', 'a', 'b', 'd'];
      const l = await mkLeague('matchup', mem, { num_weeks: 3 });
      await q(`insert into matchups (league_id, week_number, team1_user_id, team2_user_id) values ($1,1,'c','a')`, [l.id]);
      const r = await finPlan(l, payload(l, mem));
      assertEquals([r.reason, r.existing, r.expected], ['schedule_mismatch', 1, 6]);
      assertEquals((await lg(l.id)).draft_status, 'in_progress');
    });

    await t.step('partial standings heal per participant; existing row untouched', async () => {
      const mem = ['c', 'a', 'b', 'd'];
      const l = await mkLeague('matchup', mem, { num_weeks: 3 });
      await q(`insert into league_standings (league_id, user_id, wins) values ($1,'a',2)`, [l.id]);
      assertEquals((await finPlan(l, payload(l, mem))).standings_inserted, 3);
      assertEquals((await q(`select wins::int w from league_standings where league_id=$1 and user_id='a'`, [l.id]))[0].w, 2);
    });

    await t.step('season N (state start_new_league_season leaves): fresh schedule, dates follow it', async () => {
      const mem = ['c', 'a', 'b', 'd'];
      const l = await mkLeague('matchup', mem, { num_weeks: 3 });
      await finPlan(l, payload(l, mem));
      const s1 = (await lg(l.id)).current_season_id;
      await q(`insert into league_seasons (league_id, season_number) values ($1, 2)`, [l.id]);
      await q(`update leagues set current_season_id=(select id from league_seasons where league_id=$1 and season_number=2) where id=$1`, [l.id]);
      await q(`delete from matchups where league_id=$1`, [l.id]);
      const p2 = payload(await lg(l.id), mem, new Date('2026-12-01T12:00:00Z'));
      assertEquals(await finPlan(l, p2), { status: 'finalized', matchups_inserted: 6, standings_inserted: 0, season_created: false });
      const L = await lg(l.id);
      assertEquals(new Date(L.league_start_date).toISOString(), p2.leagueStart);
      assert(L.current_season_id !== s1, 'current (season 2) kept, not reset to season 1');
    });

    await t.step({
      name: "PR #9 trigger: service role passes; a member JWT aborts the whole txn (42501)",
      ignore: trigger === null,
      fn: async () => {
        const mem = ['c', 'a', 'b', 'd'];
        const l = await mkLeague('matchup', mem, { num_weeks: 3 });
        const p = payload(l, mem);
        await db.exec(`select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false)`);
        let code = '';
        try { await finPlan(l, p); } catch (e) { code = (e as { code?: string }).code ?? ''; }
        await db.exec(`select set_config('request.jwt.claim.sub', '', false)`);
        assertEquals(code, '42501');
        assertEquals((await lg(l.id)).draft_status, 'in_progress');
        assertEquals(await cnt('matchups', l.id), 0);
        assertEquals((await finPlan(l, p)).status, 'finalized');
      },
    });

    await t.step('stuck-draft detector from the migration header', async () => {
      const l = await mkLeague('matchup', ['c', 'a'], { num_rounds: 1 });
      await q(`insert into drafts (league_id, user_id, symbol) values ($1,'c','AAPL'),($1,'a','SKIP')`, [l.id]);
      const lines = migration.split('\n');
      const i = lines.findIndex((x) => x.includes('SELECT l.id, l.name, l.league_type,'));
      const j = lines.findIndex((x, k) => k >= i && x.trimEnd().endsWith(';'));
      const rows = await q(lines.slice(i, j + 1).map((x) => x.replace(/^--\s{0,3}/, '')).join('\n'));
      assert(rows.some((x: Row) => x.id === l.id), 'fully-picked in_progress draft detected');
      assert(rows.every((x: Row) => x.id !== preOpen.id), 'zero-pick league is not "stuck"');
    });

    await db.close();
  },
});
