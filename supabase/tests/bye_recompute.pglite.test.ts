/**
 * docs/migrations/bye-no-result-standings-recompute.sql against REAL Postgres
 * (PGlite). The file is a hand-run HUMAN ACTION, and step 3 changes data, so
 * its SQL is executed here VERBATIM: step 1 and step 2 as written; step 3 with
 * its `-- ` comment prefix stripped, BEGIN/COMMIT dropped, and the placeholder
 * league id substituted.
 */
import { assertEquals } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';

const ROOT = new URL('../../', import.meta.url);
const FILE = new URL('docs/migrations/bye-no-result-standings-recompute.sql', ROOT);

const SCHEMA = `
create table leagues (id uuid primary key default gen_random_uuid(), name text, season_status text default 'active');
create table matchups (id uuid primary key default gen_random_uuid(), league_id uuid not null references leagues(id),
  week_number int not null, team1_user_id text, team2_user_id text, team1_gain numeric, team2_gain numeric,
  winner_user_id text, is_tie boolean default false, is_playoff boolean default false);
create table league_standings (league_id uuid not null references leagues(id), user_id text not null,
  wins numeric(5,1) not null default 0, losses numeric(5,1) not null default 0, ties numeric(5,1) not null default 0,
  points_for numeric(12,2) not null default 0, points_against numeric(12,2) not null default 0,
  updated_at timestamptz not null default now(), primary key (league_id, user_id));
`;

/** Split the file into its three steps by the "-- STEP n" banners. */
function steps(src: string): { s1: string; s2: string; s3: string } {
  const at = (n: number) => src.indexOf(`-- STEP ${n}`);
  const body = (from: number, to: number) =>
    src.slice(from, to).split('\n').filter((l) => !l.startsWith('--')).join('\n').trim();
  // Step 3's SQL is the commented block from `-- BEGIN;` to `-- COMMIT;`.
  const block = src.slice(src.indexOf('-- BEGIN;', at(3)), src.indexOf('-- COMMIT;', at(3)));
  const s3raw = block.split('\n')
    .filter((l) => l.startsWith('--'))
    .map((l) => l.replace(/^-- ?/, ''))
    .filter((l) => !/^(BEGIN;|--)/.test(l.trim()))
    .join('\n');
  return { s1: body(at(1), at(2)), s2: body(at(2), at(3)), s3: s3raw };
}

// deno-lint-ignore no-explicit-any
type Row = any;

Deno.test({
  name: 'bye recompute SQL on real Postgres (PGlite)',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const db = new PGlite();
    const q = async (s: string, p: unknown[] = []) => (await db.query(s, p)).rows as Row[];
    await db.exec(SCHEMA);
    const { s1, s2, s3 } = steps(await Deno.readTextFile(FILE));

    // An odd-roster league scored under the OLD rule: 3 managers, 3 weeks.
    // wk1 a bye(win), b beat c; wk2 b bye(win), a beat c; wk3 c bye(win), a tied b.
    async function oddLeague(status: string) {
      const [l] = await q(`insert into leagues (name, season_status) values ('odd', $1) returning id`, [status]);
      const g = (w: number, t1: string, t2: string | null, winner: string | null, tie = false) =>
        q(`insert into matchups (league_id, week_number, team1_user_id, team2_user_id, team1_gain, team2_gain, winner_user_id, is_tie)
           values ($1,$2,$3,$4,1,$5,$6,$7)`, [l.id, w, t1, t2, t2 ? 1 : null, winner, tie]);
      await g(1, 'a', null, 'a'); await g(1, 'b', 'c', 'b');
      await g(2, 'b', null, 'b'); await g(2, 'a', 'c', 'a');
      await g(3, 'c', null, 'c'); await g(3, 'a', 'b', null, true);
      // Standings as the old writer left them (bye = +1 win).
      for (const [u, w, lo, ti] of [['a', 2, 0, 1], ['b', 2, 0, 1], ['c', 1, 2, 0]] as const) {
        await q(`insert into league_standings (league_id, user_id, wins, losses, ties, points_for) values ($1,$2,$3,$4,$5,3)`,
          [l.id, u, w, lo, ti]);
      }
      return l.id as string;
    }
    const active = await oddLeague('active');
    const done = await oddLeague('completed');
    const record = async (id: string) =>
      (await q(`select user_id, wins::int w, losses::int l, ties::int t, points_for::float8 pf
                from league_standings where league_id=$1 order by user_id`, [id]))
        .map((r: Row) => [r.user_id, r.w, r.l, r.t, r.pf]);

    await t.step('step 1 lists legacy bye wins for both leagues (read-only)', async () => {
      const rows = await q(s1);
      assertEquals(rows.map((r: Row) => [r.season_status, Number(r.legacy_bye_wins)]).sort(),
        [['active', 3], ['completed', 3]]);
    });

    await t.step('step 2 shows exactly the managers whose bye wins inflate the record; skips completed', async () => {
      const rows = await q(s2);
      assertEquals(rows.every((r: Row) => r.league_id === active), true);
      assertEquals(rows.map((r: Row) => [r.user_id, Number(r.stored_w), Number(r.new_w)]).sort(),
        [['a', 2, 1], ['b', 2, 1], ['c', 1, 0]]);
    });

    await t.step('step 3 fixes W/L/T only for the target league, keeps points_for, rewrites legacy bye rows', async () => {
      await db.exec(s3.replaceAll('<league-uuid>', active));
      assertEquals(await record(active), [['a', 1, 0, 1, 3], ['b', 1, 0, 1, 3], ['c', 0, 2, 0, 3]]);
      const [{ n }] = await q(`select count(*)::int n from matchups where league_id=$1 and team2_user_id is null and winner_user_id is not null`, [active]);
      assertEquals(n, 0);
      // The completed league was not targeted and is untouched.
      assertEquals(await record(done), [['a', 2, 0, 1, 3], ['b', 2, 0, 1, 3], ['c', 1, 2, 0, 3]]);
      assertEquals((await q(s2)).length, 0);
    });

    await t.step('step 3 targeting a COMPLETED league changes nothing (standings or matchups)', async () => {
      await db.exec(s3.replaceAll('<league-uuid>', done));
      assertEquals(await record(done), [['a', 2, 0, 1, 3], ['b', 2, 0, 1, 3], ['c', 1, 2, 0, 3]]);
      const [{ n }] = await q(`select count(*)::int n from matchups where league_id=$1 and team2_user_id is null and winner_user_id is not null`, [done]);
      assertEquals(n, 3);
    });
  },
});
