/**
 * 20261106000002_drafts_refuse_new_skip.sql against REAL Postgres (PGlite).
 * NOT hermetic: the first run fetches npm:@electric-sql/pglite. Run:
 *   deno test --allow-read --allow-env supabase/tests/refuse_new_skip.pglite.test.ts
 *
 * Loads the migration VERBATIM onto a minimal `drafts` replica that already holds
 * legacy SKIP rows (the prod situation: the trigger lands on a table with history).
 * Simulates Supabase's default anon/authenticated function grants so the proacl
 * assertion proves the explicit revokes work.
 */
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';

const MIGRATION = new URL('../migrations/20261106000002_drafts_refuse_new_skip.sql', import.meta.url);
const L = '00000000-0000-4000-8000-0000000000a1';
const U = '00000000-0000-4000-8000-00000000000a';

Deno.test({
  name: 'refuse_new_skip_rows: new SKIP refused (23514), history untouched',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
      create table drafts (id serial primary key, league_id uuid, user_id text, symbol text,
        entry_price numeric, quantity numeric, pick_number int);
      insert into drafts (league_id, user_id, symbol, entry_price, quantity, pick_number)
        values ('${L}', 'bot-1', 'SKIP', 0, 0, 1), ('${L}', '${U}', 'AAPL', 200, 1, 2);
    `);
    await db.exec(await Deno.readTextFile(MIGRATION));

    const code = async (sql: string, p: unknown[] = []) => {
      try { await db.query(sql, p); return null; } catch (e) { return (e as { code?: string }).code ?? String(e); }
    };

    await t.step('a normal pick still inserts', async () => {
      assertEquals(await code(`insert into drafts (league_id,user_id,symbol,entry_price,quantity,pick_number) values ($1,$2,'MSFT',400,1,3)`, [L, U]), null);
    });
    for (const sym of ['SKIP', 'skip', 'Skip']) {
      await t.step(`INSERT of ${sym} is refused with check_violation (23514)`, async () => {
        assertEquals(await code(`insert into drafts (league_id,user_id,symbol,entry_price,quantity,pick_number) values ($1,$2,$3,0,0,9)`, [L, U, sym]), '23514');
      });
    }
    await t.step("a padded ' SKIP ' is refused too, and a NULL symbol is not this trigger's business", async () => {
      assertEquals(await code(`insert into drafts (league_id,user_id,symbol,entry_price,quantity,pick_number) values ($1,$2,' SKIP ',0,0,10)`, [L, U]), '23514');
      assertEquals(await code(`insert into drafts (league_id,user_id,symbol,entry_price,quantity,pick_number) values ($1,$2,E'SKIP\\t\\n',0,0,10)`, [L, U]), '23514');
      assertEquals(await code(`insert into drafts (league_id,user_id,symbol,entry_price,quantity,pick_number) values ($1,$2,null,1,1,11)`, [L, U]), null);
      await db.exec(`delete from drafts where pick_number = 11`);
    });
    await t.step('a blanket UPDATE naming symbol (symbol = upper(symbol)) passes over legacy SKIP rows', async () => {
      assertEquals(await code(`update drafts set symbol = upper(symbol)`), null);
      assertEquals(((await db.query(`select count(*)::int n from drafts where symbol = 'SKIP'`)).rows[0] as { n: number }).n, 1);
    });
    await t.step('an UPDATE of symbol TO SKIP is refused', async () => {
      assertEquals(await code(`update drafts set symbol = 'SKIP' where pick_number = 2`), '23514');
      assertEquals((await db.query(`select symbol from drafts where pick_number = 2`)).rows[0], { symbol: 'AAPL' });
    });
    await t.step('legacy SKIP rows are still readable, and still counted', async () => {
      const r = (await db.query(`select count(*)::int n from drafts where upper(symbol) = 'SKIP'`)).rows[0] as { n: number };
      assertEquals(r.n, 1);
    });
    await t.step('a legacy SKIP row can still be touched on other columns, and can be repaired off SKIP', async () => {
      assertEquals(await code(`update drafts set quantity = 0 where pick_number = 1`), null);
      assertEquals(await code(`update drafts set symbol = 'NVDA' where pick_number = 1`), null);
    });
    await t.step('the refused writes left no row behind', async () => {
      const n = ((await db.query(`select count(*)::int n from drafts`)).rows[0] as { n: number }).n;
      assertEquals(n, 3); // 2 seeded + MSFT
    });
    await t.step('grants: not callable by anon/authenticated; search_path pinned', async () => {
      const r = (await db.query(
        `select proacl::text a, proconfig::text c from pg_proc where proname = 'refuse_new_skip_rows'`)).rows[0] as { a: string; c: string };
      assertFalse(/anon=/.test(r.a ?? ''), `anon can execute: ${r.a}`);
      assertFalse(/authenticated=/.test(r.a ?? ''), `authenticated can execute: ${r.a}`);
      assert((r.c ?? '').includes('search_path=public, pg_temp'), `search_path not pinned: ${r.c}`);
    });
  },
});
