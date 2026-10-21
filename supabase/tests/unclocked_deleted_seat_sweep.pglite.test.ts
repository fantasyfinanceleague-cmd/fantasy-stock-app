/**
 * 20261125000011_deleted_seat_sweep_guard.sql EXECUTED on real Postgres (PGlite).
 * NOT hermetic: the first run fetches npm:@electric-sql/pglite. Run:
 *   deno test --allow-read --allow-env supabase/tests/unclocked_deleted_seat_sweep.pglite.test.ts
 *
 * The migration's own SQL text is applied (not a copy). Its three dependencies are stand-ins that
 * can be made to raise: the two auto-start lists (20261111000000) and W2's
 * unclocked_deleted_seat_turns() (20261125000009; its own semantics are W2's to test).
 *
 * What it pins: the cron guard (draft_auto_start_work_due) is true when the deleted-seat list has
 * a row; the auto-start half behaves exactly as before; the two halves are ISOLATED (an error in
 * one neither hides the other nor escapes as an exception); and the grants are service_role only.
 */
import { assertEquals, assertNotEquals } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';

const MIGRATION = new URL('../migrations/20261125000011_deleted_seat_sweep_guard.sql', import.meta.url);
const L = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

Deno.test({
  name: 'the cron guard: auto-start OR a deleted-seat turn, isolated',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table fake_due_starts (league_id uuid);
      create table fake_watch (league_id uuid);
      create table fake_seat_turns (league_id uuid, pick_number int);
      create function public.due_draft_starts() returns table (league_id uuid) language sql stable
        as $$ select league_id from fake_due_starts $$;
      create function public.draft_watch_due() returns table (league_id uuid) language sql stable
        as $$ select league_id from fake_watch $$;
      create function public.unclocked_deleted_seat_turns() returns table (league_id uuid, pick_number int) language sql stable
        as $$ select league_id, pick_number from fake_seat_turns $$;
    `);
    await db.exec(await Deno.readTextFile(MIGRATION));

    const reset = () => db.exec(`delete from fake_due_starts; delete from fake_watch; delete from fake_seat_turns;`);
    const due = async () => (await db.query<{ v: boolean }>(`select public.draft_auto_start_work_due() as v`)).rows[0].v;
    const raising = (name: string, cols: string) =>
      db.exec(`create or replace function public.${name}() returns table (${cols}) language plpgsql stable
                 as $$ begin raise exception 'boom'; end $$;`);

    await t.step('idle: nothing due, no deleted-seat turn -> false (an idle tick makes no edge call)', async () => {
      await reset();
      assertEquals(await due(), false);
    });
    await t.step('a deleted-seat turn makes the guard true', async () => {
      await reset(); await db.exec(`insert into fake_seat_turns values ('${L(1)}', 3)`);
      assertEquals(await due(), true);
    });
    await t.step('the auto-start half still works exactly as before (due start, watch)', async () => {
      await reset(); await db.exec(`insert into fake_due_starts values ('${L(3)}')`);
      assertEquals(await due(), true);
      await reset(); await db.exec(`insert into fake_watch values ('${L(3)}')`);
      assertEquals(await due(), true);
    });
    await t.step('ISOLATION: a broken auto-start list does not hide a deleted-seat turn, and never raises', async () => {
      await reset(); await db.exec(`insert into fake_seat_turns values ('${L(1)}', 1)`);
      // plpgsql that RAISES (an inlined SQL stub would not: EXISTS discards its select list).
      await raising('due_draft_starts', 'league_id uuid');
      assertEquals(await due(), true);
      await reset();
      assertEquals(await due(), false, 'a broken list with nothing else due is false, not an exception');
      await db.exec(`create or replace function public.due_draft_starts() returns table (league_id uuid) language sql stable
                       as $$ select league_id from fake_due_starts $$;`);
    });
    await t.step('ISOLATION: a broken deleted-seat list does not hide a due auto-start, and never raises', async () => {
      await reset(); await db.exec(`insert into fake_due_starts values ('${L(3)}')`);
      await raising('unclocked_deleted_seat_turns', 'league_id uuid, pick_number int');
      assertEquals(await due(), true, 'the start list is true before the broken list is even consulted');
      await reset();
      assertEquals(await due(), false, 'the broken list is swallowed into a warning, not raised');
    });
    await t.step('a MISSING deleted-seat function (a push without W2) degrades to false, never raises', async () => {
      await db.exec(`drop function public.unclocked_deleted_seat_turns();`);
      await reset();
      assertEquals(await due(), false);
      await reset(); await db.exec(`insert into fake_due_starts values ('${L(3)}')`);
      assertEquals(await due(), true, 'auto-start is unaffected');
    });
    await t.step('grants: service_role only', async () => {
      const { rows } = await db.query<{ acl: string | null }>(
        `select proacl::text as acl from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and proname = 'draft_auto_start_work_due'`);
      const acl = rows[0].acl ?? '';
      assertNotEquals(acl, '');
      assertEquals(acl.includes('service_role=X'), true, acl);
      assertEquals(/(^|[{,])(=X|anon=X|authenticated=X)/.test(acl), false, acl);
    });
  },
});
