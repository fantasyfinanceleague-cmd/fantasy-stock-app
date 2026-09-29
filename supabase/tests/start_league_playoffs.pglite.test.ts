/**
 * start_league_playoffs against REAL Postgres (PGlite): the claim/CAS/atomicity
 * contract of 20261011000003 as it is live today, i.e. with the flexible
 * playoffs chain (20261012000000-03) applied on top. Any-P shapes, the
 * backfills and the freeze trigger are in flexible_playoffs.pglite.test.ts.
 * NOT hermetic: the first run fetches npm:@electric-sql/pglite.
 * Run instructions: supabase/tests/README.md.
 *
 * Loads the migration VERBATIM on a replica of the columns and constraints it
 * touches: matchups' two unique keys (20251230000000), valid_playoff_round
 * (20251230220000), and nullable team ids (20260318000000). Supabase's default
 * anon/authenticated EXECUTE grants are simulated. Brackets come from the real
 * pure builder (season-transition.ts buildPlayoffBracket), so the TS <-> SQL
 * row contract is exercised end to end. Also loads the 20261011000004 backstop
 * index and proves normal winner advancement never trips it.
 *
 * What this cannot show: two truly concurrent transactions (PGlite has one
 * connection). The concurrency guarantee rests on the claim's row lock plus
 * READ COMMITTED re-evaluating `season_status = 'active'` (see the migration
 * header). What IS pinned: a repeated call is a no-op, and a failed insert
 * rolls back the claim.
 */
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';
import { buildPlayoffBracket } from '../functions/process-week-results/season-transition.ts';

const ROOT = new URL('../../', import.meta.url);
const MIGRATIONS = [
  '20261011000003_start_league_playoffs.sql',
  '20261011000004_playoff_bracket_unique_backstop.sql',
  '20261012000000_flexible_playoffs_schema.sql',
  '20261012000001_start_league_playoffs_flexible.sql',
  '20261012000002_freeze_playoff_teams_after_draft_start.sql',
  '20261012000003_backfill_league_end_date_playoff_weeks.sql',
].map((f) => new URL(`supabase/migrations/${f}`, ROOT));

const SCHEMA = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
create table leagues (
  id uuid primary key default gen_random_uuid(), name text, league_type text not null default 'matchup',
  num_weeks int, current_week int default 1, season_status text default 'active',
  draft_status text default 'completed', playoff_teams int default 4, league_end_date timestamptz,
  constraint valid_playoff_teams check (playoff_teams is null or playoff_teams in (2, 4, 8)));
create table league_members (league_id uuid not null references leagues(id) on delete cascade,
  user_id text not null, primary key (league_id, user_id));
create table matchups (id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade, week_number int not null,
  team1_user_id text, team2_user_id text, team1_gain numeric(12,2), team2_gain numeric(12,2),
  winner_user_id text, week_start timestamptz, week_end timestamptz, is_playoff boolean default false,
  playoff_round text, team1_seed int, team2_seed int,
  unique(league_id, week_number, team1_user_id), unique(league_id, week_number, team2_user_id),
  constraint valid_playoff_round check (playoff_round is null or playoff_round in ('quarter', 'semi', 'finals')));
`;

const LAST_END = new Date('2026-10-16T21:00:00Z');
// deno-lint-ignore no-explicit-any
type Row = any;

Deno.test({
  name: 'start_league_playoffs on real Postgres (PGlite)',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const db = new PGlite();
    const q = async (s: string, p: unknown[] = []) => (await db.query(s, p)).rows as Row[];
    await db.exec(SCHEMA);
    for (const m of MIGRATIONS) await db.exec(await Deno.readTextFile(m));

    const MEM = ['c', 'a', 'b', 'd'];
    async function league(extra: Record<string, unknown> = {}, members = MEM) {
      const row = { name: 't', num_weeks: 3, current_week: 3, ...extra };
      const cols = Object.keys(row);
      const [l] = await q(`insert into leagues (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')}) returning id`,
        Object.values(row));
      for (const m of members) await q(`insert into league_members values ($1,$2)`, [l.id, m]);
      // One scored regular-season game, as a finished regular season has.
      await q(`insert into matchups (league_id, week_number, team1_user_id, team2_user_id, team1_gain, team2_gain, winner_user_id, week_end)
        values ($1, 3, 'c', 'a', 1, 0, 'c', $2)`, [l.id, LAST_END.toISOString()]);
      return l.id as string;
    }
    const bracket = (members = MEM) => buildPlayoffBracket(members.map((user_id) => ({ user_id })), LAST_END, 4);
    // expected = the current_week the caller observed (3 = num_weeks for every fixture)
    const start = async (id: string, b: unknown, expected = 3) =>
      (await q(`select start_league_playoffs($1, $2, $3::jsonb) r`, [id, expected, JSON.stringify(b)]))[0].r;
    const state = async (id: string) => {
      const [l] = await q(`select season_status, current_week from leagues where id=$1`, [id]);
      const [{ n }] = await q(`select count(*)::int n from matchups where league_id=$1 and is_playoff`, [id]);
      return { status: l.season_status, week: l.current_week, playoffRows: n };
    };
    const UNTOUCHED = { status: 'active', week: 3, playoffRows: 0 };

    await t.step('grants: DEFINER, service_role only, search_path pinned', async () => {
      const [r] = await q(`select proacl::text a, prosecdef d, proconfig::text c from pg_proc where proname='start_league_playoffs'`);
      assertEquals(r.d, true);
      assert(!/anon=|authenticated=/.test(r.a), r.a);
      assert(!/(^|[{,])=X/.test(r.a), `PUBLIC still has EXECUTE: ${r.a}`);
      assert(/service_role=X/.test(r.a), r.a);
      assert(r.c.includes('search_path=public, pg_temp'), r.c);
    });

    await t.step('claim: flips to playoffs at num_weeks+1 and inserts the whole bracket', async () => {
      const id = await league();
      assertEquals(await start(id, bracket()), { status: 'started', matchups_inserted: 3 });
      assertEquals(await state(id), { status: 'playoffs', week: 4, playoffRows: 3 });
      const rows = await q(`select week_number w, playoff_round r, team1_user_id t1, team2_user_id t2, team1_seed s1, team2_seed s2,
        playoff_round_number rn, bracket_position pos
        from matchups where league_id=$1 and is_playoff order by week_number, team1_seed`, [id]);
      assertEquals(rows.map((x: Row) => [x.w, x.r, x.t1, x.t2, x.s1, x.s2, x.rn, x.pos]), [
        [4, 'semi', 'c', 'd', 1, 4, 1, 0], [4, 'semi', 'a', 'b', 2, 3, 1, 1], [5, 'finals', null, null, null, null, 2, 0],
      ]);
    });

    await t.step('idempotent: two calls give exactly one bracket; the second (or a different one) is already_transitioned', async () => {
      const id = await league();
      await start(id, bracket());
      assertEquals(await start(id, bracket()), { status: 'already_transitioned', season_status: 'playoffs' });
      assertEquals(await start(id, bracket(['a', 'b', 'c', 'd'])), { status: 'already_transitioned', season_status: 'playoffs' });
      assertEquals(await state(id), { status: 'playoffs', week: 4, playoffRows: 3 });
    });

    await t.step('atomic: a failing insert rolls back the claim (no half bracket); a retry then succeeds', async () => {
      const id = await league();
      const bad = bracket().map((r, i) => i === 2 ? { ...r, week_start: 'soon' } : r);
      await assertRejects(() => start(id, bad));
      assertEquals(await state(id), UNTOUCHED);
      // A bracket that validation now refuses outright (the same player twice)
      // never reaches the claim at all.
      const dup = bracket().map((r, i) => i === 1 ? { ...r, team1_user_id: 'c' } : r);
      assertEquals(await start(id, dup), { status: 'refused', reason: 'bracket_duplicate_team' });
      assertEquals(await state(id), UNTOUCHED);
      // A constraint violation mid-INSERT (validation passes, the table says no):
      // a stray regular-season row already holds 'c' as team1 in week 4.
      await q(`insert into matchups (league_id, week_number, team1_user_id, team2_user_id) values ($1, 4, 'c', 'b')`, [id]);
      await assertRejects(() => start(id, bracket()), Error, 'duplicate key');
      assertEquals(await state(id), UNTOUCHED);
      await q(`delete from matchups where league_id=$1 and week_number=4 and not is_playoff`, [id]);
      assertEquals((await start(id, bracket())).status, 'started');
      assertEquals(await state(id), { status: 'playoffs', week: 4, playoffRows: 3 });
    });

    await t.step('compare-and-swap: a stale expected_week is not_eligible and writes nothing', async () => {
      const id = await league();
      assertEquals(await start(id, bracket(), 2), { status: 'not_eligible', current_week: 3, expected_week: 2 });
      assertEquals(await state(id), UNTOUCHED);
      assertEquals((await start(id, bracket(), 3)).status, 'started');
    });

    await t.step('address index: a second bracket cannot be inserted, not even placeholders only', async () => {
      const id = await league();
      await start(id, bracket());
      // 20261012000000 replaced the (round, week, team1_seed) backstop with the
      // address key; the old index is gone.
      assertEquals((await q(`select indexname from pg_indexes where indexname in
        ('matchups_bracket_address', 'matchups_one_bracket_per_league') order by 1`)).map((r: Row) => r.indexname),
        ['matchups_bracket_address']);
      // A rogue first round with DIFFERENT players collides on the address...
      await assertRejects(() => q(`insert into matchups (league_id, week_number, team1_user_id, team2_user_id, team1_seed, team2_seed,
        is_playoff, playoff_round, playoff_round_number, bracket_position)
        values ($1, 4, 'zz1', 'zz2', 1, 2, true, 'semi', 1, 0)`, [id]), Error, 'matchups_bracket_address');
      // ...and so does a placeholder-only row, which the old backstop could not see.
      await assertRejects(() => q(`insert into matchups (league_id, week_number, is_playoff, playoff_round, playoff_round_number, bracket_position)
        values ($1, 5, true, 'finals', 2, 0)`, [id]), Error, 'matchups_bracket_address');
      // A playoff row without an address is refused by the CHECK.
      await assertRejects(() => q(`insert into matchups (league_id, week_number, team1_user_id, team2_user_id, is_playoff, playoff_round)
        values ($1, 9, 'zz1', 'zz2', true, 'semi')`, [id]), Error, 'matchups_playoff_address');
      // Other leagues are unaffected.
      const [fresh] = await q(`insert into leagues (name, num_weeks, current_week) values ('x', 3, 3) returning id`);
      await q(`insert into matchups (league_id, week_number, team1_user_id, team2_user_id, team1_seed, team2_seed,
        is_playoff, playoff_round, playoff_round_number, bracket_position)
        values ($1, 4, 'zz1', 'zz2', 1, 2, true, 'semi', 1, 0)`, [fresh.id]);
    });

    await t.step('address index: normal winner advancement never trips it (4- and 8-team)', async () => {
      const id = await league();
      await start(id, bracket());
      // advancePlayoffWinner fills slots by address; addresses never change.
      await q(`update matchups set team1_user_id='c', team1_seed=1 where league_id=$1 and playoff_round_number=2 and bracket_position=0`, [id]);
      await q(`update matchups set team2_user_id='b', team2_seed=3 where league_id=$1 and playoff_round_number=2 and bracket_position=0`, [id]);
      const eight = ['c', 'a', 'b', 'd', 'e', 'f', 'g', 'h'];
      const id8 = await league({ playoff_teams: 8 }, eight);
      assertEquals((await start(id8, bracket(eight))).status, 'started');
      await q(`update matchups set team1_user_id='c', team1_seed=1, team2_user_id='d', team2_seed=4
        where league_id=$1 and playoff_round_number=2 and bracket_position=0`, [id8]);
      await q(`update matchups set team1_user_id='b', team1_seed=3, team2_user_id='a', team2_seed=2
        where league_id=$1 and playoff_round_number=2 and bracket_position=1`, [id8]);
      assertEquals((await state(id8)).playoffRows, 7);
    });

    await t.step('an active league that already has playoff rows is not claimed again', async () => {
      const id = await league();
      await q(`insert into matchups (league_id, week_number, team1_user_id, team2_user_id, is_playoff, playoff_round,
        playoff_round_number, bracket_position) values ($1, 4, 'c', 'd', true, 'semi', 1, 0)`, [id]);
      assertEquals(await start(id, bracket()), { status: 'already_transitioned', season_status: 'active' });
      assertEquals(await state(id), { status: 'active', week: 3, playoffRows: 1 });
    });

    await t.step('completed / playoffs leagues are never claimed', async () => {
      for (const s of ['completed', 'playoffs']) {
        const id = await league({ season_status: s });
        assertEquals((await start(id, bracket())).status, 'already_transitioned');
        assertEquals((await state(id)).playoffRows, 0);
      }
    });

    const refusals: Array<[string, (b: Row[]) => unknown, string, Record<string, unknown>?]> = [
      ['not an array', () => ({ a: 1 }), 'bracket_not_a_nonempty_array'],
      ['empty (fewer than two seeds)', () => buildPlayoffBracket([{ user_id: 'c' }], LAST_END, 4), 'bracket_not_a_nonempty_array'],
      ['a 3-team bracket for a 4-team league', () => buildPlayoffBracket(['c', 'a', 'b'].map((user_id) => ({ user_id })), LAST_END, 4), 'bracket_bad_size'],
      ['non-object row', (b) => [...b, 7], 'bracket_row_not_object'],
      ['bad round', (b) => b.map((r, i) => i === 0 ? { ...r, playoff_round: 'wildcard' } : r), 'bracket_bad_round'],
      ['week before playoffs', (b) => b.map((r, i) => i === 0 ? { ...r, week_number: 3 } : r), 'bracket_bad_week'],
      ['week too late', (b) => b.map((r, i) => i === 2 ? { ...r, week_number: 7 } : r), 'bracket_bad_week'],
      ['non-integer week', (b) => b.map((r, i) => i === 0 ? { ...r, week_number: 4.5 } : r), 'bracket_bad_week'],
      ['string week', (b) => b.map((r, i) => i === 0 ? { ...r, week_number: '4' } : r), 'bracket_bad_week'],
      ['non-member', (b) => b.map((r, i) => i === 0 ? { ...r, team2_user_id: 'intruder' } : r), 'bracket_non_member'],
      ['self pairing', (b) => b.map((r, i) => i === 0 ? { ...r, team2_user_id: r.team1_user_id } : r), 'bracket_self_pairing'],
      ['first round empty', (b) => b.map((r) => ({ ...r, team1_user_id: null, team2_user_id: null, team1_seed: null, team2_seed: null })), 'bracket_first_round_incomplete'],
      ['first round half-empty', (b) => b.map((r, i) => i === 1 ? { ...r, team2_user_id: null, team2_seed: null } : r), 'bracket_first_round_incomplete'],
      ['a team without a seed', (b) => b.map((r, i) => i === 1 ? { ...r, team2_seed: null } : r), 'bracket_bad_seed'],
      ['no first-round rows', (b) => b.filter((r) => r.week_number !== 4), 'bracket_first_round_incomplete'],
      ['week beyond int range', (b) => b.map((r, i) => i === 2 ? { ...r, week_number: 1e12 } : r), 'bracket_bad_week'],
      ['duration league', (b) => b, 'not_a_scheduled_matchup_league', { league_type: 'duration' }],
      ['no num_weeks', (b) => b, 'not_a_scheduled_matchup_league', { num_weeks: null }],
    ];
    for (const [label, mk, reason, extra] of refusals) {
      await t.step(`refusal writes nothing: ${label}`, async () => {
        const id = await league(extra ?? {});
        assertEquals(await start(id, mk(bracket())), { status: 'refused', reason });
        const s = await state(id);
        assertEquals([s.status, s.playoffRows], ['active', 0]);
      });
    }

    await t.step('refusal: unknown league', async () => {
      assertEquals(await start('00000000-0000-0000-0000-000000000000', bracket()), { status: 'refused', reason: 'league_not_found' });
    });

    await t.step('anon and authenticated cannot call it', async () => {
      const id = await league();
      for (const role of ['anon', 'authenticated']) {
        await db.exec(`set role ${role}`);
        try {
          await assertRejects(() => start(id, bracket()), Error, 'permission denied');
        } finally {
          await db.exec('reset role');
        }
      }
      assertEquals(await state(id), UNTOUCHED);
    });
  },
});
