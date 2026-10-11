/**
 * league_notifications_kind_check: the UNION invariant, against REAL Postgres
 * (PGlite). NOT hermetic: the first run fetches npm:@electric-sql/pglite.
 *   deno test --allow-read --allow-env supabase/tests/league_notifications_kind_check.pglite.test.ts
 *
 * This constraint has been re-created five times (20261013000000, 20261107000000,
 * 20261110000000, 20261111000000, and PR #94's 20261115000001), each one adding
 * its own kinds to the PRIOR list. A re-creation that lists only its own kinds
 * does not merely fail to add new ones -- since `ADD CONSTRAINT` replaces the
 * whole CHECK, it DROPS every kind added by an earlier migration, and the very
 * next insert of any of those kinds (every auto-start push, every leave,
 * every commissioner transfer) fails 23514. This exact regression shipped in
 * PR #94's first re-stamp (20261115000001 re-stamped from 20261105000001,
 * authored before #126/#132/#133 existed) and was caught only by inspecting
 * the committed migration text, not by any test -- hence this file.
 *
 * Loads VERBATIM, in prod order: the chain draft_auto_start.pglite.test.ts
 * already proves (through 20261111000000, the migration that currently sets
 * the 14-kind list), then PR #94's own notifications migration. The schema
 * replica (SCHEMA_PRE/SCHEMA_POST/leaguesColumnDdl) is the SAME one that test
 * uses, copied rather than re-invented, since it is what makes those real
 * migration files apply cleanly.
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';

const ROOT = new URL('../../', import.meta.url);
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
  '20261013000000_draft_order_modes.sql', // sets the CHECK: draft_order_set only
  '20261101000001_draft_stalls.sql',
  '20261104000000_freeze_league_rules_after_draft_start.sql',
  '20261107000000_leave_league_schema.sql', // re-sets: + member_left
  '20261107000006_draft_waits_for_roster_reconfirm.sql',
  '20261110000000_transfer_commissioner.sql', // re-sets: + commissioner_transferred
  '20261110000001_leave_league_transfer_first.sql',
  '20261110000002_notify_due_ignores_transfer_notice.sql',
  '20261111000000_draft_auto_start.sql', // re-sets: + the six draft_* kinds (14 total)
  // PR #94 (Run it back): re-sets again. THIS is the file under test.
  '20261115000001_run_it_back_notifications.sql',
].map((f) => new URL(`supabase/migrations/${f}`, ROOT));

// The 14 kinds every migration through 20261111000000 has kept as a union.
const PRIOR_KINDS = [
  'draft_order_set', 'member_left', 'commissioner_transferred',
  'draft_room_open', 'draft_started', 'draft_at_risk', 'draft_at_risk_reminder',
  'draft_postponed', 'draft_time_set',
];
// PR #94's own kinds, which the same CHECK must also keep.
const OWN_KINDS = ['renewal_invite', 'renewal_reply', 'renewal_nudge', 'renewal_removed', 'season_set'];

// Copied verbatim from draft_auto_start.pglite.test.ts (the same schema makes
// the same real migration files apply cleanly; not re-derived).
const SCHEMA_PRE = `
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
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
create table user_profiles (id uuid primary key, username text);
create table categories (id uuid primary key default gen_random_uuid(), slug text unique, name text);
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

/** leagues' column DDL, replayed from every migration (same rules as
 * freeze_league_rules.pglite.test.ts / draft_auto_start.pglite.test.ts). */
async function leaguesColumnDdl(): Promise<string[]> {
  const dir = new URL('supabase/migrations/', ROOT);
  const files: string[] = [];
  for await (const e of Deno.readDir(dir)) if (e.isFile && e.name.endsWith('.sql')) files.push(e.name);
  files.sort();
  const ddl: string[] = [];
  const startsWith = /^(create\s+table(\s+if\s+not\s+exists)?|alter\s+table(\s+if\s+exists)?(\s+only)?)\s+(public\.)?leagues\b/i;
  for (const f of files) {
    const sql = (await Deno.readTextFile(new URL(f, dir))).replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
    for (const raw of sql.split(';')) {
      const st = raw.trim();
      if (!startsWith.test(st)) continue;
      if (/^create/i.test(st) || /\b(add|drop|rename)\s+column\b/i.test(st)) {
        ddl.push(st.replace(
          /\breferences\s+[\w.]+\s*(\([^)]*\))?(\s+on\s+(delete|update)\s+(set\s+null|cascade|restrict|no\s+action|set\s+default))*/gi, ''));
      }
    }
  }
  return ddl;
}

const COMMISH = '11111111-1111-4111-8111-111111111111';

// deno-lint-ignore no-explicit-any
type Row = any;

Deno.test({
  name: 'league_notifications_kind_check is a union across the whole chain (PGlite)',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const db = new PGlite();
    const q = async (s: string, p: unknown[] = []) => (await db.query(s, p)).rows as Row[];
    await db.exec(SCHEMA_PRE);
    for (const st of await leaguesColumnDdl()) await db.exec(st);
    await db.exec(SCHEMA_POST);
    for (const m of CHAIN) await db.exec(await Deno.readTextFile(m));

    const [l] = await q(
      `insert into leagues (name, commissioner_id, invite_code, num_participants, num_rounds,
         league_type, stake_mode, budget_amount) values ('L', $1, $2, 8, 6, 'matchup', 'budget_cap', 250)
       returning id`,
      [COMMISH, crypto.randomUUID()],
    );
    const L = l.id as string;

    const ALL_KINDS = [...PRIOR_KINDS, ...OWN_KINDS];

    await t.step('every one of the 14 kinds (prior migrations + PR #94) still inserts', async () => {
      assertEquals(ALL_KINDS.length, 14, 'this list itself must be the full 14 -- update it if a kind is ever added');
      for (const kind of ALL_KINDS) {
        await q(`insert into league_notifications (league_id, user_id, kind) values ($1, $2, $3)`,
          [L, COMMISH, kind]);
      }
      const got = (await q(`select distinct kind from league_notifications where league_id = $1 order by kind`, [L]))
        .map((r: Row) => r.kind as string);
      assertEquals(got, [...ALL_KINDS].sort());
    });

    await t.step('an unknown kind is refused (negative control: the CHECK is not wide open)', async () => {
      let err: Row = null;
      try {
        await q(`insert into league_notifications (league_id, user_id, kind) values ($1, $2, 'not_a_real_kind')`,
          [L, COMMISH]);
      } catch (e) {
        err = e;
      }
      assert(err, 'an unknown kind must be refused');
      assertEquals(err.code, '23514');
    });

    await db.close();
  },
});
