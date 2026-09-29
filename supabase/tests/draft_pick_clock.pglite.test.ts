/**
 * 20261010000000_draft_pick_clock_and_queue.sql against REAL Postgres (PGlite).
 * NOT hermetic: the first run fetches npm:@electric-sql/pglite. Kept outside
 * supabase/functions/ so `deno test supabase/functions/` stays offline.
 * Run instructions: supabase/tests/README.md.
 *
 * Loads the migration VERBATIM (plus PR #9's leagues column-guard trigger, so
 * the two BEFORE UPDATE triggers are exercised in their real order) on a
 * minimal replica of the schema, with Supabase's default anon/authenticated
 * grants simulated — so the proacl assertions prove the explicit revokes work.
 *
 * NOT covered here (PGlite has no pg_cron / pg_net / vault): the deferred
 * cron migration. That is static review + the post-push effect check only.
 */
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';

const ROOT = new URL('../../', import.meta.url);
const MIGRATION = new URL('supabase/migrations/20261010000000_draft_pick_clock_and_queue.sql', ROOT);
const EFFECT_TEST = new URL('docs/security/draft-pick-clock-effect-test.sql', ROOT);
const GUARD = new URL('supabase/migrations/20260925000000_leagues_member_draft_complete_column_guard.sql', ROOT);

const SCHEMA = `
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
-- Same resolution order as Supabase's auth.uid(): legacy claim.sub GUC, else
-- the request.jwt.claims JSON (what the SQL-editor effect test sets).
create function auth.uid() returns uuid language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                     nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
-- Supabase: every new function AND table gets explicit anon/authenticated/service_role grants.
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
create table leagues (
  id uuid primary key default gen_random_uuid(), name text, commissioner_id text not null,
  draft_status text default 'not_started', num_rounds int not null default 6,
  invite_code text, num_participants int default 4,
  league_start_date timestamptz, league_end_date timestamptz);
create table league_members (league_id uuid not null references leagues(id) on delete cascade,
  user_id text not null, role text not null default 'member', primary key (league_id, user_id));
create table drafts (id serial primary key, league_id uuid, user_id text, symbol text,
  entry_price numeric, quantity numeric, round int, pick_number int, created_at timestamptz default now());
create unique index drafts_league_pick_unique_idx on drafts (league_id, pick_number) where created_at > '2026-01-08';
create table symbols (symbol text primary key);
insert into symbols values ('AAPL'),('MSFT'),('NVDA'),('BRK.B');
create function is_member(l uuid) returns boolean language sql stable security definer as
  $$ select exists (select 1 from league_members m where m.league_id = l and m.user_id = auth.uid()::text) $$;
alter table leagues enable row level security;
alter table drafts enable row level security;
alter table league_members enable row level security;
-- Mirrors prod: leagues_select_member_or_commissioner / leagues_insert_self_commissioner.
create policy leagues_select on leagues for select using (is_member(id) or commissioner_id = auth.uid()::text);
create policy leagues_insert_self on leagues for insert to authenticated with check (commissioner_id = auth.uid()::text);
create policy leagues_update_commissioner on leagues for update to authenticated
  using (commissioner_id = auth.uid()::text) with check (commissioner_id = auth.uid()::text);
create policy drafts_select on drafts for select using (is_member(league_id));
create policy lm_select on league_members for select using (is_member(league_id));
`;

const C = '00000000-0000-4000-8000-00000000000c'; // commissioner
const A = '00000000-0000-4000-8000-00000000000a'; // member
const X = '00000000-0000-4000-8000-00000000000e'; // outsider

// deno-lint-ignore no-explicit-any
type Row = any;

Deno.test({
  name: 'draft pick clock + queue on real Postgres (PGlite)',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const db = new PGlite();
    const q = async (s: string, p: unknown[] = []) => (await db.query(s, p)).rows as Row[];
    const asUser = async (uid: string | null) => {
      await db.exec(`reset role`);
      if (uid) {
        await db.exec(`set role authenticated`);
        await q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
      } else {
        await q(`select set_config('request.jwt.claim.sub', '', false)`);
      }
    };
    // Backdate trigger-owned columns for deadline tests (triggers off).
    const raw = async (s: string, p: unknown[] = []) => {
      await db.exec(`set session_replication_role = replica`);
      try { return await q(s, p); } finally { await db.exec(`set session_replication_role = origin`); }
    };

    // Every step starts and ends as the superuser, so one failing step that
    // was running as authenticated/anon cannot cascade into the next ones.
    const step = (name: string, fn: () => Promise<void>) =>
      t.step(name, async () => {
        await asUser(null);
        try { await fn(); } finally { await asUser(null); }
      });

    await db.exec(SCHEMA);
    // Seeded BEFORE the migration: an in-progress draft the migration must
    // leave unclocked (Q2 hold), and a not-started league that must be clocked.
    const [legacy] = await q(`insert into leagues (name, commissioner_id, draft_status) values ('legacy',$1,'in_progress') returning id`, [C]);
    const [fresh] = await q(`insert into leagues (name, commissioner_id, draft_status) values ('fresh',$1,'not_started') returning id`, [C]);
    await q(`insert into drafts (league_id,user_id,symbol,pick_number) values ($1,'bot-1','SKIP',1),($1,'bot-2','AAPL',2),($1,$2,'MSFT',3)`, [legacy.id, C]);
    await db.exec(await Deno.readTextFile(GUARD));
    const migration = await Deno.readTextFile(MIGRATION);
    await db.exec(migration);

    const lg = async (id: string) => (await q(`select * from leagues where id=$1`, [id]))[0];
    const clock = async (id: string) => (await q(`select * from get_draft_clock($1)`, [id]))[0];
    async function mkLeague(members: string[], extra: Record<string, unknown> = {}) {
      const row: Record<string, unknown> = { name: 't', commissioner_id: members[0], ...extra };
      const cols = Object.keys(row);
      const [l] = await q(`insert into leagues (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')}) returning *`, Object.values(row));
      for (const m of members) await q(`insert into league_members values ($1,$2,'member')`, [l.id, m]);
      return l;
    }

    await step('grants: proacl matches the header; search_path pinned', async () => {
      const acl = async (name: string) =>
        (await q(`select proacl::text a, proconfig::text c from pg_proc where proname=$1`, [name]))[0];
      const clk = await acl('get_draft_clock');
      assert(!/anon=/.test(clk.a) && !/(^|[{,])=X/.test(clk.a), clk.a);
      assert(/authenticated=X/.test(clk.a) && /service_role=X/.test(clk.a), clk.a);
      const od = await acl('overdue_draft_turns');
      assert(!/anon=|authenticated=/.test(od.a) && !/(^|[{,])=X/.test(od.a), od.a);
      assert(/service_role=X/.test(od.a), od.a);
      const sq = await acl('set_draft_queue');
      assert(!/anon=/.test(sq.a) && !/(^|[{,])=X/.test(sq.a), sq.a);
      assert(/authenticated=X/.test(sq.a), sq.a);
      const tr = await acl('enforce_leagues_pick_clock');
      assert(!/anon=|authenticated=/.test(tr.a) && !/(^|[{,])=X/.test(tr.a), tr.a);
      for (const f of [clk, od, sq, tr]) assert(String(f.c).includes('search_path=public, pg_temp'), f.c);
    });

    await step('backfill: pre-existing in_progress draft is unclocked; others clocked', async () => {
      const L = await lg(legacy.id);
      assertEquals([L.pick_clock_enabled, L.draft_started_at, L.pick_seconds], [false, null, 60]);
      assertEquals((await lg(fresh.id)).pick_clock_enabled, true);
      const src = await q(`select pick_number, pick_source from drafts where league_id=$1 order by 1`, [legacy.id]);
      assertEquals(src.map((r: Row) => r.pick_source), ['skip', 'bot', 'manual']);
      assertEquals((await clock(legacy.id)).clock_running, false);
      assertEquals((await q(`select * from overdue_draft_turns()`)).length, 0);
      // Re-applying the migration changes nothing (idempotent DDL).
      await db.exec(migration);
      assertEquals((await lg(legacy.id)).pick_clock_enabled, false);
    });

    await step('pick_seconds CHECK: 30..90 in 15s steps only', async () => {
      for (const bad of [20, 50, 100, 29, 91]) {
        await assertRejects(() => q(`insert into leagues (name, commissioner_id, pick_seconds) values ('x',$1,$2)`, [C, bad]));
      }
      for (const ok of [30, 45, 60, 75, 90]) {
        await q(`insert into leagues (name, commissioner_id, pick_seconds) values ('x',$1,$2)`, [C, ok]);
      }
    });

    await step('trigger: draft_started_at stamped on start, direct writes discarded', async () => {
      const l = await mkLeague([C, A]);
      assertEquals((await lg(l.id)).draft_started_at, null);
      await q(`update leagues set draft_started_at = '2000-01-01' where id=$1`, [l.id]);
      assertEquals((await lg(l.id)).draft_started_at, null);
      await q(`update leagues set draft_status='in_progress' where id=$1`, [l.id]);
      const started = (await lg(l.id)).draft_started_at;
      assert(started !== null);
      await q(`update leagues set draft_started_at = '2000-01-01' where id=$1`, [l.id]);
      assertEquals(String((await lg(l.id)).draft_started_at), String(started));
    });

    await step('trigger: pick_seconds locked once the draft starts (service role too)', async () => {
      const l = await mkLeague([C, A]);
      await q(`update leagues set pick_seconds=90 where id=$1`, [l.id]); // not_started: ok
      assertEquals((await lg(l.id)).pick_seconds, 90);
      await q(`update leagues set draft_status='in_progress' where id=$1`, [l.id]);
      await assertRejects(() => q(`update leagues set pick_seconds=30 where id=$1`, [l.id]), Error, 'pick_seconds_locked');
      await asUser(C);
      await assertRejects(() => q(`update leagues set pick_seconds=30 where id=$1`, [l.id]), Error, 'pick_seconds_locked');
      await asUser(null);
    });

    await step('trigger: a commissioner cannot disable the clock or create an unclocked league', async () => {
      const l = await mkLeague([C, A]);
      await asUser(C);
      await q(`update leagues set pick_clock_enabled=false, pick_seconds=45 where id=$1`, [l.id]);
      await q(`update leagues set draft_status='in_progress' where id=$1`, [l.id]); // [I2a] direct flip
      await asUser(null);
      const L = await lg(l.id);
      assertEquals([L.pick_clock_enabled, L.pick_seconds, L.draft_status], [true, 45, 'in_progress']);
      assert(L.draft_started_at !== null, 'direct [I2a] flip still starts the clock');
      await asUser(C);
      const [n] = await q(`insert into leagues (name, commissioner_id, pick_clock_enabled) values ('sneaky',$1,false) returning pick_clock_enabled`, [C]);
      await asUser(null);
      assertEquals(n.pick_clock_enabled, true);
    });

    await step('trigger: operator opt-in of a legacy draft starts a FRESH clock', async () => {
      // Shape of a draft that was already running at push time (triggers off).
      const [l] = await raw(`insert into leagues (name, commissioner_id, draft_status, pick_clock_enabled) values ('old',$1,'in_progress',false) returning id`, [C]);
      assertEquals((await lg(l.id)).draft_started_at, null);
      await q(`update leagues set name='still old' where id=$1`, [l.id]); // unrelated edit: stays unclocked
      assertEquals([(await lg(l.id)).pick_clock_enabled, (await lg(l.id)).draft_started_at], [false, null]);
      await assertRejects(() => raw(`update leagues set pick_clock_enabled=true, draft_started_at=null where id=$1`, [l.id]));
      await q(`update leagues set pick_clock_enabled=true where id=$1`, [l.id]);
      const L = await lg(l.id);
      assert(L.pick_clock_enabled && L.draft_started_at !== null);
    });

    await step('get_draft_clock: deadline = GREATEST(start, last pick) + pick_seconds', async () => {
      const l = await mkLeague([C, A], { pick_seconds: 30 });
      assertEquals((await clock(l.id)).clock_running, false); // not started
      await q(`update leagues set draft_status='in_progress' where id=$1`, [l.id]);
      await raw(`update leagues set draft_started_at = now() - interval '100 seconds' where id=$1`, [l.id]);
      let c = await clock(l.id);
      assertEquals([c.clock_running, c.picks_made, c.pick_seconds], [true, 0, 30]);
      assertEquals(new Date(c.deadline_at).getTime() - new Date(c.turn_started_at).getTime(), 30_000);
      assert(new Date(c.deadline_at) <= new Date(c.server_now), 'overdue after 100s');
      // Chained: a pick recorded 10s ago re-anchors the NEXT turn to its own row.
      await q(`insert into drafts (league_id,user_id,symbol,pick_number,recorded_at) values ($1,$2,'AAPL',1, now() - interval '10 seconds')`, [l.id, C]);
      c = await clock(l.id);
      assertEquals(c.picks_made, 1);
      // The anchor IS the latest pick's own row (exact), not "about 10s ago".
      const [last] = await q(`select recorded_at from drafts where league_id=$1 and pick_number=1`, [l.id]);
      assertEquals(new Date(c.turn_started_at).getTime(), new Date(last.recorded_at).getTime());
      assertEquals(new Date(c.deadline_at).getTime() - new Date(last.recorded_at).getTime(), 30_000);
      assert(new Date(c.deadline_at) > new Date(c.server_now), 'next turn gets its full clock');
    });

    await step('overdue_draft_turns: only clocked, running, past-deadline drafts', async () => {
      const due = await mkLeague([C, A]);
      await q(`update leagues set draft_status='in_progress' where id=$1`, [due.id]);
      await raw(`update leagues set draft_started_at = now() - interval '61 seconds' where id=$1`, [due.id]);
      const notDue = await mkLeague([C, A]);
      await q(`update leagues set draft_status='in_progress' where id=$1`, [notDue.id]);
      await raw(`update leagues set draft_started_at = now() - interval '61 seconds', pick_clock_enabled = false where id=$1`, [legacy.id]);
      const rows = await q(`select * from overdue_draft_turns()`);
      const ids = rows.map((r: Row) => r.league_id);
      assert(ids.includes(due.id), 'past deadline is listed');
      assert(!ids.includes(notDue.id), 'within its clock is not listed');
      assert(!ids.includes(legacy.id), 'unclocked legacy draft is never listed');
      assertEquals(rows.find((r: Row) => r.league_id === due.id).pick_number, 1);
    });

    await step('grants in practice: anon/authenticated cannot list overdue drafts', async () => {
      await asUser(A);
      await assertRejects(() => q(`select * from overdue_draft_turns()`), Error, 'permission denied');
      await db.exec(`reset role; set role anon`);
      await assertRejects(() => q(`select * from get_draft_clock($1)`, [fresh.id]), Error, 'permission denied');
      await assertRejects(() => q(`select set_draft_queue($1, array['AAPL'])`, [fresh.id]), Error, 'permission denied');
      await asUser(null);
    });

    await step('get_draft_clock as a member vs an outsider (RLS)', async () => {
      const l = await mkLeague([C, A]);
      await q(`update leagues set draft_status='in_progress' where id=$1`, [l.id]);
      await asUser(A);
      assertEquals((await q(`select * from get_draft_clock($1)`, [l.id])).length, 1);
      await asUser(X);
      assertEquals((await q(`select * from get_draft_clock($1)`, [l.id])).length, 0);
      await asUser(null);
    });

    await step('set_draft_queue: normalize, dedupe, cap, unknown symbols, membership', async () => {
      const l = await mkLeague([C, A]);
      const call = async (syms: unknown) => (await q(`select set_draft_queue($1, $2::text[]) r`, [l.id, syms]))[0].r;
      await asUser(A);
      assertEquals(await call([' nvda', 'aapl', 'NVDA', '', 'brk.b']), { ok: true, symbols: ['NVDA', 'AAPL', 'BRK.B'] });
      assertEquals((await q(`select symbol, position from draft_queue where league_id=$1 order by position`, [l.id]))
        .map((r: Row) => `${r.position}:${r.symbol}`), ['1:NVDA', '2:AAPL', '3:BRK.B']);
      assertEquals(await call(['MSFT']), { ok: true, symbols: ['MSFT'] }); // replaces
      assertEquals((await call(['MSFT', 'ZZZZ', 'QQQQ'])).reason, 'unknown_symbols');
      assertEquals((await q(`select count(*)::int n from draft_queue where league_id=$1`, [l.id]))[0].n, 1, 'a refusal writes nothing');
      assertEquals((await call(Array.from({ length: 51 }, (_, i) => `S${i}`))).reason, 'too_many');
      assertEquals(await call([]), { ok: true, symbols: [] }); // clearing is allowed
      await asUser(X);
      assertEquals((await call(['AAPL'])).reason, 'not_a_member');
      await asUser(null);
      assertEquals((await call(['AAPL'])).reason, 'not_authenticated');
      await q(`update leagues set draft_status='completed' where id=$1`, [l.id]);
      await asUser(A);
      assertEquals((await call(['AAPL'])).reason, 'draft_completed');
      await asUser(null);
    });

    await step('draft_queue RLS: owner reads own rows; others see none; no direct writes', async () => {
      const l = await mkLeague([C, A]);
      await asUser(A);
      await q(`select set_draft_queue($1, array['AAPL','MSFT'])`, [l.id]);
      assertEquals((await q(`select * from draft_queue where league_id=$1`, [l.id])).length, 2);
      await assertRejects(() => q(`insert into draft_queue (league_id,user_id,symbol,position) values ($1,$2,'NVDA',3)`, [l.id, A]), Error, 'permission denied');
      await assertRejects(() => q(`delete from draft_queue where league_id=$1`, [l.id]), Error, 'permission denied');
      await asUser(C); // same league, different manager
      assertEquals((await q(`select * from draft_queue where league_id=$1`, [l.id])).length, 0);
      await asUser(null);
      await db.exec(`reset role; set role anon`);
      await assertRejects(() => q(`select * from draft_queue`), Error, 'permission denied');
      await asUser(null);
    });

    await step('race: two writers for the same pick_number -> exactly one row (23505)', async () => {
      const l = await mkLeague([C, A]);
      await q(`insert into drafts (league_id,user_id,symbol,pick_number,pick_source) values ($1,$2,'AAPL',1,'manual')`, [l.id, C]);
      const err = await assertRejects(() =>
        q(`insert into drafts (league_id,user_id,symbol,pick_number,pick_source) values ($1,$2,'MSFT',1,'auto_queue')`, [l.id, C]));
      assertEquals((err as { code?: string }).code, '23505');
      assertEquals((await q(`select count(*)::int n from drafts where league_id=$1`, [l.id]))[0].n, 1);
    });

    await step('pick_source CHECK refuses unknown values', async () => {
      const l = await mkLeague([C, A]);
      await assertRejects(() => q(`insert into drafts (league_id,user_id,symbol,pick_number,pick_source) values ($1,$2,'AAPL',1,'auto')`, [l.id, C]));
    });

    // The prod SQL-editor effect test, executed here first so a parse or
    // logic bug surfaces before Giorgio's run. It ends by RAISING its result
    // table; every line must PASS, and nothing it wrote may survive.
    await step('docs/security/draft-pick-clock-effect-test.sql: all PASS, fully rolled back', async () => {
      const before = (await q(`select count(*)::int n from leagues`))[0].n;
      const err = await assertRejects(async () => { await db.exec(await Deno.readTextFile(EFFECT_TEST)); });
      const msg = String((err as Error).message);
      assert(msg.includes('DRAFT PICK CLOCK EFFECT TEST RESULTS'), msg);
      assert(!msg.includes('FAIL'), msg);
      assertEquals(msg.match(/PASS/g)?.length, 24, msg);
      assertEquals((await q(`select count(*)::int n from leagues`))[0].n, before, 'fixture rolled back');
    });
  },
});
