/**
 * The freeze guards that came AFTER 20261104000000, on the FULL migration chain (PGlite = real Postgres). NOT hermetic: the first
 * run fetches npm:@electric-sql/pglite. Run instructions: supabase/tests/README.md.
 *
 * freeze_league_rules.pglite.test.ts proves the freeze as of its own migration. Since then four migrations added guards on the same
 * tables, and none of them fired there (nor in docs/security/freeze-league-rules-effect-test.sql, which had stopped at 20261104000000,
 * so six of its lines described rules that had been replaced):
 *   20261107000004  the [I5] delete-self policy is dropped: leaving is leave_league, a direct DELETE of one's own row is 0 rows;
 *   20261107000006  trg_leagues_roster_reconfirm_gate: a league that owes a roster reconfirmation cannot start (every role);
 *   20261110000000  trg_leagues_commissioner_via_transfer: commissioner_id changes only through a transfer (a user session never);
 *   20261111000001  draft_status is server-only (the freeze function's rule 1), trg_leagues_insert_not_started, trg_leagues_draft_time.
 *
 * Loads those VERBATIM after the freeze chain (the order of prod), runs the effect file verbatim and requires every line to PASS, then
 * for EACH guard builds a fresh database with that one guard removed and requires the guard's own lines to FAIL (and nothing else to
 * change): the effect file can tell a working guard from a missing one.
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';
import { CLASSIFICATION, ROOT, SCHEMA_POST, SCHEMA_PRE, leaguesColumnDdl } from './freeze_harness.ts';

const CHAIN = [   // prod (timestamp) order
  '20251205110000_enable_drafts_rls.sql',
  '20260712000000_rls_b1_00_helpers.sql',
  '20260712000001_rls_b1_01_leagues.sql',
  '20260712000002_rls_b1_02_league_members.sql',
  '20260810000004_create_league_draft_slots.sql',
  '20260811000003_drafts_drop_direct_client_insert.sql',
  '20260925000000_leagues_member_draft_complete_column_guard.sql',
  '20261004000000_participant_display_names.sql',
  '20261010000000_draft_pick_clock_and_queue.sql',
  '20261012000002_freeze_playoff_teams_after_draft_start.sql',
  '20261013000000_draft_order_modes.sql',
  '20261101000001_draft_stalls.sql',
  '20261104000000_freeze_league_rules_after_draft_start.sql',
  '20261107000000_leave_league_schema.sql',                 // league_roster_reconfirm
  '20261107000004_drop_I5_league_members_delete_self.sql',  // the delete-self policy is gone
  '20261107000006_draft_waits_for_roster_reconfirm.sql',    // trg_leagues_roster_reconfirm_gate
  '20261110000000_transfer_commissioner.sql',               // trg_leagues_commissioner_via_transfer
  '20261110000001_leave_league_transfer_first.sql',
  '20261110000002_notify_due_ignores_transfer_notice.sql',
  '20261111000000_draft_auto_start.sql',                    // draft_start_policy(), draft_postponements
  '20261111000001_draft_status_server_only.sql',            // draft_status server-only, insert + draft-time guards
];
const migrationSql = (f: string) => Deno.readTextFile(new URL(`supabase/migrations/${f}`, ROOT));
const EFFECT = new URL('docs/security/freeze-league-rules-effect-test.sql', ROOT);

/** A database with the whole chain applied (optionally with `mutate` run afterwards: the guard under test removed). */
async function chainDb(ddl: string[], mutate?: (db: PGlite) => Promise<unknown>): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SCHEMA_PRE);
  for (const st of ddl) await db.exec(st);
  await db.exec(SCHEMA_POST + `\ncreate table if not exists user_profiles (id uuid primary key, username text);`);
  for (const f of CHAIN) await db.exec(await migrationSql(f));
  if (mutate) await mutate(db);
  return db;
}

/** Runs the effect file; its lines keyed by id ("G1", "H5" ...), each with its full text. */
async function effectLines(db: PGlite): Promise<{ lines: Map<string, string>; raw: string }> {
  let msg = '';
  try {
    await db.exec(await Deno.readTextFile(EFFECT));
  } catch (e) {
    msg = String((e as Error).message);
  }
  assert(msg.startsWith('FREEZE LEAGUE RULES EFFECT TEST RESULTS'), `the block must end by raising: ${msg}`);
  const lines = new Map<string, string>();
  for (const l of msg.split('\n').slice(1).filter((x) => x.trim())) lines.set(l.split(/\s/)[0], l);
  return { lines, raw: msg };
}
const passes = (line: string | undefined) => !!line && /  PASS(\s|$)/.test(line) && !/FAIL/.test(line);

/** The ids the file promises in its EXPECTED OUTPUT header. */
async function headerIds(): Promise<string[]> {
  const sql = await Deno.readTextFile(EFFECT);
  const head = sql.slice(0, sql.indexOf('do $$'));
  return [...head.matchAll(/^--   ([A-Z][0-9]) {1,2}\S/gm)].map((m) => m[1]);
}

Deno.test({
  name: 'freeze guards after 20261104000000, on the full chain (PGlite)',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const { ddl } = await leaguesColumnDdl();
    const ids = await headerIds();

    await t.step('the effect file passes verbatim on the full chain: every line PASS, the header lists exactly those lines, nothing persists', async () => {
      const db = await chainDb(ddl);
      const leaguesBefore = (await db.query(`select count(*)::int n from leagues`)).rows[0] as { n: number };
      const { lines, raw } = await effectLines(db);
      assertEquals([...lines.keys()].sort(), [...ids].sort(), `the header's EXPECTED OUTPUT and the output disagree:\n${raw}`);
      assert(ids.length >= 45, `expected the full list of lines, got ${ids.length}`);
      for (const [id, l] of lines) assert(passes(l), `${id} is not PASS: ${l}`);
      // the later guards each have their lines
      for (const id of ['G3', 'G4', 'T1', 'T2', 'W1', 'W2', 'X1', 'X2', 'I1', 'I2', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'L1', 'L2', 'L3']) {
        assert(lines.has(id), `no ${id} line`);
      }
      const sql = await Deno.readTextFile(EFFECT);
      const m = sql.match(/c_classified text\[\] := array\[([^\]]*)\]/);
      assert(m, 'c_classified array not found in the effect file');
      assertEquals([...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort(), Object.keys(CLASSIFICATION).sort(),
        'effect-file c_classified drifted from CLASSIFICATION');
      assertEquals((await db.query(`select count(*)::int n from leagues`)).rows[0], leaguesBefore, 'the fixtures must roll back');
      assertEquals((await db.query(`select current_user u`)).rows[0], { u: 'postgres' }, 'role switch must not leak');
    });

    /** Build the chain with one guard removed; the named lines must FAIL, every other line must still PASS. */
    async function badCase(name: string, mutate: (db: PGlite) => Promise<unknown>, failing: string[]) {
      await t.step(`bad case: ${name} -> ${failing.join(', ')} FAIL`, async () => {
        const db = await chainDb(ddl, mutate);
        const { lines } = await effectLines(db);
        for (const id of failing) assert(!passes(lines.get(id)), `${id} still passes with ${name} removed: ${lines.get(id)}`);
        const others = [...lines].filter(([id]) => !failing.includes(id) && !passes(lines.get(id)));
        assertEquals(others.map(([id, l]) => `${id}: ${l}`), [], `lines that failed beyond ${failing.join(', ')}`);
      });
    }

    await badCase('trg_leagues_roster_reconfirm_gate removed', (db) => db.exec(`drop trigger trg_leagues_roster_reconfirm_gate on public.leagues`), ['G3', 'W1']);
    await badCase('trg_leagues_commissioner_via_transfer removed', (db) => db.exec(`drop trigger trg_leagues_commissioner_via_transfer on public.leagues`), ['G3', 'T1', 'R5']);
    await badCase('trg_leagues_insert_not_started removed', (db) => db.exec(`drop trigger trg_leagues_insert_not_started on public.leagues`), ['G3', 'I1']);
    await badCase('trg_leagues_draft_time removed', (db) => db.exec(`drop trigger trg_leagues_draft_time on public.leagues`), ['G3', 'H1', 'H2', 'H5', 'H7']);

    // draft_status server-only is rule (1) of the freeze function itself: put the function back WITHOUT it.
    await badCase('rule (1) of the freeze function (draft_status server-only) removed', async (db) => {
      const sql = await migrationSql('20261111000001_draft_status_server_only.sql');
      const fn = sql.slice(sql.indexOf('create or replace function public.enforce_league_rules_frozen_after_draft_start()'),
        sql.indexOf('revoke all on function public.enforce_league_rules_frozen_after_draft_start()'));
      const rule1 = fn.slice(fn.indexOf('  if new.draft_status is distinct from old.draft_status then'), fn.indexOf('  -- (2) frozen unless'));
      assert(rule1.includes('draft_status_server_only'), 'could not slice rule (1)');
      await db.exec(fn.replace(rule1, ''));
    }, ['X1', 'X2', 'R7', 'D1']);

    // the [I5] delete-self policy back: leaving by a direct DELETE works again for a pre-draft member, and the membership trigger
    // refuses the post-draft ones (a different outcome from the policy-less 0 rows the lines pin).
    await badCase('the dropped [I5] delete-self policy restored', (db) =>
      db.exec(`create policy "league_members_delete_self" on public.league_members for delete to authenticated using (user_id = auth.uid()::text)`),
      ['L1', 'L2', 'L3']);

    // The functions are trigger functions nobody may call: a re-grant to a client role (the Supabase default privileges do this to
    // every new function) is what G4 exists to catch.
    await badCase('enforce_leagues_draft_time re-granted to authenticated', (db) =>
      db.exec(`grant execute on function public.enforce_leagues_draft_time() to authenticated`), ['G4']);
    await badCase('enforce_commissioner_change_via_transfer re-granted to service_role', (db) =>
      db.exec(`grant execute on function public.enforce_commissioner_change_via_transfer() to service_role`), ['G4']);
    await badCase('a later function loses its pinned search_path', (db) =>
      db.exec(`alter function public.enforce_leagues_insert_not_started() reset search_path`), ['G4']);
  },
});
