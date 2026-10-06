/**
 * 20261104000000_freeze_league_rules_after_draft_start against REAL Postgres
 * (PGlite). NOT hermetic: the first run fetches npm:@electric-sql/pglite.
 * Run instructions: supabase/tests/README.md.
 *
 * Loads VERBATIM, in prod order: the B1 helpers (20260712000000), the leagues
 * RLS policies (20260712000001), the F1 member column guard (20260925000000),
 * the playoff_teams freeze (20261012000002), league_draft_slots + its interim
 * commissioner policies (20260810000004), then the migration under test.
 * leagues is a replica of the columns those files and the new trigger touch,
 * with the real draft_status CHECK. Supabase's default anon/authenticated
 * grants are simulated, so the proacl step proves the explicit REVOKEs.
 *
 * It also runs docs/security/freeze-league-rules-effect-test.sql (the human
 * post-push block) verbatim and requires all 13 lines to PASS.
 *
 * Writes run as `authenticated` with a JWT sub, so the real interim policies
 * admit the commissioner and the triggers are what refuse them. The service
 * role is `service_role` (bypassrls) with no sub, as in prod.
 *
 * What one connection cannot show: two transactions racing on the league row.
 * The 'lock' steps pin that the slot trigger takes a row lock on the league
 * (xmax) and that both same-transaction orders (league first, slots first)
 * complete; the no-deadlock argument for the two-transaction case is in the
 * migration header.
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';

const ROOT = new URL('../../', import.meta.url);
const MIGRATIONS = [
  '20260712000000_rls_b1_00_helpers.sql',
  '20260712000001_rls_b1_01_leagues.sql',
  '20260925000000_leagues_member_draft_complete_column_guard.sql',
  '20261012000002_freeze_playoff_teams_after_draft_start.sql',
  '20260810000004_create_league_draft_slots.sql',
  '20261104000000_freeze_league_rules_after_draft_start.sql',
].map((f) => new URL(`supabase/migrations/${f}`, ROOT));

const SCHEMA = `
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
-- Supabase's own definition: the legacy per-claim GUC, else request.jwt.claims (what
-- PostgREST and the effect file's set_config set).
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
create table leagues (
  id uuid primary key default gen_random_uuid(), name text, commissioner_id text not null, invite_code text unique,
  draft_status text not null default 'not_started'
    check (draft_status in ('not_started', 'in_progress', 'completed')),
  draft_date timestamptz, stake_mode text, budget_amount numeric(12,2),
  notional_per_slot numeric, num_rounds int, allow_undraftable boolean not null default false,
  num_weeks int, duration_days int, league_type text, num_participants int,
  playoff_teams int, league_start_date timestamptz, league_end_date timestamptz);
create table league_members (league_id uuid not null references leagues(id) on delete cascade,
  user_id text not null, role text, primary key (league_id, user_id));
create table categories (id uuid primary key default gen_random_uuid(), name text);
`;

const COMMISH = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';

// The nine frozen columns, each with a value that differs from the fixture's.
const FROZEN: Record<string, unknown> = {
  stake_mode: 'budget_cap',
  budget_amount: 999,
  notional_per_slot: 5000,
  num_rounds: 9,
  allow_undraftable: true,
  num_weeks: 14,
  duration_days: 60,
  league_type: 'duration',
  num_participants: 6,
};
const FIXTURE = {
  name: 'L', draft_date: '2026-11-10T20:00:00Z', stake_mode: 'price_tiers', budget_amount: 250,
  notional_per_slot: 1000, num_rounds: 6, allow_undraftable: false, num_weeks: 11,
  duration_days: 30, league_type: 'matchup', num_participants: 8, playoff_teams: 4,
};

// deno-lint-ignore no-explicit-any
type Row = any;

Deno.test({
  name: 'freeze league rules + slots after draft start on real Postgres (PGlite)',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const db = new PGlite();
    const q = async (s: string, p: unknown[] = []) => (await db.query(s, p)).rows as Row[];
    await db.exec(SCHEMA);
    for (const m of MIGRATIONS) await db.exec(await Deno.readTextFile(m));

    // ---- sessions ---------------------------------------------------------
    async function as<T>(who: 'commish' | 'member' | 'service', fn: () => Promise<T>): Promise<T> {
      if (who === 'service') {
        await db.exec(`set role service_role; reset request.jwt.claim.sub;`);
      } else {
        await db.exec(`set role authenticated; set request.jwt.claim.sub = '${who === 'commish' ? COMMISH : MEMBER}';`);
      }
      try {
        return await fn();
      } finally {
        await db.exec(`reset role; reset request.jwt.claim.sub;`);
      }
    }
    async function refused(fn: () => Promise<unknown>, needle: string, code = '42501') {
      let err: Row = null;
      try {
        await fn();
      } catch (e) {
        err = e;
      }
      assert(err, `expected a refusal containing "${needle}", but the write succeeded`);
      assertEquals(err.code, code, `${err.message}`);
      assert(String(err.message).includes(needle), `expected "${needle}" in: ${err.message}`);
      return String(err.message);
    }

    // ---- fixtures (service role / owner) ----------------------------------
    async function league(status: string, extra: Record<string, unknown> = {}): Promise<string> {
      const row = { ...FIXTURE, commissioner_id: COMMISH, ...extra };
      const keys = Object.keys(row);
      const [l] = await q(
        `insert into leagues (${keys.join(',')}) values (${keys.map((_, i) => '$' + (i + 1)).join(',')}) returning id`,
        Object.values(row),
      );
      await q(`insert into league_members (league_id, user_id) values ($1,$2),($1,$3)`, [l.id, COMMISH, MEMBER]);
      await q(`insert into league_draft_slots (league_id, slot_index, slot_count, price_min, price_max)
        values ($1,0,3,null,50),($1,1,3,50,null)`, [l.id]);
      if (status !== 'not_started') await q(`update leagues set draft_status=$2 where id=$1`, [l.id, status]);
      return l.id;
    }
    const slots = async (L: string) =>
      (await q(`select slot_index, slot_count, price_min::text pmin, price_max::text pmax
        from league_draft_slots where league_id=$1 order by slot_index`, [L]));
    const rules = async (L: string) =>
      (await q(`select ${Object.keys(FROZEN).join(',')}, budget_amount::text ba from leagues where id=$1`, [L]))[0];
    const status = async (L: string) => (await q(`select draft_status s from leagues where id=$1`, [L]))[0].s;

    // The two client write shapes, as PostgREST issues them.
    const saveLeagueSlots = async (L: string) => {
      // apps/mobile/lib/categoryData.ts + apps/web/src/hooks/useLeagues.js: delete all, insert the set.
      await q(`delete from league_draft_slots where league_id=$1`, [L]);
      await q(`insert into league_draft_slots (league_id, slot_index, slot_count, price_min, price_max)
        values ($1,0,2,null,20),($1,1,2,20,100),($1,2,2,100,null)`, [L]);
    };

    // ---- structure --------------------------------------------------------
    await t.step('structure: both triggers enabled, functions locked down, search_path pinned', async () => {
      const tg = await q(`select tgname, tgrelid::regclass::text rel, tgenabled e from pg_trigger
        where tgname in ('trg_league_draft_slots_freeze','trg_leagues_freeze_rules') order by tgname`);
      assertEquals(tg.map((r: Row) => [r.tgname, r.rel, r.e]), [
        ['trg_league_draft_slots_freeze', 'league_draft_slots', 'O'],
        ['trg_leagues_freeze_rules', 'leagues', 'O'],
      ]);
      const fns = await q(`select proname, prosecdef, proconfig, coalesce(proacl::text,'') acl from pg_proc
        where proname in ('enforce_league_draft_slots_frozen','enforce_league_rules_frozen_after_draft_start')
        order by proname`);
      assertEquals(fns.length, 2);
      assertEquals(fns.map((f: Row) => [f.proname, f.prosecdef]), [
        ['enforce_league_draft_slots_frozen', true],
        ['enforce_league_rules_frozen_after_draft_start', false],
      ]);
      for (const f of fns) {
        assert(f.acl !== '', `${f.proname}: proacl NULL means default PUBLIC execute`);
        assert(!/(^|[{,])=X/.test(f.acl), `${f.proname}: PUBLIC grant survives: ${f.acl}`);
        assert(!/anon=|authenticated=/.test(f.acl), `${f.proname}: default role grant survives: ${f.acl}`);
        assertEquals(f.proconfig, ['search_path=public, pg_temp']);
      }
    });

    // ---- pre-draft: the commissioner keeps full control -------------------
    await t.step('pre-draft: commissioner inserts, updates, deletes slots and edits every rule', async () => {
      const L = await league('not_started');
      await as('commish', async () => {
        await saveLeagueSlots(L);
        await q(`update league_draft_slots set slot_count = 3 where league_id=$1 and slot_index=0`, [L]);
        await q(`delete from league_draft_slots where league_id=$1 and slot_index=2`, [L]);
        for (const [col, v] of Object.entries(FROZEN)) await q(`update leagues set ${col}=$2 where id=$1`, [L, v]);
      });
      assertEquals(await slots(L), [
        { slot_index: 0, slot_count: 3, pmin: null, pmax: '20' },
        { slot_index: 1, slot_count: 2, pmin: '20', pmax: '100' },
      ]);
      const r = await rules(L);
      for (const [col, v] of Object.entries(FROZEN)) {
        assertEquals(typeof v === 'number' ? Number(r[col]) : r[col], v, col);
      }
    });

    // ---- post-draft: refused, and nothing is written ----------------------
    for (const st of ['in_progress', 'completed']) {
      await t.step(`${st}: every slot INSERT / UPDATE / DELETE is refused and writes nothing`, async () => {
        const L = await league(st);
        const before = await slots(L);
        await as('commish', async () => {
          await refused(() => q(`insert into league_draft_slots (league_id, slot_index, slot_count) values ($1,5,1)`, [L]),
            'league_slots_locked');
          await refused(() => q(`update league_draft_slots set price_max = 10 where league_id=$1 and slot_index=0`, [L]),
            'league_slots_locked');
          await refused(() => q(`delete from league_draft_slots where league_id=$1 and slot_index=1`, [L]),
            'league_slots_locked');
          // The whole client save fails on its first statement, loudly (not a silent 0-row delete).
          await refused(() => saveLeagueSlots(L), 'league_slots_locked');
        });
        assertEquals(await slots(L), before);
      });

      await t.step(`${st}: each frozen column is refused on its own, naming the column`, async () => {
        const L = await league(st);
        const before = await rules(L);
        for (const [col, v] of Object.entries(FROZEN)) {
          const msg = await as('commish', () =>
            refused(() => q(`update leagues set ${col}=$2 where id=$1`, [L, v]), 'league_rules_locked'));
          assert(msg.includes(`(${col})`), `message should name ${col}: ${msg}`);
          // NULL is a change too (IS DISTINCT FROM, not =).
          if (col !== 'allow_undraftable') {
            await as('commish', () =>
              refused(() => q(`update leagues set ${col}=null where id=$1`, [L]), 'league_rules_locked'));
          }
        }
        assertEquals(await rules(L), before);
      });
    }

    await t.step('completed: a multi-column change names every changed column', async () => {
      const L = await league('completed');
      const msg = await as('commish', () =>
        refused(() => q(`update leagues set num_rounds=9, stake_mode='budget_cap', name='x' where id=$1`, [L]),
          'league_rules_locked'));
      assert(msg.includes('(stake_mode, num_rounds)'), msg);
      assertEquals((await q(`select name from leagues where id=$1`, [L]))[0].name, 'L');
    });

    // ---- what must keep working post-draft --------------------------------
    await t.step('completed: the same-value patch shapes of both settings screens still save', async () => {
      const L = await league('completed');
      await as('commish', async () => {
        // apps/mobile/app/league-settings.tsx handleSave patch (stakeMode set; budget_cap only when chosen).
        await q(`update leagues set name=$2, draft_date=$3, num_participants=$4, num_rounds=$5,
          allow_undraftable=$6, stake_mode=$7, notional_per_slot=$8 where id=$1`,
          [L, 'Renamed', '2026-11-11T20:00:00Z', 8, 6, false, 'price_tiers', 1000]);
        // apps/web/src/pages/Leagues.jsx handleUpdate patch; budget_amount sent unscaled (250 vs numeric(12,2) 250.00).
        await q(`update leagues set draft_date=$2, num_participants=$3, num_rounds=$4, allow_undraftable=$5,
          stake_mode=$6, notional_per_slot=$7, budget_amount=$8 where id=$1`,
          [L, '2026-11-12T20:00:00Z', 8, 6, false, 'price_tiers', 1000, 250]);
      });
      const [r] = await q(`select name, draft_date::text d, budget_amount::text ba from leagues where id=$1`, [L]);
      assertEquals([r.name, r.ba], ['Renamed', '250.00']);
      assert(r.d.startsWith('2026-11-12'), r.d);
    });

    await t.step('one UPDATE that changes a rule AND starts the draft is judged on OLD and allowed', async () => {
      const L = await league('not_started');
      await as('commish', () => q(`update leagues set num_rounds=7, num_weeks=12, draft_status='in_progress' where id=$1`, [L]));
      const [r] = await q(`select num_rounds, num_weeks, draft_status from leagues where id=$1`, [L]);
      assertEquals([r.num_rounds, r.num_weeks, r.draft_status], [7, 12, 'in_progress']);
      // ...and the very next edit is frozen.
      await as('commish', () => refused(() => q(`update leagues set num_rounds=6 where id=$1`, [L]), 'league_rules_locked'));
    });

    await t.step('service role: slots and rules stay writable after the draft (repairs, finalize_league_draft)', async () => {
      const L = await league('completed', { num_weeks: null });
      await as('service', async () => {
        await saveLeagueSlots(L);
        await q(`update league_draft_slots set slot_count=5 where league_id=$1 and slot_index=0`, [L]);
        await q(`delete from league_draft_slots where league_id=$1 and slot_index=2`, [L]);
        // finalize_league_draft's num_weeks = coalesce(num_weeks, max_week) stamp.
        await q(`update leagues set num_weeks = coalesce(num_weeks, 11) where id=$1`, [L]);
        for (const [col, v] of Object.entries(FROZEN)) await q(`update leagues set ${col}=$2 where id=$1`, [L, v]);
      });
      assertEquals((await slots(L)).length, 2);
      assertEquals((await rules(L)).num_rounds, 9);
    });

    // ---- draft_status transition table ------------------------------------
    await t.step('draft_status: the three forward moves are allowed for user sessions', async () => {
      const a = await league('not_started');
      await as('commish', () => q(`update leagues set draft_status='in_progress' where id=$1`, [a]));
      // [I2b]: a NON-commissioner member completes the draft (F1 carve-out), through every trigger.
      await as('member', () => q(`update leagues set draft_status='completed' where id=$1`, [a]));
      const b = await league('not_started');
      await as('commish', () => q(`update leagues set draft_status='completed' where id=$1`, [b])); // [I2a] direct jump
      assertEquals([await status(a), await status(b)], ['completed', 'completed']);
    });

    await t.step('draft_status: every backward move is refused for the commissioner; service role may', async () => {
      for (const [from, to] of [['completed', 'not_started'], ['completed', 'in_progress'], ['in_progress', 'not_started']]) {
        const L = await league(from);
        const msg = await as('commish', () =>
          refused(() => q(`update leagues set draft_status=$2 where id=$1`, [L, to]), 'league_draft_status_locked'));
        assert(msg.includes(`from ${from} to ${to}`), msg);
        assertEquals(await status(L), from);
        await as('service', () => q(`update leagues set draft_status=$2 where id=$1`, [L, to]));
        assertEquals(await status(L), to);
      }
    });

    await t.step('draft_status: the rewind bypass is closed end to end (slots, rules, playoff_teams)', async () => {
      const L = await league('completed');
      await as('commish', async () => {
        await refused(() => q(`update leagues set draft_status='not_started' where id=$1`, [L]), 'league_draft_status_locked');
        // A rewind bundled with the edits it was meant to unlock is refused on the status move.
        await refused(() => q(`update leagues set draft_status='not_started', num_rounds=9 where id=$1`, [L]),
          'league_draft_status_locked');
        // With playoff_teams in the bundle, trg_leagues_freeze_playoff_teams sorts first and refuses it.
        await refused(() => q(`update leagues set draft_status='not_started', playoff_teams=2 where id=$1`, [L]),
          'playoff_teams_locked');
        await refused(() => q(`delete from league_draft_slots where league_id=$1`, [L]), 'league_slots_locked');
      });
      const [r] = await q(`select draft_status, num_rounds, playoff_teams from leagues where id=$1`, [L]);
      assertEquals([r.draft_status, r.num_rounds, r.playoff_teams], ['completed', 6, 4]);
    });

    // ---- other callers / edges --------------------------------------------
    await t.step('re-parenting a slot into OR out of a started league is refused', async () => {
      const open = await league('not_started');
      const done = await league('completed');
      await as('commish', async () => {
        await refused(() => q(`update league_draft_slots set league_id=$2, slot_index=9 where league_id=$1 and slot_index=0`,
          [done, open]), 'league_slots_locked');
        await refused(() => q(`update league_draft_slots set league_id=$2, slot_index=9 where league_id=$1 and slot_index=0`,
          [open, done]), 'league_slots_locked');
      });
      assertEquals((await slots(open)).length, 2);
      assertEquals((await slots(done)).length, 2);
    });

    await t.step('upsert (ON CONFLICT DO UPDATE): slot re-parent and rule change are refused', async () => {
      const open = await league('not_started');
      const done = await league('completed');
      const [s] = await q(`select id from league_draft_slots where league_id=$1 and slot_index=0`, [done]);
      await as('commish', async () => {
        // The INSERT arm passes (open league); the DO UPDATE arm sees OLD.league_id = the started one.
        await refused(() => q(`insert into league_draft_slots (id, league_id, slot_index, slot_count) values ($1,$2,9,1)
          on conflict (id) do update set league_id = excluded.league_id, slot_index = excluded.slot_index`, [s.id, open]),
          'league_slots_locked');
        await refused(() => q(`insert into leagues (id, commissioner_id, num_rounds) values ($1,$2,9)
          on conflict (id) do update set num_rounds = excluded.num_rounds`, [done, COMMISH]), 'league_rules_locked');
      });
      assertEquals((await slots(done)).length, 2);
      assertEquals((await rules(done)).num_rounds, 6);
    });

    await t.step('the exemption is unreachable from a user session: anon, and authenticated with an empty sub', async () => {
      const L = await league('completed');
      // anon (publishable key, no session): auth.uid() IS NULL, so the trigger exempts it, and RLS refuses.
      await db.exec(`set role anon; reset request.jwt.claim.sub;`);
      try {
        await refused(() => q(`insert into league_draft_slots (league_id, slot_index) values ($1,7)`, [L]), 'row-level security');
        assertEquals(await q(`update leagues set num_rounds=9 where id=$1 returning id`, [L]), []);
        assertEquals(await q(`delete from league_draft_slots where league_id=$1 returning id`, [L]), []);
      } finally {
        await db.exec(`reset role;`);
      }
      // authenticated with an empty sub: auth.uid() IS NULL too; is_commissioner() is false, so RLS refuses.
      await db.exec(`set role authenticated; set request.jwt.claim.sub = '';`);
      try {
        await refused(() => q(`insert into league_draft_slots (league_id, slot_index) values ($1,7)`, [L]), 'row-level security');
        assertEquals(await q(`update leagues set num_rounds=9 where id=$1 returning id`, [L]), []);
      } finally {
        await db.exec(`reset role; reset request.jwt.claim.sub;`);
      }
      assertEquals((await slots(L)).length, 2);
      assertEquals((await rules(L)).num_rounds, 6);
    });

    await t.step('a league INSERTed already completed (allowed by [I1]) cannot then receive slots', async () => {
      const id = crypto.randomUUID();
      await as('commish', async () => {
        await q(`insert into leagues (id, commissioner_id, draft_status, num_rounds) values ($1,$2,'completed',6)`, [id, COMMISH]);
        await refused(() => q(`insert into league_draft_slots (league_id, slot_index) values ($1,0)`, [id]), 'league_slots_locked');
      });
      assertEquals(await status(id), 'completed');
      assertEquals((await slots(id)).length, 0);
    });

    await t.step('cascade: the commissioner can still delete a completed league with slots', async () => {
      const L = await league('completed');
      await as('commish', () => q(`delete from leagues where id=$1`, [L]));
      assertEquals((await q(`select count(*)::int n from leagues where id=$1`, [L]))[0].n, 0);
      assertEquals((await slots(L)).length, 0);
    });

    await t.step('a non-commissioner member is still refused pre-draft (RLS / F1, unchanged)', async () => {
      const L = await league('not_started');
      await as('member', async () => {
        await refused(() => q(`insert into league_draft_slots (league_id, slot_index) values ($1,7)`, [L]),
          'row-level security');
        // [I2b] admits a member only on an in_progress row, so this matches 0 rows: no error, no write.
        assertEquals(await q(`update leagues set num_rounds=9 where id=$1 returning id`, [L]), []);
      });
      assertEquals((await rules(L)).num_rounds, 6);
    });

    // ---- the lock ----------------------------------------------------------
    await t.step('lock: a slot write takes a tuple lock on its league (xmax; FOR SHARE vs KEY SHARE is not distinguishable here)', async () => {
      const L = await league('not_started');
      await db.exec('begin');
      try {
        await as('commish', () => q(`update league_draft_slots set slot_count=4 where league_id=$1 and slot_index=0`, [L]));
        // An UPDATE that keeps league_id fires no FK check, so only the trigger can have locked the league row.
        const [r] = await q(`select xmax::text x, (txid_current() % 4294967296)::text me from leagues where id=$1`, [L]);
        assertEquals(r.x, r.me, 'the league row must be locked by this transaction');
      } finally {
        await db.exec('rollback');
      }
    });

    await t.step('lock: both same-transaction orders complete on one connection (league first, slots first)', async () => {
      const L = await league('not_started');
      // League first (start_renewed_season's order): the row lock is held, then the slot trigger's SHARE.
      await db.exec('begin');
      await as('commish', async () => {
        await q(`update leagues set name='first' where id=$1`, [L]);
        await q(`insert into league_draft_slots (league_id, slot_index) values ($1,2)`, [L]);
      });
      await db.exec('commit');
      // Slots first, then the draft starts in the same transaction (SHARE -> upgrade by its holder).
      await db.exec('begin');
      await as('commish', async () => {
        await q(`insert into league_draft_slots (league_id, slot_index) values ($1,3)`, [L]);
        await q(`update leagues set draft_status='in_progress' where id=$1`, [L]);
      });
      await db.exec('commit');
      assertEquals((await slots(L)).length, 4);
      assertEquals(await status(L), 'in_progress');
      // Sequential, not a race: after the start commits, the next slot write sees it. The two-transaction
      // race is argued in the migration header (PGlite has one connection).
      await as('commish', () =>
        refused(() => q(`insert into league_draft_slots (league_id, slot_index) values ($1,4)`, [L]), 'league_slots_locked'));
    });

    // ---- the human effect block, verbatim ---------------------------------
    await t.step('effect test: docs/security/freeze-league-rules-effect-test.sql passes verbatim, writes nothing', async () => {
      const sql = await Deno.readTextFile(new URL('docs/security/freeze-league-rules-effect-test.sql', ROOT));
      const leaguesBefore = (await q(`select count(*)::int n from leagues`))[0].n;
      let msg = '';
      try {
        await db.exec(sql);
      } catch (e) {
        msg = String((e as Error).message);
      }
      assert(msg.startsWith('FREEZE LEAGUE RULES EFFECT TEST RESULTS'), `the block must end by raising: ${msg}`);
      const lines = msg.split('\n').slice(1).filter((l) => l.trim());
      assertEquals(lines.length, 13, msg);
      for (const l of lines) assert(/  PASS$/.test(l), `not PASS: ${l}`);
      assertEquals((await q(`select count(*)::int n from leagues`))[0].n, leaguesBefore, 'the fixtures must roll back');
      assertEquals((await q(`select current_user u`))[0].u, 'postgres', 'role switch must not leak');
    });

    // ---- fail closed on values outside the CHECK set (LAST: drops the CHECK) --
    await t.step('fail closed: an unknown or NULL draft_status freezes everything and allows no move', async () => {
      await db.exec(`alter table leagues drop constraint leagues_draft_status_check;
        alter table leagues alter column draft_status drop not null;`);
      for (const odd of ['paused', null]) {
        const L = await league('not_started');
        await q(`update leagues set draft_status=$2 where id=$1`, [L, odd]); // owner: no JWT
        await as('commish', async () => {
          await refused(() => q(`insert into league_draft_slots (league_id, slot_index) values ($1,8)`, [L]), 'league_slots_locked');
          await refused(() => q(`update leagues set num_rounds=9 where id=$1`, [L]), 'league_rules_locked');
          for (const to of ['not_started', 'in_progress', 'completed']) {
            await refused(() => q(`update leagues set draft_status=$2 where id=$1`, [L, to]), 'league_draft_status_locked');
          }
          // A same-status, non-rule edit still saves.
          await q(`update leagues set name='still editable' where id=$1`, [L]);
        });
        const L2 = await league('completed');
        await as('commish', () =>
          refused(() => q(`update leagues set draft_status=$2 where id=$1`, [L2, odd]), 'league_draft_status_locked'));
      }
    });

    await db.close();
  },
});
