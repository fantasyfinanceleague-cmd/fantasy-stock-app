/**
 * The cron's `where exists (...)` guard, EXECUTED on real Postgres (PGlite).
 * NOT hermetic: the first run fetches npm:@electric-sql/pglite. Run:
 *   deno test --allow-read --allow-env supabase/tests/autopick_cron_predicate.pglite.test.ts
 *
 * PGlite has no pg_cron / pg_net / vault, so the schedule and the post cannot run
 * here. But the thing worth testing, WHEN the job decides to post, is pure SQL over
 * overdue_draft_turns() and draft_stalls. This test slices that exact predicate out of
 * 20261106000000 (not a copy) and runs it as `select 1 where exists (...)` against a
 * stubbed overdue_draft_turns() and a replica of draft_stalls. If the migration's
 * predicate changes, this runs the new text.
 */
import { assertEquals } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';

const CRON = new URL('../migrations/20261106000000_schedule_draft_autopick_sweep.sql', import.meta.url);

const L1 = '00000000-0000-4000-8000-0000000000a1';
const L2 = '00000000-0000-4000-8000-0000000000a2';

Deno.test({
  name: 'autopick cron predicate: posts only for a turn worth a call',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const src = await Deno.readTextFile(CRON);
    const command = src.slice(src.indexOf('$$') + 2, src.lastIndexOf('$$'));
    const m = command.match(/\n\s*(where exists \([\s\S]*?\n\s*\))\s*;/);
    if (!m) throw new Error('could not slice the where-exists predicate out of the cron command');
    const predicate = `select 1 as post ${m[1]}`;

    const db = new PGlite();
    await db.exec(`
      create table fake_overdue (league_id uuid, pick_number int, deadline_at timestamptz);
      create function public.overdue_draft_turns() returns table (league_id uuid, pick_number int, deadline_at timestamptz)
        language sql stable as $$ select league_id, pick_number, deadline_at from fake_overdue $$;
      create table public.draft_stalls (
        league_id uuid not null, pick_number int not null, picker_id text not null, reason text not null,
        attempts int not null default 0, first_seen_at timestamptz not null default now(),
        last_seen_at timestamptz not null default now(), primary key (league_id, pick_number));
    `);
    const posts = async () => ((await db.query(predicate)).rows.length) === 1;
    const reset = () => db.exec(`delete from fake_overdue; delete from draft_stalls;`);
    const overdue = (l: string, n: number) =>
      db.query(`insert into fake_overdue values ($1,$2, now() - interval '5 minutes')`, [l, n]);
    const stall = (l: string, n: number, reason: string, ago: string) =>
      db.query(`insert into draft_stalls (league_id, pick_number, picker_id, reason, last_seen_at)
                values ($1,$2,'u',$3, now() - $4::interval)`, [l, n, reason, ago]);

    await t.step('idle: no overdue turn -> no post', async () => {
      await reset();
      assertEquals(await posts(), false);
    });
    await t.step('a healthy overdue turn posts', async () => {
      await reset(); await overdue(L1, 5);
      assertEquals(await posts(), true);
    });
    await t.step('a legality stall refreshed < 60 s ago is throttled', async () => {
      await reset(); await overdue(L1, 5); await stall(L1, 5, 'nothing_legal', '20 seconds');
      assertEquals(await posts(), false);
    });
    await t.step('a legality stall older than 60 s posts again (the ~1/min retry)', async () => {
      await reset(); await overdue(L1, 5); await stall(L1, 5, 'nothing_legal', '61 seconds');
      assertEquals(await posts(), true);
    });
    await t.step('a fresh vendor_outage stall is NOT throttled (the function retries it every tick)', async () => {
      await reset(); await overdue(L1, 5); await stall(L1, 5, 'vendor_outage', '1 second');
      assertEquals(await posts(), true);
    });
    await t.step('any non-vendor_outage reason is throttled, like recentStall (only vendor_outage is exempt)', async () => {
      await reset(); await overdue(L1, 5); await stall(L1, 5, 'something_new', '1 second');
      assertEquals(await posts(), false);
    });
    await t.step('just inside / just outside the 60 s window', async () => {
      await reset(); await overdue(L1, 5); await stall(L1, 5, 'nothing_legal', '59 seconds');
      assertEquals(await posts(), false);
      await reset(); await overdue(L1, 5); await stall(L1, 5, 'nothing_legal', '61 seconds');
      assertEquals(await posts(), true);
    });
    await t.step("another pick_number's stall does not hide this turn", async () => {
      await reset(); await overdue(L1, 6); await stall(L1, 5, 'nothing_legal', '1 second');
      assertEquals(await posts(), true);
    });
    await t.step("another league's stall does not hide this one", async () => {
      await reset(); await overdue(L1, 5); await stall(L2, 5, 'nothing_legal', '1 second');
      assertEquals(await posts(), true);
    });
    await t.step('one stalled league does not block a healthy overdue one', async () => {
      await reset();
      await overdue(L1, 5); await stall(L1, 5, 'nothing_legal', '1 second');
      await overdue(L2, 9);
      assertEquals(await posts(), true);
    });
    await t.step('only stalled-and-fresh leagues overdue -> no post', async () => {
      await reset();
      await overdue(L1, 5); await stall(L1, 5, 'nothing_legal', '1 second');
      await overdue(L2, 9); await stall(L2, 9, 'nothing_legal', '30 seconds');
      assertEquals(await posts(), false);
    });
  },
});
