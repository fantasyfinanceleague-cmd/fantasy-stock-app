/**
 * Run it back phase 1 (20261105000000-05) against REAL Postgres (PGlite =
 * Postgres 16 in WASM). NOT hermetic: the first run fetches
 * npm:@electric-sql/pglite. Run instructions: supabase/tests/README.md.
 *
 * Loaded VERBATIM (never retyped):
 *   - the six migrations under test, whole, in order;
 *   - what they call: is_member (sliced from 20260712000000),
 *     participant_display_name (sliced from 20261004000000), and the
 *     league_notifications table DDL (sliced from 20261013000000).
 * Supabase's default grants (EXECUTE on functions; ALL on tables to
 * anon/authenticated/service_role) are simulated, so the grant assertions prove
 * the explicit revokes work.
 *
 * NOT loaded (their own suites cover them): the draft-order triggers and meta
 * tables, and the PR #9 member column guard. So "the draft order locks" is not
 * asserted here; the gate's own refusal path and the team cap are.
 */
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';

const ROOT = new URL('../../', import.meta.url);
const mig = (name: string) => Deno.readTextFile(new URL(`supabase/migrations/${name}`, ROOT));

/** The exact text from `start` up to and including the first `end` after it. */
function slice(src: string, start: string, end: string): string {
  const i = src.indexOf(start);
  if (i < 0) throw new Error(`slice start not found: ${start}`);
  const j = src.indexOf(end, i);
  if (j < 0) throw new Error(`slice end not found: ${end}`);
  return src.slice(i, j + end.length);
}

const SCHEMA = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
-- Supabase: every new function gets explicit anon/authenticated/service_role EXECUTE.
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create table leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'league',
  commissioner_id text not null,
  invite_code text unique not null default substr(md5(random()::text), 1, 10),
  num_participants int not null default 8 check (num_participants between 4 and 16),
  num_rounds int not null default 6,
  stake_mode text,
  notional_per_slot numeric not null default 1000,
  budget_amount numeric not null default 100,
  budget_mode text not null default 'budget',
  allow_undraftable boolean not null default false,
  league_type text not null default 'duration',
  duration_days int not null default 30,
  num_weeks int,
  playoff_teams int default 4,
  draft_order_mode text not null default 'random'
    check (draft_order_mode in ('random', 'manual', 'legacy')),
  pick_seconds smallint not null default 60 check (pick_seconds in (30, 45, 60, 75, 90)),
  pick_clock_enabled boolean not null default true,
  draft_status text not null default 'not_started',
  draft_date timestamptz,
  draft_started_at timestamptz,
  league_start_date timestamptz,
  league_end_date timestamptz,
  current_week int default 1,
  season_status text default 'active'
    check (season_status in ('active', 'playoffs', 'completed')),
  current_season_id uuid,
  created_at timestamptz not null default now()
);
create table league_members (league_id uuid not null references leagues(id) on delete cascade,
  user_id text not null, role text not null default 'member'
    check (role in ('commissioner', 'member')),
  joined_at timestamptz not null default now(), primary key (league_id, user_id));
create table league_draft_slots (id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade, slot_index int not null,
  slot_count int not null default 1, price_min numeric, price_max numeric, category_id uuid,
  created_at timestamptz not null default now(), unique (league_id, slot_index));
create table league_invites (id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade, code text not null unique,
  status text not null default 'pending', expires_at timestamptz);
create table league_seasons (id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade, season_number int not null default 1,
  started_at timestamptz not null default now(), completed_at timestamptz,
  champion_user_id text, runner_up_user_id text, final_standings jsonb,
  created_at timestamptz not null default now(), unique (league_id, season_number));
alter table leagues add constraint leagues_current_season_fk
  foreign key (current_season_id) references league_seasons(id);
create table matchups (id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade, week_number int not null,
  team1_user_id text, team2_user_id text, team1_gain numeric(12,2), team2_gain numeric(12,2),
  winner_user_id text, week_start timestamptz, week_end timestamptz,
  is_playoff boolean default false, playoff_round_number smallint, bracket_position smallint);
create table user_profiles (id uuid primary key, username text);

-- Supabase grants ALL on new tables to the API roles; RLS is the only barrier
-- here, and these replicas carry no RLS (the functions are DEFINER).
grant select, insert, update on leagues to authenticated;
grant delete on league_members to authenticated;   -- prod: league_members_delete_self (the interim self-leave)   -- prod: leagues_insert_self_commissioner, leagues_update_commissioner
grant select on league_members, league_seasons, matchups, league_draft_slots, league_invites to authenticated;
grant all on leagues, league_members, league_draft_slots, league_seasons, matchups, league_invites to service_role;
grant select on user_profiles to authenticated, service_role;
`;

// deno-lint-ignore no-explicit-any
type Row = any;

// Users: uuid-shaped, because auth.uid() is a uuid cast.
const C = '00000000-0000-4000-8000-0000000000c1'; // Season 1 commissioner
const A = '00000000-0000-4000-8000-0000000000a1'; // Season 1 champion
const B = '00000000-0000-4000-8000-0000000000b1'; // Season 1 member: answers late
const D = '00000000-0000-4000-8000-0000000000d1'; // Season 1 member: removed
const E = '00000000-0000-4000-8000-0000000000e1'; // a stranger
const F = '00000000-0000-4000-8000-0000000000f1'; // a newcomer, joins by code
const BOT = 'bot-1';

Deno.test({
  name: 'Run it back phase 1 on real Postgres (PGlite)',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const db = new PGlite();
    const q = async (s: string, p: unknown[] = []) => (await db.query(s, p)).rows as Row[];
    /** Run fn as an API role with a JWT sub; the role is always reset. */
    const as = async <T>(role: string, sub: string | null, fn: () => Promise<T>): Promise<T> => {
      await db.exec(`set role ${role}`);
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [sub ?? '']);
      try {
        return await fn();
      } finally {
        await db.exec('reset role');
        await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
      }
    };
    /** One RPC as a role; returns the first row's first column. */
    const rpc = async (role: string, sub: string | null, sql: string, p: unknown[] = []) =>
      await as(role, sub, async () => (await q(sql, p))[0]);
    const refusal = async (role: string, sub: string | null, sql: string, p: unknown[] = []) =>
      (await rpc(role, sub, sql, p)).r;

    // ---- prior state, verbatim ----------------------------------------------------
    await db.exec(SCHEMA);
    const helpers = await mig('20260712000000_rls_b1_00_helpers.sql');
    await db.exec(slice(helpers, 'create or replace function public.is_member(', '$$;'));
    const names = await mig('20261004000000_participant_display_names.sql');
    await db.exec(slice(names, 'create or replace function public.participant_display_name(', '\n$$;'));
    const draftOrder = await mig('20261013000000_draft_order_modes.sql');
    await db.exec(slice(draftOrder, 'create table if not exists public.league_notifications (', ');'));
    await db.exec(`alter table public.league_notifications enable row level security;
      grant select on table public.league_notifications to authenticated, service_role;`);

    // ---- the migrations under test, in order ---------------------------------------
    // Found by suffix, not by name: the timestamps are provisional until release
    // (re-stamped), and a pure rename must not break this suite. Sorted, so the
    // order is the apply order.
    const runItBack: string[] = [];
    for await (const e of Deno.readDir(new URL('supabase/migrations/', ROOT))) {
      if (e.isFile && /_run_it_back_[a-z_]+\.sql$/.test(e.name)) runItBack.push(e.name);
    }
    runItBack.sort();
    assertEquals(runItBack.length, 6, `expected six run_it_back migrations, found ${runItBack}`);
    for (const f of runItBack) {
      await db.exec(await mig(f));
    }

    // ---- fixture: a completed Season 1 with standings, slots and history -----------
    /** A completed matchup league with members C (commissioner), A, B, D and a bot. */
    async function completedLeague(name: string, mode: string, cap: number) {
      const [l] = await q(`insert into leagues (name, commissioner_id, league_type, season_status, num_participants,
          playoff_teams, num_weeks, draft_status, draft_order_mode, current_week)
        values ($1, $2, 'matchup', 'completed', $3, 2, 2, 'completed', $4, 2) returning id`, [name, C, cap, mode]);
      const lg = l.id as string;
      const [s] = await q(`insert into league_seasons (league_id, season_number, completed_at, champion_user_id,
          runner_up_user_id, final_standings)
        values ($1, 1, now(), $2, $3, $4::jsonb) returning id`, [lg, A, C, JSON.stringify([
          { user_id: A, rank: 1, wins: 2, losses: 0, ties: 0, points_for: 300 },
          { user_id: C, rank: 2, wins: 1, losses: 1, ties: 0, points_for: 200 },
          { user_id: B, rank: 3, wins: 0, losses: 2, ties: 0, points_for: 100 },
          { user_id: D, rank: 4, wins: 0, losses: 2, ties: 0, points_for: 50 },
        ])]);
      await q(`update leagues set current_season_id = $1 where id = $2`, [s.id, lg]);
      for (const m of [C, A, B, D, BOT]) {
        await q(`insert into league_members (league_id, user_id, role) values ($1, $2, $3)`,
          [lg, m, m === C ? 'commissioner' : 'member']);
      }
      await q(`insert into league_draft_slots (league_id, slot_index, slot_count, price_min, price_max)
        values ($1, 1, 2, 10, 50), ($1, 2, 1, null, null)`, [lg]);
      await q(`insert into matchups (league_id, week_number, team1_user_id, team2_user_id, team1_gain, team2_gain,
          winner_user_id, week_start, week_end)
        values ($1, 1, $2, $3, 120, 80, $2, now() - interval '14 days', now() - interval '7 days'),
               ($1, 2, $2, $4, 90, 110, $4, now() - interval '7 days', now())`, [lg, A, C, B]);
      return lg;
    }
    await q(`insert into user_profiles (id, username) values ($1, 'ana'), ($2, 'carlo'), ($3, 'bea'), ($4, 'dani')`,
      [A, C, B, D]);

    const L1 = await completedLeague('Stock Scudetto', 'random', 4);
    const snapshot = async (lg: string) => JSON.stringify(await q(`select
        (select to_jsonb(l) from leagues l where l.id = $1) as league,
        (select coalesce(jsonb_agg(to_jsonb(m) order by m.user_id), '[]') from league_members m where m.league_id = $1) as members,
        (select coalesce(jsonb_agg(to_jsonb(s) order by s.id), '[]') from league_seasons s where s.league_id = $1) as seasons,
        (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from matchups x where x.league_id = $1) as matchups,
        (select coalesce(jsonb_agg(to_jsonb(x) order by x.slot_index), '[]') from league_draft_slots x where x.league_id = $1) as slots`,
      [lg]));
    const oldBefore = await snapshot(L1);

    // =============================================================================
    await t.step('grants: client RPCs are authenticated-only; helpers, triggers and the table are closed', async () => {
      const rows = await q(`select p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') anon_x,
          has_function_privilege('authenticated', p.oid, 'EXECUTE') auth_x,
          has_function_privilege('service_role', p.oid, 'EXECUTE') svc_x,
          has_function_privilege('public', p.oid, 'EXECUTE') pub_x, p.prosecdef, p.proconfig
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in (
          'renew_league','respond_to_renewal','nudge_renewal','remove_renewal_invitee','start_renewed_season',
          'cancel_league_renewal','get_renewal_roster','get_league_history','get_season_matchups',
          'set_draft_order','_renewal_invite_code','_renewal_counts','enforce_league_renewal_gate',
          'enforce_renewal_response_transitions')`);
      assertEquals(rows.length, 14);
      for (const r of rows) {
        assertEquals(r.anon_x, false, `${r.proname}: anon`);
        assertEquals(r.pub_x, false, `${r.proname}: public`);
        assertEquals(r.svc_x, false, `${r.proname}: service_role`);
        assertEquals(r.prosecdef, true, `${r.proname}: definer`);
        assert(JSON.stringify(r.proconfig).includes('search_path=public, pg_temp'), `${r.proname}: pinned`);
        const clientRpc = !r.proname.startsWith('_') && !r.proname.startsWith('enforce_');
        assertEquals(r.auth_x, clientRpc, `${r.proname}: authenticated`);
      }
      const [t1] = await q(`select has_table_privilege('anon','league_renewal_responses','SELECT') a,
          has_table_privilege('authenticated','league_renewal_responses','SELECT') u,
          has_table_privilege('service_role','league_renewal_responses','UPDATE') su,
          has_table_privilege('service_role','league_renewal_responses','SELECT') s`);
      assertEquals([t1.a, t1.u, t1.su, t1.s], [false, false, false, true]);
    });

    await t.step('identity: anon is refused by the grant; a player is refused as non-commissioner', async () => {
      await assertRejects(() => rpc('anon', null, `select public.renew_league($1) r`, [L1]),
        Error, 'permission denied');
      await assertRejects(() => rpc('authenticated', A, `select public.renew_league($1) r`, [L1]),
        Error, 'not_commissioner');
      assertEquals(await snapshot(L1), oldBefore);
    });

    // =============================================================================
    let L2 = '';
    let code = '';
    await t.step('renew_league: a new season; the old one untouched; each member invited once; cap 16', async () => {
      const r = await refusal('authenticated', C, `select public.renew_league($1) r`, [L1]);
      assertEquals(r.status, 'renewed');
      assertEquals(r.invited, 3);                                  // A, B, D; the bot is not invited
      L2 = r.league_id; code = r.invite_code;
      assert(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/.test(code), code);
      assert(code !== (await q(`select invite_code from leagues where id = $1`, [L1]))[0].invite_code,
        'the new season has a fresh code; the old one is not moved');

      const [n] = await q(`select num_participants, season_number, previous_league_id, lineage_id, draft_status,
          draft_date, season_status, current_season_id, draft_order_mode, invite_code from leagues where id = $1`, [L2]);
      assertEquals([n.num_participants, n.season_number, n.previous_league_id, n.lineage_id],
        [16, 2, L1, L1]);
      assertEquals([n.draft_status, n.draft_date, n.season_status, n.current_season_id], ['not_started', null, 'active', null]);
      assertEquals(n.invite_code, code);

      const resp = await q(`select user_id, status, decided_by from league_renewal_responses where league_id = $1 order by user_id`, [L2]);
      assertEquals(resp.length, 4);
      assertEquals(resp.find((x: Row) => x.user_id === C), { user_id: C, status: 'in', decided_by: 'player' });
      assertEquals(resp.filter((x: Row) => x.status === 'pending').length, 3);
      assertEquals(await q(`select user_id from league_members where league_id = $1`, [L2]), [{ user_id: C }]);
      assertEquals((await q(`select count(*)::int c from league_draft_slots where league_id = $1`, [L2]))[0].c, 2);

      const invites = await q(`select user_id, subject_user_id, detail from league_notifications
        where league_id = $1 and kind = 'renewal_invite' order by user_id`, [L2]);
      assertEquals(invites.map((x: Row) => x.user_id).sort(), [A, B, D].sort());
      assertEquals(invites[0].detail.commissioner_name, 'carlo');
      assertEquals(invites[0].detail.season_number, 2);
      assertEquals(await snapshot(L1), oldBefore, 'the old season is never written');
    });

    await t.step('renew_league: a second tap returns the same season and writes nothing new', async () => {
      const again = await refusal('authenticated', C, `select public.renew_league($1) r`, [L1]);
      assertEquals(again, { status: 'already_renewed', league_id: L2 });
      assertEquals((await q(`select count(*)::int c from league_renewal_responses where league_id = $1`, [L2]))[0].c, 4);
    });

    await t.step('the gate: nothing about the draft can change while a reply is pending, service_role included', async () => {
      await assertRejects(() => rpc('authenticated', C,
        `update leagues set draft_date = now() + interval '5 days' where id = $1 returning id`, [L2]),
        Error, 'renewal_replies_pending');
      await assertRejects(() => rpc('service_role', null,
        `update leagues set draft_status = 'in_progress' where id = $1 returning id`, [L2]),
        Error, 'renewal_replies_pending');
      await assertRejects(() => rpc('service_role', null,
        `update leagues set draft_order_mode = 'manual' where id = $1 returning id`, [L2]),
        Error, 'renewal_replies_pending');
      const [still] = await q(`select draft_status, draft_date, draft_order_mode from leagues where id = $1`, [L2]);
      assertEquals(still, { draft_status: 'not_started', draft_date: null, draft_order_mode: 'random' });
    });

    await t.step('the commissioner cannot opt out; strangers are not invited; a bad answer raises', async () => {
      assertEquals(await refusal('authenticated', C, `select public.respond_to_renewal($1, 'out') r`, [L2]),
        { status: 'refused', reason: 'commissioner_cannot_opt_out' });
      assertEquals(await refusal('authenticated', E, `select public.respond_to_renewal($1, 'in') r`, [L2]),
        { status: 'refused', reason: 'not_invited' });
      await assertRejects(() => rpc('authenticated', A, `select public.respond_to_renewal($1, 'maybe') r`, [L2]),
        Error, 'invalid_response');
    });

    await t.step('a pending player sees only their own status; a stranger sees nothing', async () => {
      const b = await refusal('authenticated', B, `select public.get_renewal_roster($1) r`, [L2]);
      assertEquals(b.full_list, false);
      assertEquals(b.caller_status, 'pending');
      assertEquals(b.people, undefined);
      assertEquals(b.counts, undefined);
      assertEquals(b.commissioner_name, 'carlo');   // the ask can name who is running it back
      assertEquals(await refusal('authenticated', E, `select public.get_renewal_roster($1) r`, [L2]),
        { status: 'not_visible' });
    });

    await t.step('nudge: only a pending player, at most once in 24 h, and the status never changes', async () => {
      const n1 = await refusal('authenticated', C, `select public.nudge_renewal($1, $2) r`, [L2, D]);
      assertEquals(n1.status, 'nudged');
      assertEquals(n1.nudge_count, 1);
      assertEquals(await refusal('authenticated', C, `select public.nudge_renewal($1, $2) r`, [L2, D]),
        { status: 'refused', reason: 'nudge_too_soon' });
      const [row] = await q(`select status, nudge_count from league_renewal_responses where league_id = $1 and user_id = $2`, [L2, D]);
      assertEquals(row, { status: 'pending', nudge_count: 1 });
      assertEquals((await q(`select count(*)::int c from league_notifications where league_id = $1 and kind = 'renewal_nudge'`, [L2]))[0].c, 1);
      await assertRejects(() => rpc('authenticated', A, `select public.nudge_renewal($1, $2) r`, [L2, B]),
        Error, 'not_commissioner');
    });

    await t.step('remove is final: pending -> out (commissioner); the player cannot come back', async () => {
      const r = await refusal('authenticated', C, `select public.remove_renewal_invitee($1, $2) r`, [L2, D]);
      assertEquals(r, { status: 'removed' });
      assertEquals(await q(`select status, decided_by from league_renewal_responses where league_id = $1 and user_id = $2`, [L2, D]),
        [{ status: 'out', decided_by: 'commissioner' }]);
      assertEquals((await q(`select count(*)::int c from league_notifications where league_id = $1 and kind = 'renewal_removed' and user_id = $2`, [L2, D]))[0].c, 1);
      assertEquals(await refusal('authenticated', D, `select public.respond_to_renewal($1, 'in') r`, [L2]),
        { status: 'refused', reason: 'removed' });
      // Removing again is refused: the row is no longer pending.
      assertEquals(await refusal('authenticated', C, `select public.remove_renewal_invitee($1, $2) r`, [L2, D]),
        { status: 'refused', reason: 'not_pending' });
      // A removed player's roster view is their own status only, with the decision.
      const d = await refusal('authenticated', D, `select public.get_renewal_roster($1) r`, [L2]);
      assertEquals([d.full_list, d.caller_status, d.caller_decided_by], [false, 'out', 'commissioner']);
    });

    await t.step('the table guard holds for every role: nothing returns to pending; removed is final', async () => {
      // Writes as the owner: the triggers fire regardless of the role.
      await assertRejects(() => q(`update league_renewal_responses set status = 'pending', decided_by = null,
          responded_at = null where league_id = $1 and user_id = $2`, [L2, D]),
        Error, 'renewal_one_way');
      await assertRejects(() => q(`update league_renewal_responses set status = 'in', decided_by = 'player',
          responded_at = now() where league_id = $1 and user_id = $2`, [L2, D]),
        Error, 'renewal_removed_final');
      await assertRejects(() => q(`update league_renewal_responses set status = 'out', decided_by = 'player',
          responded_at = now() where league_id = $1 and user_id = $2`, [L2, C]),
        Error, 'renewal_commissioner_out');
      await assertRejects(() => q(`insert into league_renewal_responses (league_id, user_id, status, decided_by, responded_at)
          values ($1, $2, 'in', 'player', now())`, [L2, E]),
        Error, 'renewal_insert_pending_only');
    });

    await t.step('replies: each answer notifies the commissioner, with the counts at that moment', async () => {
      const a = await refusal('authenticated', A, `select public.respond_to_renewal($1, 'in') r`, [L2]);
      assertEquals(a, { status: 'replied', response: 'in', in: 2, out: 1, pending: 1 }); // C+A in; D out; B pending
      const notes = await q(`select detail from league_notifications where league_id = $1 and kind = 'renewal_reply'
        and user_id = $2 order by created_at`, [L2, C]);
      assertEquals(notes.length, 1);
      assertEquals(notes[0].detail.subject_name, 'ana');
      assertEquals(notes[0].detail.in, 2);
      assertEquals((await q(`select count(*)::int c from league_members where league_id = $1 and user_id = $2`, [L2, A]))[0].c, 1);
    });

    await t.step('the free flip: B goes in, out, in; each step is one reply and membership tracks it', async () => {
      await refusal('authenticated', B, `select public.respond_to_renewal($1, 'in') r`, [L2]);
      assertEquals((await refusal('authenticated', B, `select public.respond_to_renewal($1, 'out') r`, [L2])).status, 'replied');
      assertEquals((await q(`select count(*)::int c from league_members where league_id = $1 and user_id = $2`, [L2, B]))[0].c, 0);
      assertEquals((await refusal('authenticated', B, `select public.respond_to_renewal($1, 'in') r`, [L2])).status, 'replied');
      assertEquals((await refusal('authenticated', B, `select public.respond_to_renewal($1, 'in') r`, [L2])).status, 'unchanged');
      assertEquals((await q(`select count(*)::int c from league_members where league_id = $1 and user_id = $2`, [L2, B]))[0].c, 1);
    });

    await t.step('once every answer is in, nobody is pending (the gate has nothing left to hold)', async () => {
      // Nobody is pending now (A, B in; C in; D removed). The gate is open.
      assertEquals((await q(`select count(*)::int c from league_renewal_responses where league_id = $1 and status = 'pending'`, [L2]))[0].c, 0);
    });

    await t.step('the review: unknown keys and bad slots are refused before any write; a date is required', async () => {
      assertEquals(await refusal('authenticated', C, `select public.start_renewed_season($1, '{"foo":1}'::jsonb) r`, [L2]),
        { status: 'refused', reason: 'invalid_settings', unknown_keys: ['foo'] });
      assertEquals(await refusal('authenticated', C, `select public.start_renewed_season($1, '{"pick_seconds":45}'::jsonb) r`, [L2]),
        { status: 'refused', reason: 'no_draft_date' });
      assertEquals(await refusal('authenticated', C, `select public.start_renewed_season($1, '{}'::jsonb, '{"a":1}'::jsonb) r`, [L2]),
        { status: 'refused', reason: 'invalid_slots' });    // slots are type-checked before the date
      assertEquals((await q(`select pick_seconds from leagues where id = $1`, [L2]))[0].pick_seconds, 60);
      await assertRejects(() => rpc('authenticated', C,
        `select public.start_renewed_season($1, '{"draft_date":"2026-10-20T23:00:00Z","pick_seconds":20}'::jsonb) r`, [L2]),
        Error, 'pick_seconds');
      assertEquals((await q(`select draft_date from leagues where id = $1`, [L2]))[0].draft_date, null);
    });

    await t.step('the review applies settings and slots, and notifies members (not the commissioner, not the removed)', async () => {
      const ok = await refusal('authenticated', C,
        `select public.start_renewed_season($1, $2::jsonb, $3::jsonb) r`, [L2,
          JSON.stringify({ draft_date: '2026-10-20T23:00:00Z', pick_seconds: 45, num_weeks: 2 }),
          JSON.stringify([{ slot_index: 1, slot_count: 3, price_min: 5, price_max: 500 }])]);
      assertEquals(ok.status, 'season_set');
      assertEquals((await q(`select pick_seconds, num_weeks, draft_date is not null d from leagues where id = $1`, [L2]))[0],
        { pick_seconds: 45, num_weeks: 2, d: true });
      assertEquals(await q(`select slot_index, slot_count from league_draft_slots where league_id = $1`, [L2]),
        [{ slot_index: 1, slot_count: 3 }]);
      await refusal('authenticated', C, `select public.start_renewed_season($1, '{}'::jsonb) r`, [L2]);   // idempotent re-call
      const sets = await q(`select user_id from league_notifications where league_id = $1 and kind = 'season_set' order by user_id`, [L2]);
      assertEquals(sets.map((x: Row) => x.user_id), [A, B].sort());
    });

    await t.step('a newcomer joins during renewal and is "new"; the draft start sets the cap to the member count', async () => {
      await q(`insert into league_members (league_id, user_id, role) values ($1, $2, 'member')`, [L2, F]);
      // The cap is 16 while not started; the newcomer is not blocked by Season 1's 4.
      assertEquals((await q(`select num_participants from leagues where id = $1`, [L2]))[0].num_participants, 16);
      // draft-control refuses a start under 4 members; the CHECK is the backstop.
      const started = await rpc('service_role', null,
        `update leagues set draft_status = 'in_progress' where id = $1 returning num_participants`, [L2]);
      assertEquals(started.num_participants, 4);      // C, A, B, F
      assertEquals((await q(`select draft_status from leagues where id = $1`, [L2]))[0].draft_status, 'in_progress');
    });

    await t.step('after the draft starts: replies, nudges, removals and the review are refused', async () => {
      // A stranger learns nothing about the draft state: not_invited comes first.
      assertEquals(await refusal('authenticated', E, `select public.respond_to_renewal($1, 'in') r`, [L2]),
        { status: 'refused', reason: 'not_invited' });
      assertEquals(await refusal('authenticated', B, `select public.respond_to_renewal($1, 'out') r`, [L2]),
        { status: 'refused', reason: 'draft_started' });
      assertEquals(await refusal('authenticated', C, `select public.remove_renewal_invitee($1, $2) r`, [L2, B]),
        { status: 'refused', reason: 'draft_started' });
      assertEquals(await refusal('authenticated', C, `select public.start_renewed_season($1, '{}'::jsonb) r`, [L2]),
        { status: 'refused', reason: 'draft_started' });
    });

    await t.step('roster: the newcomer and the in players see the full list; the commissioner gets actions', async () => {
      const f = await refusal('authenticated', F, `select public.get_renewal_roster($1) r`, [L2]);
      assertEquals(f.full_list, true);
      assertEquals(f.caller_status, 'new');
      assertEquals(f.counts, { in: 3, new: 1, out: 1, pending: 0, team_count: 4, max_teams: 16 });
      assertEquals(f.replies_pending, false);
      assertEquals(f.people.find((p: Row) => p.user_id === F).can_remove, false);
      const c = await refusal('authenticated', C, `select public.get_renewal_roster($1) r`, [L2]);
      assertEquals(c.is_commissioner, true);
      assertEquals(c.people.find((p: Row) => p.user_id === D).group, 'out');
      assertEquals(c.people.find((p: Row) => p.user_id === D).decided_by, 'commissioner');
      assertEquals(c.people.find((p: Row) => p.user_id === C).can_remove, false);
    });

    await t.step('history: a newcomer reads Season 1 (standings and week-by-week); strangers read nothing', async () => {
      const rows = await as('authenticated', F, () => q(`select season_number, is_current, my_rank, final_standings
        from public.get_league_history($1) order by season_number desc`, [L2]));
      assertEquals(rows.map((r: Row) => r.season_number), [2, 1]);
      assertEquals([rows[0].is_current, rows[1].is_current], [true, false]);
      assertEquals(rows[1].my_rank, null);                       // F was not in Season 1
      assertEquals(rows[1].final_standings[0].display_name, 'ana');
      const mine = await as('authenticated', A, () => q(`select my_rank, my_wins::float8 my_wins from public.get_league_history($1)
        where season_number = 1`, [L2]));
      assertEquals(mine, [{ my_rank: 1, my_wins: 2 }]);
      const weeks = await as('authenticated', F, () => q(`select count(*)::int c from public.get_season_matchups($1)
        where season_number = 1`, [L2]));
      assertEquals(weeks, [{ c: 2 }]);
      assertEquals(await as('authenticated', E, () => q(`select * from public.get_league_history($1)`, [L2])), []);
      assertEquals(await as('authenticated', E, () => q(`select * from public.get_season_matchups($1)`, [L2])), []);
      // D declined Season 2 (removed) but was a Season 1 member: Season 1 stays theirs,
      // Season 2 does not (the visibility ceiling, security review MEDIUM-4).
      const dRows = await as('authenticated', D, () => q(`select season_number from public.get_league_history($1)`, [L2]));
      assertEquals(dRows, [{ season_number: 1 }]);
      assertEquals(await as('authenticated', D, () => q(`select count(*)::int c from public.get_season_matchups($1)
        where season_number = 2`, [L2])), [{ c: 0 }]);
    });

    await t.step('set_draft_order is refused while a reply is pending (before any order work runs)', async () => {
      const L3 = await completedLeague('Manual Cup', 'manual', 4);
      const r3 = await refusal('authenticated', C, `select public.renew_league($1) r`, [L3]);
      assertEquals(r3.status, 'renewed');
      assertEquals(await refusal('authenticated', C, `select public.set_draft_order($1, $2::text[]) r`,
        [r3.league_id, [C, A]]), { ok: false, reason: 'renewal_replies_pending' });
    });

    await t.step('cancel: before the draft, the new season and its rows are gone and the predecessor renews again', async () => {
      const L4 = await completedLeague('Cancel Me', 'random', 4);
      const r4 = await refusal('authenticated', C, `select public.renew_league($1) r`, [L4]);
      const gone = await refusal('authenticated', C, `select public.cancel_league_renewal($1) r`, [r4.league_id]);
      assertEquals(gone.status, 'cancelled');
      assertEquals((await q(`select count(*)::int c from leagues where id = $1`, [r4.league_id]))[0].c, 0);
      assertEquals((await q(`select count(*)::int c from league_renewal_responses where league_id = $1`, [r4.league_id]))[0].c, 0);
      assertEquals((await q(`select count(*)::int c from league_notifications where league_id = $1`, [r4.league_id]))[0].c, 0);
      assertEquals(await refusal('authenticated', C, `select public.cancel_league_renewal($1) r`, [L2]),
        { status: 'refused', reason: 'draft_started' });
      const again = await refusal('authenticated', C, `select public.renew_league($1) r`, [L4]);
      assertEquals(again.status, 'renewed');
      assert(again.league_id !== r4.league_id, 'a fresh successor, not the cancelled one');
    });

    await t.step('seats: pending invitees hold a reserved seat; newcomers and bots cannot take it', async () => {
      const L5 = await completedLeague('Full House', 'random', 4);
      const r5 = await refusal('authenticated', C, `select public.renew_league($1) r`, [L5]);
      // C (member) + 3 pending invitees = 4 seats in use. Bots fill the rest: 12 fit...
      for (let i = 1; i <= 12; i++) {
        await q(`insert into league_members (league_id, user_id, role) values ($1, $2, 'member')`, [r5.league_id, `bot-x${i}`]);
      }
      assertEquals((await q(`select count(*)::int c from league_members where league_id = $1`, [r5.league_id]))[0].c, 13);
      // ...the 13th would take a seat reserved for a pending invitee: refused by the table guard.
      await assertRejects(() => q(`insert into league_members (league_id, user_id, role) values ($1, 'bot-x13', 'member')`, [r5.league_id]),
        Error, 'league_full');
      // An invitee still gets in (their seat is reserved): the reply and the membership agree.
      assertEquals((await refusal('authenticated', A, `select public.respond_to_renewal($1, 'in') r`, [r5.league_id])).status, 'replied');
      assertEquals((await q(`select status from league_renewal_responses where league_id = $1 and user_id = $2`, [r5.league_id, A])),
        [{ status: 'in' }]);
      // A join by code (any path: a direct insert here) for a pending invitee syncs their reply to 'in'.
      await q(`insert into league_members (league_id, user_id, role) values ($1, $2, 'member')`, [r5.league_id, B]);
      assertEquals((await q(`select status, decided_by from league_renewal_responses where league_id = $1 and user_id = $2`, [r5.league_id, B])),
        [{ status: 'in', decided_by: 'player' }]);
    });

    await t.step('a player removed by the commissioner cannot rejoin by any path (join-by-code included)', async () => {
      const L6 = await completedLeague('Rejoin', 'random', 4);
      const r6 = await refusal('authenticated', C, `select public.renew_league($1) r`, [L6]);
      await refusal('authenticated', C, `select public.remove_renewal_invitee($1, $2) r`, [r6.league_id, D]);
      await assertRejects(() => q(`insert into league_members (league_id, user_id, role) values ($1, $2, 'member')`, [r6.league_id, D]),
        Error, 'renewal_removed_final');
      assertEquals((await q(`select count(*)::int c from league_members where league_id = $1 and user_id = $2`, [r6.league_id, D]))[0].c, 0);
    });

    await t.step('bots are not newcomers: the roster and the counts exclude them', async () => {
      const L7 = await completedLeague('Bots', 'random', 8);
      const r7 = await refusal('authenticated', C, `select public.renew_league($1) r`, [L7]);
      await q(`insert into league_members (league_id, user_id, role) values ($1, 'bot-z1', 'member')`, [r7.league_id]);
      const roster = await refusal('authenticated', C, `select public.get_renewal_roster($1) r`, [r7.league_id]);
      assertEquals(roster.counts.new, 0);
      assert(!roster.people.some((p: Row) => p.user_id === 'bot-z1'), 'a bot is not a person in the list');
    });

    await t.step('a player who leaves by a direct DELETE: the reply follows (in -> out), and the commissioner cannot leave', async () => {
      const L8 = await completedLeague('Leave Me', 'random', 4);
      const r8 = await refusal('authenticated', C, `select public.renew_league($1) r`, [L8]);
      await refusal('authenticated', A, `select public.respond_to_renewal($1, 'in') r`, [r8.league_id]);
      // A leaves through the interim self-leave policy, not the RPC.
      await as('authenticated', A, () => q(`delete from league_members where league_id = $1 and user_id = $2`, [r8.league_id, A]));
      assertEquals(await q(`select status, decided_by from league_renewal_responses where league_id = $1 and user_id = $2`, [r8.league_id, A]),
        [{ status: 'out', decided_by: 'player' }]);
      assertEquals((await q(`select count(*)::int c from league_members where league_id = $1 and user_id = $2`, [r8.league_id, A]))[0].c, 0);
      // The commissioner cannot delete their own membership of their renewal.
      await assertRejects(() => as('authenticated', C, () => q(`delete from league_members where league_id = $1 and user_id = $2`, [r8.league_id, C])),
        Error, 'renewal_commissioner_out');
    });

    await t.step('the seat check takes the league row lock (so add_bots and a join cannot both pass the count)', async () => {
      const [fn] = await q(`select prosrc from pg_proc where proname = 'enforce_renewal_membership'`);
      const at = fn.prosrc.indexOf('for update');
      assert(at > 0, 'enforce_renewal_membership must lock the league row');
      assert(fn.prosrc.indexOf('count(*)') > at, 'the lock must come before the count');
    });

    await t.step('a season completion takes the trade lock after its row lock (lock order, text check)', async () => {
      const src = await Deno.readTextFile(new URL('supabase/migrations/20261105000009_complete_league_season_trade_lock.sql', ROOT));
      const row = src.indexOf('FOR UPDATE;');
      const adv = src.indexOf("pg_advisory_xact_lock(hashtextextended('record-trade:'");
      const upd = src.indexOf("SET season_status = 'completed'");
      assert(row > 0 && adv > row && upd > adv, 'row lock, then the trade advisory lock, then the season write');
    });

    await t.step('the lineage columns are written by the renewal functions only (direct client writes are refused)', async () => {
      // A commissioner's own rename is fine (an ordinary settings write).
      assertEquals((await rpc('authenticated', C, `update leagues set name = 'Scudetto 2' where id = $1 returning name`, [L2])).name,
        'Scudetto 2');
      // Clearing the predecessor link (which would switch the gate off) is refused.
      await assertRejects(() => rpc('authenticated', C, `update leagues set previous_league_id = null where id = $1 returning id`, [L2]),
        Error, 'renewal_lineage_locked');
      // Joining a victim's lineage by writing lineage_id is refused.
      await assertRejects(() => rpc('authenticated', C, `update leagues set lineage_id = $2 where id = $1 returning id`, [L1, L2]),
        Error, 'renewal_lineage_locked');
      // A direct insert that claims a lineage is refused; an ordinary league is fine.
      await assertRejects(() => rpc('authenticated', C,
        `insert into leagues (name, commissioner_id, lineage_id) values ('forged', $1, $2) returning id`, [C, L1]),
        Error, 'renewal_lineage_locked');
      const ok = await rpc('authenticated', C, `insert into leagues (name, commissioner_id) values ('fresh', $1) returning id`, [C]);
      assert(ok.id, 'an ordinary league can still be created');
      // The predecessor of a renewed season cannot be deleted out from under it.
      await assertRejects(() => q(`delete from leagues where id = $1`, [L1]), Error, 'foreign key');
    });

    await t.step('renew_league: a missing league and a non-commissioner get the same error (no existence oracle)', async () => {
      await assertRejects(() => rpc('authenticated', C, `select public.renew_league($1) r`,
        ['00000000-0000-4000-8000-00000000dead']), Error, 'not_commissioner');
    });

    await t.step('finalize_league_draft numbers the season from leagues.season_number (3, not 1)', async () => {
      const [d] = await q(`insert into leagues (name, commissioner_id, league_type, duration_days, draft_status,
          season_number, num_participants)
        values ('dur', $1, 'duration', 30, 'in_progress', 3, 4) returning id`, [A]);
      const members = [A, B, C, D];
      for (const m of members) await q(`insert into league_members (league_id, user_id) values ($1, $2)`, [d.id, m]);
      const res = await rpc('service_role', null,
        `select public.finalize_league_draft($1, $2::text[], now(), now() + interval '60 days', '[]'::jsonb) r`,
        [d.id, members]);
      assertEquals(res.r.status, 'finalized');
      assertEquals((await q(`select season_number from league_seasons where league_id = $1`, [d.id])),
        [{ season_number: 3 }]);
    });

    await t.step('get_home_summary: the lineage columns exist, and the grants are the lockdown (re-applied after DROP)', async () => {
      const [p] = await q(`select p.proacl::text acl, pg_get_function_result(p.oid) res
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'get_home_summary'`);
      assert(p.res.includes('previous_league_id uuid'), p.res);
      assert(p.res.includes('successor_league_id uuid'), p.res);
      assertEquals(p.acl, '{postgres=X/postgres,authenticated=X/postgres}');
    });

    await t.step('the human effect test (docs/security/run-it-back-effect-test.sql) passes against this fixture', async () => {
      // The file the human runs in prod, executed verbatim here: it must end in
      // RAISE with a PASS verdict (everything rolls back).
      await completedLeague('Effect Test', 'random', 4);   // the one league the effect test may pick
      const renewalsBefore = (await q(`select count(*)::int c from leagues where previous_league_id is not null`))[0].c;
      const effect = await Deno.readTextFile(new URL('docs/security/run-it-back-effect-test.sql', ROOT));
      const err = await assertRejects(() => db.exec(effect)) as Error;
      assert(err.message.startsWith('RUN IT BACK EFFECT TEST: PASS'), err.message);
      assertEquals((await q(`select count(*)::int c from leagues where previous_league_id is not null`))[0].c, renewalsBefore,
        'the effect test rolled back: it persisted no renewal');
    });

    await db.close();
  },
});
