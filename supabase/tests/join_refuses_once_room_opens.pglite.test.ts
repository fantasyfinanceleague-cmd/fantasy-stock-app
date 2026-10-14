/**
 * No joins once the draft room opens (20261123000000) against REAL Postgres
 * (PGlite). NOT hermetic: the first run fetches npm:@electric-sql/pglite. Run:
 *   deno test --allow-read --allow-env supabase/tests/join_refuses_once_room_opens.pglite.test.ts
 *
 * Giorgio, 2026-10-14: "once the draft room opens (an hour before) the league
 * is considered started. no one can join and the share link cannot work"
 *
 * Loads VERBATIM, in prod order, the chain draft_auto_start.pglite.test.ts
 * loads (every trigger a leagues / league_members write meets), plus the
 * join_league_by_code this file replaces (20261107000005), the auto-start
 * migrations (postponement, the gated order sync), then the file under test.
 * leagues is replayed from every leagues DDL in supabase/migrations/.
 *
 * Time: draft_date is set relative to the DB clock. The T-1h boundary runs in
 * ONE transaction, so now() is the same instant for the setup and the join.
 *
 * Every RPC answer is also checked against preview-league's reason.ts on the
 * same facts, so the preview never offers a Join the RPC refuses.
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';
import { ROOM_OPEN_LEAD_SECONDS } from '../functions/_shared/draft-start-policy.ts';
import { previewJoinReason } from '../functions/preview-league/reason.ts';

const ROOT = new URL('../../', import.meta.url);
const UNDER_TEST = new URL('supabase/migrations/20261123000000_join_refuses_once_room_opens.sql', ROOT);
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
  '20261107000000_leave_league_schema.sql',
  '20261107000005_join_clears_invite_reconfirm.sql',   // the body this file replaces
  '20261107000006_draft_waits_for_roster_reconfirm.sql',
  '20261110000000_transfer_commissioner.sql',
  '20261110000001_leave_league_transfer_first.sql',
  '20261110000002_notify_due_ignores_transfer_notice.sql',
  '20261111000000_draft_auto_start.sql',
  '20261111000001_draft_status_server_only.sql',
].map((f) => new URL(`supabase/migrations/${f}`, ROOT));

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
create table league_invites (id uuid primary key default gen_random_uuid(),
  league_id uuid references leagues(id) on delete cascade, code text, status text default 'pending',
  expires_at timestamptz, inviter_id text);
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

/** leagues' column DDL, replayed from the migrations (same rules as
 * draft_auto_start.pglite.test.ts / freeze_league_rules.pglite.test.ts). */
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
const JOINER = '33333333-3333-4333-8333-333333333333';

// deno-lint-ignore no-explicit-any
type Row = any;

Deno.test({
  name: 'join_league_by_code refuses once the draft room opens (PGlite)',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const db = new PGlite();
    const q = async (s: string, p: unknown[] = []) => (await db.query(s, p)).rows as Row[];
    await db.exec(SCHEMA_PRE);
    for (const st of await leaguesColumnDdl()) await db.exec(st);
    await db.exec(SCHEMA_POST);
    for (const m of CHAIN) await db.exec(await Deno.readTextFile(m));

    // Drift that the file's own grants must undo: CREATE OR REPLACE keeps an ACL,
    // so a stray client grant would survive a file that forgot to re-assert them.
    await db.exec(`grant execute on function join_league_by_code(text, text) to public, anon, authenticated`);
    await db.exec(await Deno.readTextFile(UNDER_TEST));

    // ---- helpers ----------------------------------------------------------
    /** A league as the owner: `members` humans, draft_date `minutes` from now (null = none). */
    async function league(o: { minutes: number | null; members?: number; extra?: Record<string, unknown> }) {
      const row: Record<string, unknown> = {
        name: 'Serie A Traders', commissioner_id: COMMISH, invite_code: crypto.randomUUID().slice(0, 8).toUpperCase(),
        num_participants: 8, num_rounds: 6, num_weeks: 11, league_type: 'matchup', playoff_teams: 4,
        stake_mode: 'budget_cap', budget_amount: '250.00', ...o.extra,
      };
      const keys = Object.keys(row);
      const [l] = await q(
        `insert into leagues (${keys.join(',')}, draft_date) values (${keys.map((_, i) => '$' + (i + 1)).join(',')},
           case when $${keys.length + 1}::float8 is null then null else now() + make_interval(secs => $${keys.length + 1}::float8 * 60) end)
         returning id, invite_code`,
        [...Object.values(row), o.minutes],
      );
      const ids = [COMMISH, ...Array.from({ length: (o.members ?? 2) - 1 }, () => crypto.randomUUID())];
      for (const u of ids) await q(`insert into league_members (league_id, user_id) values ($1,$2)`, [l.id, u]);
      return { id: l.id as string, code: l.invite_code as string };
    }
    async function join(code: string, uid = JOINER): Promise<Row> {
      await db.exec(`set role service_role`);
      try {
        return (await q(`select join_league_by_code($1, $2) r`, [code, uid]))[0].r;
      } finally {
        await db.exec(`reset role`);
      }
    }
    /** preview-league's answer on the same row, at the DB's clock. */
    async function preview(L: string, uid = JOINER, invite: { status: string; expiresAt: string | null } | null = null) {
      const [r] = await q(`select l.season_status, l.draft_status, l.draft_date, l.num_participants, now() as now,
          (select count(*)::int from league_members m where m.league_id = l.id) n,
          exists (select 1 from league_members m where m.league_id = l.id and m.user_id = $2) mem
        from leagues l where l.id = $1`, [L, uid]);
      return previewJoinReason({
        isExistingMember: r.mem, seasonStatus: r.season_status, draftStatus: r.draft_status,
        draftDate: r.draft_date ? new Date(r.draft_date).toISOString() : null,
        invite, currentMembers: r.n, numParticipants: r.num_participants,
      }, new Date(r.now)).reason;
    }
    const members = async (L: string) => (await q(`select count(*)::int n from league_members where league_id=$1`, [L]))[0].n;

    await t.step('before the room opens: the code works (and the preview agrees)', async () => {
      const L = await league({ minutes: 61 });
      assertEquals(await preview(L.id), null);
      const r = await join(L.code);
      assertEquals(r.ok, true, JSON.stringify(r));
      assertEquals(await members(L.id), 3);
    });

    await t.step('no draft time at all: joinable', async () => {
      const L = await league({ minutes: null });
      assertEquals(await preview(L.id), null);
      assertEquals((await join(L.code)).ok, true);
    });

    await t.step('room open (T-1h .. T), draft not started: refused as draft_started, nothing written', async () => {
      for (const minutes of [59, 30, 1]) {
        const L = await league({ minutes });
        assertEquals(await preview(L.id), 'draft_started');
        const r = await join(L.code);
        assertEquals([r.ok, r.reason], [false, 'draft_started'], `T-${minutes}m: ${JSON.stringify(r)}`);
        assertEquals(r.league?.id, L.id, 'draft_started carries the league, as before');
        assertEquals(await members(L.id), 2, `T-${minutes}m: no member row`);
      }
    });

    await t.step('past T, still not_started (start retrying): refused', async () => {
      const L = await league({ minutes: -2 });
      assertEquals(await preview(L.id), 'draft_started');
      assertEquals((await join(L.code)).reason, 'draft_started');
    });

    await t.step('the T-1h boundary, in one transaction (same now()): exactly T-1h refuses; a microsecond earlier joins', async () => {
      const at = async (offset: string) => {
        const L = await league({ minutes: 600 });
        const r = await db.transaction(async (tx) => {
          await tx.query(`update leagues set draft_date = now() + ${offset} where id = $1`, [L.id]);
          await tx.query(`set local role service_role`);
          return (await tx.query<{ r: Row }>(`select join_league_by_code($1, $2) r`, [L.code, JOINER])).rows[0].r;
        });
        return r;
      };
      const exact = await at(`make_interval(secs => ${ROOM_OPEN_LEAD_SECONDS})`);
      assertEquals([exact.ok, exact.reason], [false, 'draft_started'], 'now() = draft_date - 1h: the room is open');
      const before = await at(`make_interval(secs => ${ROOM_OPEN_LEAD_SECONDS}) + interval '1 microsecond'`);
      assertEquals(before.ok, true, `one microsecond before the room: ${JSON.stringify(before)}`);
    });

    await t.step('the same clock as the room: _draft_order_is_due and draft_start_policy().room_lead_s', async () => {
      const [r] = await q(`select
          public._draft_order_is_due(now() + make_interval(secs => (public.draft_start_policy()->>'room_lead_s')::int)) at_room,
          public._draft_order_is_due(now() + make_interval(secs => (public.draft_start_policy()->>'room_lead_s')::int + 1)) before_room,
          (public.draft_start_policy()->>'room_lead_s')::int lead`);
      assertEquals([r.at_room, r.before_room, r.lead], [true, false, ROOM_OPEN_LEAD_SECONDS]);
    });

    await t.step('postponed (draft_date cleared), even with its order already finalized: joinable again', async () => {
      // 4 members, room opened and the order set (as the gate + #67 do), then
      // postponed at the start pass: state stays 'finalized', draft_date is NULL.
      const L = await league({ minutes: 30, members: 4 });
      assertEquals((await join(L.code)).reason, 'draft_started', 'open room first');
      await q(`insert into draft_start_watch (league_id, draft_date, inputs_sig, blocked, gate_cleared_at, room_opened_at)
        select id, draft_date, 'x', false, now(), now() from leagues where id=$1`, [L.id]);
      await q(`select public._draft_order_sync($1, true)`, [L.id]);
      assertEquals((await q(`select state from league_draft_order_meta where league_id=$1`, [L.id]))[0].state, 'finalized');
      await db.exec(`set role service_role`);
      const [pp] = await q(`select public.postpone_league_draft(l.id, l.draft_date, 'start', 'not_enough_members', '[]'::jsonb, null) r
        from leagues l where l.id = $1`, [L.id]);
      await db.exec(`reset role`);
      assertEquals(pp.r.status, 'postponed');
      assertEquals((await q(`select draft_date from leagues where id=$1`, [L.id]))[0].draft_date, null);
      assertEquals(await preview(L.id), null, 'the preview offers Join again');
      const r = await join(L.code);
      assertEquals(r.ok, true, JSON.stringify(r));
      assertEquals(await members(L.id), 5);
    });

    await t.step('invite codes (league_invites) follow the same clock', async () => {
      const L = await league({ minutes: 20 });
      const code = 'INV' + crypto.randomUUID().slice(0, 6).toUpperCase();
      await q(`insert into league_invites (league_id, code, status) values ($1, $2, 'pending')`, [L.id, code]);
      assertEquals(await preview(L.id, JOINER, { status: 'pending', expiresAt: null }), 'draft_started');
      assertEquals((await join(code)).reason, 'draft_started');
      assertEquals((await q(`select status from league_invites where code=$1`, [code]))[0].status, 'pending', 'not accepted');
      // An expired invite still says invite_expired (its place in the precedence).
      const dead = 'DED' + crypto.randomUUID().slice(0, 6).toUpperCase();
      await q(`insert into league_invites (league_id, code, status) values ($1, $2, 'accepted')`, [L.id, dead]);
      assertEquals((await join(dead)).reason, 'invite_expired');
      assertEquals(await preview(L.id, JOINER, { status: 'accepted', expiresAt: null }), 'invite_expired');
    });

    await t.step('unchanged: already_member, season_completed, a started draft, a full league before the room', async () => {
      const open = await league({ minutes: 10 });
      const mem = await join(open.code, COMMISH);
      assertEquals([mem.reason, mem.league?.id], ['already_member', open.id], 'a member still gets Open');
      assertEquals(await preview(open.id, COMMISH), 'already_member');

      const done = await league({ minutes: -60 * 24 * 90, extra: { season_status: 'completed', draft_status: 'completed' } });
      assertEquals((await join(done.code)).reason, 'season_completed');
      assertEquals(await preview(done.id), 'season_completed');
      const doneNoDate = await league({ minutes: null, extra: { season_status: 'completed', draft_status: 'completed' } });
      assertEquals((await join(doneNoDate.code)).reason, 'season_completed');

      const drafting = await league({ minutes: -5, extra: { draft_status: 'in_progress' } });
      assertEquals((await join(drafting.code)).reason, 'draft_started');

      const full = await league({ minutes: 120, members: 4, extra: { num_participants: 4 } });
      assertEquals((await join(full.code)).reason, 'league_full');
      assertEquals(await preview(full.id), 'league_full');
      const fullOpen = await league({ minutes: 30, members: 4, extra: { num_participants: 4 } });
      assertEquals((await join(fullOpen.code)).reason, 'draft_started', 'room beats full, as a started draft does');
      assertEquals(await preview(fullOpen.id), 'draft_started');

      assertEquals((await join('NOSUCHCODE')).reason, 'invalid_code');
    });

    await t.step('fewer than 4 at the room: the gate postpones (stage room_open), and the code works again at once', async () => {
      // _shared/draft-start.ts watchLeague postpones a short league in the gate
      // window [T-1h-30s, T) (draft-start.test.ts pins the TS side); here, the
      // SQL it calls, with the inputs it judged, on a league already in its room.
      const L = await league({ minutes: 30, members: 3 });
      assertEquals((await join(L.code)).reason, 'draft_started', 'short, but the room is open: refused');
      const [{ j }] = await q(`select public._draft_start_inputs($1) j`, [L.id]);
      await db.exec(`set role service_role`);
      const [pp] = await q(`select public.postpone_league_draft(l.id, l.draft_date, 'room_open', 'not_enough_members',
          '[{"code":"not_enough_members","have":3,"need":4}]'::jsonb, $2::jsonb) r from leagues l where l.id = $1`, [L.id, JSON.stringify(j)]);
      await db.exec(`reset role`);
      assertEquals(pp.r.status, 'postponed');
      const [row] = await q(`select l.draft_date, p.stage from leagues l join draft_postponements p on p.league_id = l.id where l.id=$1`, [L.id]);
      assertEquals([row.draft_date, row.stage], [null, 'room_open']);
      assertEquals(await preview(L.id), null, 'Share and the preview come back with the postponement');
      assertEquals((await join(L.code)).ok, true, 'the fourth manager can join');
      assertEquals(await members(L.id), 4);
    });

    await t.step('grants: service_role only, re-asserted over drift (proacl + has_function_privilege)', async () => {
      const [f] = await q(`select proacl::text acl, prosecdef, proconfig from pg_proc where proname = 'join_league_by_code'`);
      assertEquals(f.acl, '{postgres=X/postgres,service_role=X/postgres}');
      assertEquals(f.prosecdef, true);
      assertEquals(f.proconfig, ['search_path=public, pg_temp']);
      const [p] = await q(`select
          has_function_privilege('anon', 'join_league_by_code(text, text)', 'execute') anon,
          has_function_privilege('authenticated', 'join_league_by_code(text, text)', 'execute') authed,
          has_function_privilege('service_role', 'join_league_by_code(text, text)', 'execute') svc`);
      assertEquals([p.anon, p.authed, p.svc], [false, false, true]);
      // Only one overload (CREATE OR REPLACE, not a second signature).
      assertEquals((await q(`select count(*)::int n from pg_proc where proname = 'join_league_by_code'`))[0].n, 1);
      const [src] = await q(`select prosrc from pg_proc where proname = 'join_league_by_code'`);
      assert(String(src.prosrc).includes('league_roster_reconfirm'), '20261107000005\'s reconfirm clear is kept');
    });
  },
});
