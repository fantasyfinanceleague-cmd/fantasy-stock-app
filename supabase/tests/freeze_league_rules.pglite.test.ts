/**
 * 20261104000000_freeze_league_rules_after_draft_start against REAL Postgres
 * (PGlite). NOT hermetic: the first run fetches npm:@electric-sql/pglite.
 * Run instructions: supabase/tests/README.md.
 *
 * Loads VERBATIM, in prod order: the drafts RLS (20251205110000, incl. the live
 * "Commissioners can delete picks") and its INSERT-policy drop (20260811000003),
 * the B1 helpers (20260712000000), the leagues
 * and league_members RLS policies (20260712000001/02, incl. [I5] delete-self),
 * league_draft_slots + its interim commissioner policies (20260810000004), the
 * F1 member column guard (20260925000000), the pick clock (20261010000000), the
 * playoff_teams freeze (20261012000002) and draft order modes (20261013000000:
 * trg_leagues_order_mode / trg_leagues_order_start / trg_league_members_draft_order),
 * then the migration under test -- so every BEFORE/AFTER trigger on leagues and
 * league_members that prod has fires here, in prod's order.
 * leagues is NOT hand-written: it is built by replaying every CREATE TABLE /
 * ALTER TABLE ... ADD|DROP|RENAME COLUMN on leagues from supabase/migrations/
 * in order (FK REFERENCES clauses stripped; the referenced tables are not
 * here). So the triggers run against the real column set, types and inline
 * CHECKs, and the 'classification' step can require that EVERY column is
 * classified: a new column fails this test until someone decides whether it
 * is frozen after the draft. Supabase's default anon/authenticated grants are
 * simulated, so the proacl step proves the explicit REVOKEs.
 *
 * It also runs docs/security/freeze-league-rules-effect-test.sql (the human
 * post-push block) verbatim and requires all of its lines to PASS.
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
const MIGRATIONS = [   // prod (timestamp) order
  '20251205110000_enable_drafts_rls.sql',
  '20260712000000_rls_b1_00_helpers.sql',
  '20260712000001_rls_b1_01_leagues.sql',
  '20260712000002_rls_b1_02_league_members.sql',
  '20260810000004_create_league_draft_slots.sql',
  '20260811000003_drafts_drop_direct_client_insert.sql',
  '20260925000000_leagues_member_draft_complete_column_guard.sql',
  '20261010000000_draft_pick_clock_and_queue.sql',
  '20261012000002_freeze_playoff_teams_after_draft_start.sql',
  '20261013000000_draft_order_modes.sql',
  '20261104000000_freeze_league_rules_after_draft_start.sql',
].map((f) => new URL(`supabase/migrations/${f}`, ROOT));

const SCHEMA_PRE = `
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
`;
const SCHEMA_POST = `
create table league_members (league_id uuid not null references leagues(id) on delete cascade,
  user_id text not null, role text, joined_at timestamptz not null default clock_timestamp(),
  primary key (league_id, user_id));
create table categories (id uuid primary key default gen_random_uuid(), slug text unique, name text);
-- Stubs the pick-clock / draft-order SQL functions are validated against (as in
-- draft_order_modes.pglite.test.ts).
-- drafts is prod-only (no CREATE TABLE in the repo): the columns insertGatedPick writes. league_id's FK
-- is modelled as ON DELETE CASCADE; the effect block's F2 line reports prod's actual FK.
create table drafts (id serial primary key, league_id uuid not null references leagues(id) on delete cascade,
  user_id text, symbol text, entry_price numeric, quantity numeric, round int, pick_number int,
  slot_id uuid, created_at timestamptz default now());
create table draft_sessions (id serial primary key, league_id uuid);
create table draft_settings (id serial primary key, league_id uuid);
create table symbols (symbol text primary key, active boolean default true, is_draftable boolean not null default false,
  price_unsupported boolean not null default false, last_price numeric, market_cap numeric, gics_industry text);
create table category_rules (gics_industry text unique not null, category_id uuid not null references categories(id));
create table symbol_category_overrides (symbol text not null, category_id uuid not null references categories(id),
  unique (symbol, category_id));
`;

/**
 * Every leagues DDL statement in the migrations that shapes its COLUMNS, in
 * apply order (deferred/ is not applied, so not read). Line and block comments
 * are stripped and statements split on ';'. FK REFERENCES clauses are
 * stripped (the referenced tables are not in this replica).
 *
 * COMPLETENESS: every statement that mentions `table leagues` is either
 * replayed (CREATE TABLE, or ALTER with ADD|DROP|RENAME COLUMN) or one of the
 * known non-column forms (constraints, RLS, ALTER COLUMN defaults). Anything
 * else -- `ADD foo int` without COLUMN, a quoted "leagues", DDL inside a DO
 * block or a function body -- lands in `unhandled` and fails the
 * classification step, so the replay can never silently miss a column.
 */
async function leaguesColumnDdl(): Promise<{ ddl: string[]; unhandled: string[] }> {
  const dir = new URL('supabase/migrations/', ROOT);
  const files: string[] = [];
  for await (const e of Deno.readDir(dir)) if (e.isFile && e.name.endsWith('.sql')) files.push(e.name);
  files.sort();
  const ddl: string[] = [];
  const unhandled: string[] = [];
  const mentions = /\b(create|alter)\s+table\s+(if\s+(not\s+)?exists\s+)?(only\s+)?("?public"?\s*\.\s*)?"?leagues"?(?![\w])/i;
  const startsWith = /^(create\s+table(\s+if\s+not\s+exists)?|alter\s+table(\s+if\s+exists)?(\s+only)?)\s+(public\.)?leagues\b/i;
  const nonColumn = /^alter\s+table(\s+if\s+exists)?(\s+only)?\s+(public\.)?leagues\s+((add|drop)\s+constraint\b|(enable|disable|force|no\s+force)\s+row\s+level\s+security\b|alter\s+column\s+\w+\s+(set|drop)\s+(default|not\s+null)\b|replica\s+identity\b)/i;
  for (const f of files) {
    const sql = (await Deno.readTextFile(new URL(f, dir))).replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
    for (const raw of sql.split(';')) {
      const st = raw.trim();
      if (!mentions.test(st)) continue;
      if (!startsWith.test(st)) { unhandled.push(`${f}: ${st.slice(0, 120)}`); continue; }
      if (/^create/i.test(st) || /\b(add|drop|rename)\s+column\b/i.test(st)) {
        ddl.push(st.replace(
          /\breferences\s+[\w.]+\s*(\([^)]*\))?(\s+on\s+(delete|update)\s+(set\s+null|cascade|restrict|no\s+action|set\s+default))*/gi, ''));
      } else if (!nonColumn.test(st)) {
        unhandled.push(`${f}: ${st.slice(0, 120)}`);
      }
    }
  }
  return { ddl, unhandled };
}

const COMMISH = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';
const SEASON = '33333333-3333-4333-8333-333333333333';

/**
 * EVERY leagues column, classified. The 'classification' step fails when the
 * migrations add a column that is not here (or this lists one that is gone).
 *   frozen      -- trg_leagues_freeze_rules: no value change once the draft
 *                  has started (each one is exercised via FROZEN below);
 *   stamp_once  -- trg_leagues_freeze_rules: NULL -> value once (F1's carve-out);
 *   guarded     -- frozen/managed by another named guard (`by`);
 *   editable    -- deliberately writable by the commissioner after the draft.
 * F1 (20260925000000) additionally pins every column for a NON-commissioner
 * member except draft_status + the first-time date stamp, so the classes
 * below describe the COMMISSIONER's post-draft rights.
 */
type Kind = 'frozen' | 'stamp_once' | 'guarded' | 'editable';
const CLASSIFICATION: Record<string, { kind: Kind; by?: string; why?: string }> = {
  stake_mode: { kind: 'frozen' },
  budget_amount: { kind: 'frozen' },
  notional_per_slot: { kind: 'frozen' },
  num_rounds: { kind: 'frozen' },
  allow_undraftable: { kind: 'frozen' },
  num_weeks: { kind: 'frozen' },
  duration_days: { kind: 'frozen' },
  league_type: { kind: 'frozen' },
  num_participants: { kind: 'frozen' },
  season_status: { kind: 'frozen' },
  current_week: { kind: 'frozen' },
  current_season_id: { kind: 'frozen' },
  commissioner_id: { kind: 'frozen' },
  budget_mode: { kind: 'frozen', why: 'retired; frozen so it is not writable-but-meaningless (ruling 2026-11-04)' },
  league_start_date: { kind: 'stamp_once' },
  league_end_date: { kind: 'stamp_once' },
  draft_status: { kind: 'guarded', by: 'trg_leagues_freeze_rules', why: 'the transition table' },
  playoff_teams: { kind: 'guarded', by: 'trg_leagues_freeze_playoff_teams' },
  draft_order_mode: { kind: 'guarded', by: 'trg_leagues_order_mode' },
  pick_clock_enabled: { kind: 'guarded', by: 'trg_leagues_pick_clock' },
  draft_started_at: { kind: 'guarded', by: 'trg_leagues_pick_clock', why: 'trigger-written only' },
  pick_seconds: { kind: 'guarded', by: 'trg_leagues_pick_clock', why: 'pick_seconds_locked once started, every role' },
  id: { kind: 'guarded', by: 'FK', why: "[I2a] WITH CHECK is_commissioner(new id) is false for any new id; child FKs are ON UPDATE NO ACTION" },
  name: { kind: 'editable', why: 'ruling 2026-11-04' },
  draft_date: { kind: 'editable', why: 'ruling 2026-11-04; inert once the draft has started' },
  invite_code: { kind: 'editable', why: 'rotation is harmless: joins are gated on draft_status' },
  created_at: { kind: 'editable', why: 'display only' },
};

// The frozen columns, each with a value that differs from the fixture's.
// commissioner_id LAST: once it changes, the old commissioner's RLS is gone.
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
  season_status: 'completed',
  current_week: 5,
  current_season_id: SEASON,
  budget_mode: 'no-budget',
  commissioner_id: MEMBER,
};
const FIXTURE = {
  name: 'L', draft_date: '2026-11-10T20:00:00Z', stake_mode: 'price_tiers', budget_amount: 250,
  notional_per_slot: 1000, num_rounds: 6, allow_undraftable: false, num_weeks: 11,
  duration_days: 30, league_type: 'matchup', num_participants: 8, playoff_teams: 4,
  season_status: 'active', current_week: 3, current_season_id: '44444444-4444-4444-8444-444444444444',
  budget_mode: 'budget',
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
    await db.exec(SCHEMA_PRE);
    const { ddl, unhandled } = await leaguesColumnDdl();
    for (const st of ddl) await db.exec(st);
    await db.exec(SCHEMA_POST);
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
      const row = { ...FIXTURE, commissioner_id: COMMISH, invite_code: crypto.randomUUID(), ...extra };
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
    await t.step('structure: the four triggers enabled, functions locked down, search_path pinned', async () => {
      const tg = await q(`select tgname, tgrelid::regclass::text rel, tgenabled e from pg_trigger
        where tgname in ('trg_league_draft_slots_freeze','trg_leagues_freeze_rules','trg_league_members_freeze_leave',
                         'trg_drafts_freeze_delete')
        order by tgname`);
      assertEquals(tg.map((r: Row) => [r.tgname, r.rel, r.e]), [
        ['trg_drafts_freeze_delete', 'drafts', 'O'],
        ['trg_league_draft_slots_freeze', 'league_draft_slots', 'O'],
        ['trg_league_members_freeze_leave', 'league_members', 'O'],
        ['trg_leagues_freeze_rules', 'leagues', 'O'],
      ]);
      const fns = await q(`select proname, prosecdef, proconfig, coalesce(proacl::text,'') acl from pg_proc
        where proname in ('enforce_league_draft_slots_frozen','enforce_league_rules_frozen_after_draft_start',
                          'enforce_league_members_frozen_after_draft_start','enforce_drafts_frozen_after_draft_start')
        order by proname`);
      assertEquals(fns.length, 4);
      assertEquals(fns.map((f: Row) => [f.proname, f.prosecdef]), [
        ['enforce_drafts_frozen_after_draft_start', true],
        ['enforce_league_draft_slots_frozen', true],
        ['enforce_league_members_frozen_after_draft_start', true],
        ['enforce_league_rules_frozen_after_draft_start', false],
      ]);
      // Lock modes are invisible to one connection, so pin them statically (see the migration header):
      // the leave trigger MUST take FOR NO KEY UPDATE (FOR SHARE deadlocks two concurrent leavers on the
      // upgrade to the AFTER trigger's lock); the slot trigger takes FOR SHARE only on the CALLER'S leagues.
      const src = async (fn: string) =>
        ((await q(`select prosrc from pg_proc where proname=$1`, [fn]))[0].prosrc as string).replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');
      const leaveSrc = await src('enforce_league_members_frozen_after_draft_start');
      assert(/for no key update/i.test(leaveSrc) && !/for share/i.test(leaveSrc), 'leave trigger lock mode');
      const slotsSrc = await src('enforce_league_draft_slots_frozen');
      assert(/l\.commissioner_id = auth\.uid\(\)::text order by l\.id for share/i.test(slotsSrc), 'slot trigger lock scope/mode');
      const draftsSrc = await src('enforce_drafts_frozen_after_draft_start');
      assert(/l\.commissioner_id = auth\.uid\(\)::text for share/i.test(draftsSrc), 'drafts trigger lock scope/mode');
      for (const f of fns) {
        assert(f.acl !== '', `${f.proname}: proacl NULL means default PUBLIC execute`);
        assert(!/(^|[{,])=X/.test(f.acl), `${f.proname}: PUBLIC grant survives: ${f.acl}`);
        assert(!/anon=|authenticated=/.test(f.acl), `${f.proname}: default role grant survives: ${f.acl}`);
        assertEquals(f.proconfig, ['search_path=public, pg_temp']);
      }
    });

    // ---- classification: every column has a decision -----------------------
    await t.step('classification: every leagues column in the migrations is classified, and nothing stale', async () => {
      assert(ddl.length >= 10, `expected the leagues DDL history, got ${ddl.length} statements`);
      assertEquals(unhandled, [], 'leagues DDL the replay cannot classify (extend leaguesColumnDdl):');
      const cols = (await q(`select column_name c from information_schema.columns
        where table_schema='public' and table_name='leagues' order by ordinal_position`)).map((r: Row) => r.c as string);
      const unclassified = cols.filter((c) => !(c in CLASSIFICATION));
      assertEquals(unclassified, [],
        `NEW leagues column(s) ${unclassified.join(', ')}: classify them in CLASSIFICATION. If one bounds what a manager may ` +
        `buy or how the season scores, freeze it in 20261104000000's successor (frozen/stamp_once) first.`);
      const stale = Object.keys(CLASSIFICATION).filter((c) => !cols.includes(c));
      assertEquals(stale, [], `CLASSIFICATION lists column(s) the migrations no longer have: ${stale.join(', ')}`);
      // Every 'frozen' column is exercised one by one below, so FROZEN must be exactly that set.
      assertEquals(Object.keys(FROZEN).sort(),
        Object.entries(CLASSIFICATION).filter(([, v]) => v.kind === 'frozen').map(([k]) => k).sort());
      // Every 'guarded' trigger named here exists in the migrations.
      const all = await Promise.all([...Deno.readDirSync(new URL('supabase/migrations/', ROOT))]
        .filter((e) => e.isFile && e.name.endsWith('.sql'))
        .map((e) => Deno.readTextFile(new URL(`supabase/migrations/${e.name}`, ROOT))));
      for (const [col, v] of Object.entries(CLASSIFICATION)) {
        if (v.kind !== 'guarded' || v.by === 'FK') continue;
        assert(all.some((sql) => new RegExp(`create trigger ${v.by}\\b`, 'i').test(sql)), `${col}: no trigger ${v.by}`);
      }
    });

    await t.step('classification: the editable columns really are editable post-draft; id is pinned (RLS, then FKs)', async () => {
      const L = await league('completed');
      const editable = Object.entries(CLASSIFICATION).filter(([, v]) => v.kind === 'editable').map(([k]) => k);
      await as('commish', async () => {
        await q(`update leagues set name='n2', draft_date='2027-01-01T00:00:00Z', invite_code='NEW-CODE',
          created_at='2026-01-01T00:00:00Z' where id=$1`, [L]);
        await refused(() => q(`update leagues set id=$2 where id=$1`, [L, crypto.randomUUID()]), 'row-level security');
      });
      assertEquals(editable.sort(), ['created_at', 'draft_date', 'invite_code', 'name']);
      const [r] = await q(`select name, invite_code from leagues where id=$1`, [L]);
      assertEquals([r.name, r.invite_code], ['n2', 'NEW-CODE']);
    });

    // ---- stamp-once dates (F1's carve-out, now for the commissioner too) ----
    await t.step('dates: the completion-stamp shape (draft_status + first-time dates) works for a member and the commissioner', async () => {
      for (const who of ['member', 'commish'] as const) {
        const L = await league('in_progress');
        await as(who, () => q(`update leagues set draft_status='completed', league_start_date=$2, league_end_date=$3 where id=$1`,
          [L, '2026-11-16T14:30:00Z', '2027-02-05T21:00:00Z']));
        const [r] = await q(`select draft_status, league_start_date::text s, league_end_date::text e from leagues where id=$1`, [L]);
        assertEquals(r.draft_status, 'completed', who);
        assert(r.s.startsWith('2026-11-16') && r.e.startsWith('2027-02-05'), `${who}: ${r.s} ${r.e}`);
      }
    });

    await t.step('dates: outside the completing UPDATE a date cannot be stamped, changed or cleared', async () => {
      const L = await league('completed', { league_start_date: '2026-11-16T14:30:00Z' });
      await as('commish', async () => {
        let msg = await refused(() => q(`update leagues set league_start_date=$2 where id=$1`, [L, '2026-11-23T14:30:00Z']),
          'league_rules_locked');
        assert(msg.includes('(league_start_date)'), msg);
        await refused(() => q(`update leagues set league_start_date=null where id=$1`, [L]), 'league_rules_locked');
        // league_end_date is NULL on a completed league (e.g. the direct jump): no stamping with hindsight.
        msg = await refused(() => q(`update leagues set league_end_date=$2 where id=$1`, [L, '2027-02-05T21:00:00Z']),
          'league_rules_locked');
        assert(msg.includes('(league_end_date)'), msg);
      });
      // in_progress without completing: no stamp either.
      const P = await league('in_progress');
      await as('commish', () =>
        refused(() => q(`update leagues set league_start_date=$2 where id=$1`, [P, '2026-11-16T14:30:00Z']), 'league_rules_locked'));
      // The completing UPDATE cannot REWRITE a set date either (only NULL -> value).
      const P2 = await league('in_progress', { league_start_date: '2026-11-16T14:30:00Z' });
      await as('commish', () =>
        refused(() => q(`update leagues set draft_status='completed', league_start_date=$2 where id=$1`, [P2, '2026-11-23T14:30:00Z']),
          'league_rules_locked'));
      const [r] = await q(`select league_start_date::text s, league_end_date e from leagues where id=$1`, [L]);
      assert(r.s.startsWith('2026-11-16') && r.e === null, `${r.s} ${r.e}`);
      // Pre-draft, the dates are free; the service role is exempt post-draft.
      const open = await league('not_started', { league_start_date: '2026-11-16T14:30:00Z' });
      await as('commish', () => q(`update leagues set league_start_date=null where id=$1`, [open]));
      await as('service', () => q(`update leagues set league_start_date=$2 where id=$1`, [L, '2026-11-30T14:30:00Z']));
    });

    // ---- guarded elsewhere: prove each one after the draft --------------------
    await t.step('guarded: draft_order_mode / pick_seconds refused, pick_clock_enabled / draft_started_at reverted, post-draft', async () => {
      for (const st of ['in_progress', 'completed']) {
        const L = await league(st);
        const [before] = await q(`select pick_clock_enabled p, draft_started_at::text d from leagues where id=$1`, [L]);
        await as('commish', async () => {
          await refused(() => q(`update leagues set draft_order_mode='manual' where id=$1`, [L]), 'draft_order_mode_locked', '22023');
          await refused(() => q(`update leagues set pick_seconds=30 where id=$1`, [L]), 'pick_seconds_locked', '22023');
          await q(`update leagues set pick_clock_enabled=false, draft_started_at='2020-01-01T00:00:00Z' where id=$1`, [L]);
        });
        const [after] = await q(`select pick_clock_enabled p, draft_started_at::text d from leagues where id=$1`, [L]);
        assertEquals([after.p, after.d], [before.p, before.d], st);
      }
    });

    // ---- league_members: no leaving once the draft has started (INTERIM) ----
    const members = async (L: string) =>
      (await q(`select user_id from league_members where league_id=$1 order by user_id`, [L])).map((r: Row) => r.user_id);
    const leave = (L: string, who: string) => q(`delete from league_members where league_id=$1 and user_id=$2`, [L, who]);

    for (const st of ['in_progress', 'completed']) {
      await t.step(`${st}: a member and the commissioner cannot leave ([I5]); nothing is deleted`, async () => {
        const L = await league(st);
        await as('member', () => refused(() => leave(L, MEMBER), 'league_membership_locked'));
        await as('commish', () => refused(() => leave(L, COMMISH), 'league_membership_locked'));
        assertEquals(await members(L), [COMMISH, MEMBER].sort());
      });
    }

    await t.step('pre-draft: a member and the commissioner can still leave (unchanged)', async () => {
      const L = await league('not_started');
      await as('member', () => leave(L, MEMBER));
      await as('commish', () => leave(L, COMMISH));
      assertEquals(await members(L), []);
    });

    await t.step('service role: may remove a member post-draft; mid-draft the older all-roles refusal still applies', async () => {
      const done = await league('completed');
      await as('service', () => leave(done, MEMBER));
      assertEquals(await members(done), [COMMISH]);
      // trg_league_members_draft_order (AFTER, every role): locked order + in_progress -> draft_in_progress.
      const live = await league('in_progress');
      await as('service', () => refused(() => leave(live, MEMBER), 'draft_in_progress', '22023'));
      assertEquals(await members(live), [COMMISH, MEMBER].sort());
    });

    await t.step('cascade: deleting a started league still cascades its members, slots and draft order', async () => {
      for (const st of ['in_progress', 'completed']) {
        const L = await league(st);
        assert((await q(`select count(*)::int n from league_draft_order where league_id=$1`, [L]))[0].n > 0, 'order locked at start');
        await as('commish', () => q(`delete from leagues where id=$1`, [L]));
        assertEquals(await members(L), [], st);
        assertEquals((await slots(L)).length, 0, st);
        assertEquals((await q(`select count(*)::int n from league_draft_order where league_id=$1`, [L]))[0].n, 0, st);
      }
    });

    await t.step('members: two leaves in ONE transaction complete (single connection; the lock MODE is pinned in structure)', async () => {
      const L = await league('not_started');
      await db.exec('begin');
      try {
        await as('member', () => leave(L, MEMBER));
        await as('commish', () => leave(L, COMMISH));
        await db.exec('commit');
      } catch (e) {
        await db.exec('rollback');
        throw e;
      }
      assertEquals(await members(L), []);
    });

    // ---- drafts: no deleting picks once the draft has started --------------
    let pickNo = 0;
    const pick = async (L: string, user = MEMBER) =>
      (await q(`insert into drafts (league_id, user_id, symbol, entry_price, quantity, round, pick_number, pick_source)
        values ($1,$2,'AAPL',100,10,1,$3,'manual') returning id`, [L, user, ++pickNo]))[0].id as number;
    const picks = async (L: string) => (await q(`select count(*)::int n from drafts where league_id=$1`, [L]))[0].n as number;

    for (const st of ['in_progress', 'completed']) {
      await t.step(`${st}: the commissioner cannot delete picks ("Commissioners can delete picks"); nothing is deleted`, async () => {
        const L = await league(st);
        const id = await pick(L);
        await pick(L, COMMISH);
        await as('commish', async () => {
          await refused(() => q(`delete from drafts where id=$1`, [id]), 'draft_picks_locked');
          await refused(() => q(`delete from drafts where league_id=$1`, [L]), 'draft_picks_locked');
        });
        assertEquals(await picks(L), 2);
      });
    }

    await t.step('drafts: pre-draft delete allowed; members delete nothing; no UPDATE path; service role exempt', async () => {
      const open = await league('not_started');
      await pick(open);
      await as('commish', () => q(`delete from drafts where league_id=$1`, [open]));
      assertEquals(await picks(open), 0);
      const done = await league('completed');
      const id = await pick(done);
      await as('member', async () => {
        // No DELETE policy for members, and no UPDATE policy for anyone: both match 0 rows.
        assertEquals(await q(`delete from drafts where id=$1 returning id`, [id]), []);
        assertEquals(await q(`update drafts set quantity=999 where id=$1 returning id`, [id]), []);
      });
      await as('commish', async () => {
        assertEquals(await q(`update drafts set quantity=999, league_id=league_id where id=$1 returning id`, [id]), []);
      });
      assertEquals((await q(`select quantity::int qn from drafts where id=$1`, [id]))[0].qn, 10);
      await as('service', () => q(`delete from drafts where id=$1`, [id]));
      assertEquals(await picks(done), 0);
    });

    await t.step('drafts cascade: deleting a started league removes its picks', async () => {
      const L = await league('completed');
      await pick(L);
      await as('commish', () => q(`delete from leagues where id=$1`, [L]));
      assertEquals(await picks(L), 0);
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
        await refused(() => q(`insert into leagues (id, name, commissioner_id, invite_code, num_participants, num_rounds) values ($1,'u',$2,$3,8,9)
          on conflict (id) do update set num_rounds = excluded.num_rounds`, [done, COMMISH, done]), 'league_rules_locked');
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

    await t.step('no probing: a non-commissioner writing into another league gets the RLS error, not league_slots_locked', async () => {
      const done = await league('completed');
      const open = await league('not_started');
      // The member is in `done` but does not commission it; an outsider is in neither.
      await as('member', () =>
        refused(() => q(`insert into league_draft_slots (league_id, slot_index) values ($1,7)`, [done]), 'row-level security'));
      await db.exec(`set role authenticated; set request.jwt.claim.sub = '55555555-5555-4555-8555-555555555555';`);
      try {
        await refused(() => q(`insert into league_draft_slots (league_id, slot_index) values ($1,7)`, [done]), 'row-level security');
      } finally {
        await db.exec(`reset role; reset request.jwt.claim.sub;`);
      }
      // A league the commissioner does NOT run (started): re-parenting their own open slot into it is RLS-refused.
      const [other] = await q(`insert into leagues (name, commissioner_id, invite_code, num_participants, draft_status)
        values ('o', $1, $2, 8, 'completed') returning id`, [MEMBER, crypto.randomUUID()]);
      await as('commish', () =>
        refused(() => q(`update league_draft_slots set league_id=$2, slot_index=9 where league_id=$1 and slot_index=0`,
          [open, other.id]), 'row-level security'));
      assertEquals((await slots(done)).length, 2);
      assertEquals((await slots(open)).length, 2);
    });

    await t.step('a league INSERTed already completed (allowed by [I1]) cannot then receive slots', async () => {
      const id = crypto.randomUUID();
      await as('commish', async () => {
        await q(`insert into leagues (id, name, commissioner_id, invite_code, num_participants, draft_status, num_rounds) values ($1,'c',$2,$3,8,'completed',6)`, [id, COMMISH, id]);
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
      assertEquals(lines.length, 28, msg);
      for (const l of lines) assert(/  PASS$/.test(l), `not PASS: ${l}`);
      // The block's c_classified list is the same set as CLASSIFICATION.
      const m = sql.match(/c_classified text\[\] := array\[([^\]]*)\]/);
      assert(m, 'c_classified array not found in the effect file');
      const listed = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
      assertEquals(listed, Object.keys(CLASSIFICATION).sort(), 'effect-file c_classified drifted from CLASSIFICATION');
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
