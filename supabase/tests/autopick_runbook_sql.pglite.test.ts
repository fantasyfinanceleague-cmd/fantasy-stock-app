/**
 * The two SQL-editor scripts of docs/migrations/AUTOPICK_CRON_LIVE.md, executed
 * VERBATIM on real Postgres (PGlite) so Giorgio never meets a syntax error or a
 * check that can't fail while pasting into prod:
 *   docs/security/autopick-live-test-proof.sql      (the live-test proof)
 *   docs/security/refuse-new-skip-effect-test.sql   (the SKIP trigger effect check)
 * Each is run on a good fixture (expect PASS) and then once per mutation that
 * must flip exactly the intended line to FAIL.
 * NOT hermetic: the first run fetches npm:@electric-sql/pglite. Run:
 *   deno test --allow-read --allow-env supabase/tests/autopick_runbook_sql.pglite.test.ts
 */
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';

const ROOT = new URL('../../', import.meta.url);
const PROOF = new URL('docs/security/autopick-live-test-proof.sql', ROOT);
const SKIP_TEST = new URL('docs/security/refuse-new-skip-effect-test.sql', ROOT);
const SKIP_MIGRATION = new URL('supabase/migrations/20261106000002_drafts_refuse_new_skip.sql', ROOT);

const L = '00000000-0000-4000-8000-0000000000a1';
const H = '00000000-0000-4000-8000-00000000000a'; // the human (UUID-shaped, never bot-%)
const T0 = '2026-10-06 10:00:00+00';

const SCHEMA = `
create role anon; create role authenticated; create role service_role;
create table leagues (id uuid primary key, name text, draft_status text, pick_seconds int,
  pick_clock_enabled boolean, draft_started_at timestamptz);
create table league_members (league_id uuid, user_id text, primary key (league_id, user_id));
create table league_draft_slots (id uuid primary key default gen_random_uuid(), league_id uuid,
  slot_index int, slot_count int not null default 1);
create table drafts (id serial primary key, league_id uuid, user_id text, symbol text,
  entry_price numeric, quantity numeric, round int, pick_number int, slot_id uuid,
  pick_source text not null default 'manual', recorded_at timestamptz not null default now());
create table draft_stalls (league_id uuid, pick_number int, picker_id text, reason text,
  attempts int default 0, first_seen_at timestamptz default now(), last_seen_at timestamptz default now(),
  primary key (league_id, pick_number));
`;

// deno-lint-ignore no-explicit-any
type Row = any;

async function fixture(db: PGlite) {
  await db.exec(SCHEMA);
  await db.query(`insert into leagues values ($1,'autopick-test','in_progress',30,true,$2)`, [L, T0]);
  for (const m of [H, 'bot-1', 'bot-2', 'bot-3']) await db.query(`insert into league_members values ($1,$2)`, [L, m]);
  const [{ id: slot }] = (await db.query(`insert into league_draft_slots (league_id, slot_index, slot_count) values ($1,0,10) returning id`, [L])).rows as Row[];
  // 5 picks, each recorded 31 s after the previous anchor (>= pick_seconds).
  const picks: Array<[number, string, string, string]> = [
    [1, 'bot-1', 'AAPL', 'bot'], [2, 'bot-2', 'MSFT', 'bot'], [3, 'bot-3', 'NVDA', 'bot'],
    [4, H, 'AMZN', 'auto_best'], [5, 'bot-1', 'GOOG', 'bot'],
  ];
  for (const [n, u, s, src] of picks) {
    await db.query(
      `insert into drafts (league_id,user_id,symbol,entry_price,quantity,round,pick_number,slot_id,pick_source,recorded_at)
       values ($1,$2,$3,100,2,1,$4,$5,$6, $7::timestamptz + make_interval(secs => 31 * $4))`,
      [L, u, s, n, slot, src, T0]);
  }
}

/** Run a DO block that ends in RAISE; return the error text. */
async function run(db: PGlite, sqlFile: URL, mutate = ''): Promise<string> {
  const sql = (await Deno.readTextFile(sqlFile)).replaceAll('<TEST_LEAGUE_ID>', L);
  await db.exec('begin');
  try {
    if (mutate) await db.exec(mutate);
    await db.exec(sql);
    return 'NO RAISE';
  } catch (e) {
    return (e as Error).message;
  } finally {
    await db.exec('rollback');
  }
}

Deno.test({
  name: 'autopick-live-test-proof.sql: PASS on a good test league, each defect flips its own line',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const db = new PGlite();
    await fixture(db);
    const failing = (msg: string) => msg.split('\n').filter((l) => /^P[0-9][a-z]? .*  FAIL/.test(l)).map((l) => l.split(' ')[0]);

    await t.step('good league: overall PASS, no FAIL line', async () => {
      const msg = await run(db, PROOF);
      assert(msg.includes('AUTO-PICK LIVE TEST PROOF (read-only): PASS'), msg);
      assertEquals(failing(msg), [], msg);
      assert(msg.includes('P1 picks written by the sweep: 1 human auto'), msg);
      assert(msg.includes('P7 every auto/bot pick came at least 30s after its anchor: 0 too early  PASS'), msg);
    });
    const cases: Array<[string, string, string]> = [
      ['a SKIP row', `update drafts set symbol = 'SKIP' where pick_number = 5`, 'P3'],
      ['a gap in pick numbers', `delete from drafts where pick_number = 3`, 'P4'],
      ['a zero-price pick', `update drafts set entry_price = 0 where pick_number = 2`, 'P5a'],
      ['a symbol drafted twice', `update drafts set symbol = 'AAPL' where pick_number = 2`, 'P5b'],
      ['a pick outside the league slots', `update drafts set slot_id = null where pick_number = 2`, 'P6a'],
      ['a manager over a slot_count', `update league_draft_slots set slot_count = 1`, 'P6b'],
      ['a pick recorded too early', `update drafts set recorded_at = recorded_at - interval '20 seconds' where pick_number = 2`, 'P7'],
      ['a stalled turn', `insert into draft_stalls (league_id, pick_number, picker_id, reason) values ('${L}', 6, 'bot-2', 'nothing_legal')`, 'P8'],
      ['no human auto pick', `update drafts set pick_source = 'manual' where pick_number = 4`, 'P1'],
      ['a bot row with a human source', `update drafts set pick_source = 'auto_best' where pick_number = 1`, 'P2'],
    ];
    for (const [name, mutate, line] of cases) {
      await t.step(`${name} -> ${line} FAIL, overall FAIL`, async () => {
        const msg = await run(db, PROOF, mutate);
        assert(msg.includes('AUTO-PICK LIVE TEST PROOF (read-only): FAIL'), msg);
        assert(failing(msg).includes(line), `${line} did not fail: ${msg}`);
      });
    }
    await t.step('an unknown league id is a hard FAIL, not a vacuous PASS', async () => {
      const sql = (await Deno.readTextFile(PROOF)).replaceAll('<TEST_LEAGUE_ID>', '00000000-0000-4000-8000-0000000000ff');
      const msg = await db.exec(sql).then(() => 'NO RAISE', (e: Error) => e.message);
      assert(msg.includes('FAIL: league'), msg);
    });
    await t.step('the script left nothing behind (rolled back by the final raise)', async () => {
      const n = ((await db.query(`select count(*)::int n from drafts`)).rows[0] as Row).n;
      assertEquals(n, 5);
    });
  },
});

Deno.test({
  name: 'refuse-new-skip-effect-test.sql: PASS with the migration, FAIL without it, writes nothing either way',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const failing = (msg: string) => msg.split('\n').filter((l) => /^T[0-9] .*  FAIL/.test(l)).map((l) => l.split(' ')[0]);
    const withMigration = new PGlite();
    await fixture(withMigration);
    // The prod situation: a legacy SKIP row exists BEFORE the trigger does.
    await withMigration.query(`insert into drafts (league_id,user_id,symbol,entry_price,quantity,round,pick_number) values ($1,'bot-2','SKIP',0,0,2,6)`, [L]);
    await withMigration.exec(await Deno.readTextFile(SKIP_MIGRATION));

    await t.step('with the migration: every line PASS', async () => {
      const msg = await run(withMigration, SKIP_TEST);
      assert(msg.includes('REFUSE-NEW-SKIP EFFECT TEST (all rolled back): PASS'), msg);
      assertEquals(failing(msg), [], msg);
      for (const code of ['T0', 'T1', 'T2', 'T3', 'T4', 'T5']) assert(msg.includes(`${code} `), `${code} missing: ${msg}`);
      assert(msg.includes('T5 legacy SKIP rows still readable: 1  PASS'), msg);
    });
    await t.step('with the migration: the test wrote nothing', async () => {
      const n = ((await withMigration.query(`select count(*)::int n from drafts`)).rows[0] as Row).n;
      assertEquals(n, 6);
    });
    await t.step('WITHOUT the migration: T0, T1, T2, T3, T4 all FAIL, and the allowed inserts are still rolled back', async () => {
      const bare = new PGlite();
      await fixture(bare);
      const msg = await run(bare, SKIP_TEST);
      assert(msg.includes('REFUSE-NEW-SKIP EFFECT TEST (all rolled back): FAIL'), msg);
      assertEquals(failing(msg), ['T0', 'T1', 'T2', 'T3', 'T4'], msg);
      const n = ((await bare.query(`select count(*)::int n from drafts`)).rows[0] as Row).n;
      assertEquals(n, 5);
      assertFalse(msg.includes('NO RAISE'));
    });
  },
});
