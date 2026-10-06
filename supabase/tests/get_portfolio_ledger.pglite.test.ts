/**
 * get_portfolio_ledger (20261031000000 -- provisional timestamp) against REAL
 * Postgres (PGlite = Postgres 16 in WASM). NOT hermetic: the first run fetches
 * npm:@electric-sql/pglite. Run instructions: supabase/tests/README.md.
 *
 * Loads VERBATIM (never retyped): the migration under test; its dependencies
 * public.league_activity (20261005000000) and public.get_league_display_names /
 * public.participant_display_name (20261004000000); and the is_member RLS
 * helper (sliced from 20260712000000). Table schemas are hand-written to the
 * CURRENT shape. The SELECT policies on drafts, trades, league_members and
 * symbols are reproduced from prod (docs/architecture/db-snapshot.json and
 * 20260811000005), not loaded verbatim -- see the CANNOT-PROVE list below.
 *
 * PROVES:
 *   (a) a member sees their league's activity (ordered, SKIP and other-league
 *       rows excluded), names for exactly the activity's symbols, and the
 *       CURRENT members with display names and is_bot. A former participant
 *       with activity is absent from members.
 *   (b) a non-member gets the empty shape, both for a league where they are not
 *       a member and where that league holds real data for the caller.
 *   (c) anon is refused with SQLSTATE 42501.
 *   (d) proacl: no PUBLIC, anon or service_role entry; authenticated present;
 *       SECURITY INVOKER; search_path pinned.
 *
 * CANNOT PROVE (and why):
 *   - Real GoTrue/PostgREST JWT handling. auth.uid() is a shim that reads
 *     request.jwt.claim.sub.
 *   - Prod's role and grant state. Supabase's default grants are simulated with
 *     ALTER DEFAULT PRIVILEGES. The real proacl is checked only by the post-push
 *     query in the migration header.
 *   - BYPASSRLS for service_role. The harness does not model it, so the
 *     service_role exclusion is proven by proacl (d), not by a call.
 *   - Prod RLS drift. The drafts/trades/league_members/symbols policies are
 *     hand-copied from prod. If prod changes, this test does not notice.
 *   - user_profiles RLS as the caller. participant_display_name reads it as the
 *     definer, so the caller's view of user_profiles is not exercised here.
 *   - Concurrency or prod data volume.
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';

const ROOT = new URL('../../', import.meta.url);
const mig = (name: string) => Deno.readTextFile(new URL(`supabase/migrations/${name}`, ROOT));

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
  id uuid primary key default gen_random_uuid(), name text
);
create table league_members (
  league_id uuid not null references leagues(id) on delete cascade,
  user_id text not null, joined_at timestamptz not null default now(),
  primary key (league_id, user_id)
);
create table league_standings (
  league_id uuid not null references leagues(id) on delete cascade,
  user_id text not null,
  primary key (league_id, user_id)
);
create table matchups (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  week_number int not null, team1_user_id text, team2_user_id text
);
create table user_profiles (id uuid primary key, username text);
create table symbols (symbol text primary key, name text);
create table drafts (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  user_id text not null, symbol text not null,
  entry_price numeric not null, quantity numeric not null,
  round int, pick_number int,
  created_at timestamptz not null default now()
);
create table trades (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  user_id uuid not null, symbol text not null,
  action text not null check (action in ('buy','sell')),
  quantity numeric not null, price numeric not null, total_value numeric not null,
  created_at timestamptz not null default now()
);
grant select on leagues, league_members, league_standings, matchups, user_profiles,
  symbols, drafts, trades to authenticated, service_role;
`;

// The prod SELECT policies these tables carry. Reproduced, not loaded:
// drafts/trades from db-snapshot.json, league_members from 20260811000005,
// user_profiles from 20260728000001, symbols from db-snapshot.json ("read symbols").
const RLS = `
alter table drafts enable row level security;
alter table trades enable row level security;
alter table league_members enable row level security;
alter table user_profiles enable row level security;
alter table symbols enable row level security;
create policy "Users can view picks in their leagues" on drafts for select using (
  exists (select 1 from league_members where league_members.league_id = drafts.league_id
          and league_members.user_id = auth.uid()::text));
create policy "Users can view trades in their leagues" on trades for select using (
  exists (select 1 from league_members where league_members.league_id = trades.league_id
          and league_members.user_id = auth.uid()::text));
create policy league_members_select_members on league_members for select using (
  is_member(league_id) or user_id = (auth.uid())::text);
create policy "Authenticated users can view profiles" on user_profiles for select
  to authenticated using (true);
create policy "read symbols" on symbols for select using (true);
`;

/** The exact text from `start` up to and including the first `end` after it. */
function slice(src: string, start: string, end: string): string {
  const i = src.indexOf(start);
  if (i < 0) throw new Error(`slice start not found: ${start}`);
  const j = src.indexOf(end, i);
  if (j < 0) throw new Error(`slice end not found: ${end}`);
  return src.slice(i, j + end.length);
}

// deno-lint-ignore no-explicit-any
type Row = any;

const ACTIVITY_KEYS = [
  'action', 'id', 'kind', 'league_id', 'occurred_at', 'pick_number', 'price',
  'quantity', 'round', 'symbol', 'total_value', 'user_id',
];

Deno.test({
  name: 'get_portfolio_ledger on real Postgres (PGlite)',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const db = new PGlite();
    const q = async (s: string, p: unknown[] = []) => (await db.query(s, p)).rows as Row[];

    await db.exec(SCHEMA);
    const helpers = await mig('20260712000000_rls_b1_00_helpers.sql');
    await db.exec(slice(helpers, 'create or replace function public.is_member(', '$$;'));
    await db.exec(RLS);
    await db.exec(await mig('20261004000000_participant_display_names.sql'));
    await db.exec(await mig('20261005000000_league_activity_view.sql'));
    await db.exec(await mig('20261031000000_get_portfolio_ledger.sql'));

    const MEMBER   = '00000000-0000-4000-8000-000000000001';
    const OPP      = '00000000-0000-4000-8000-000000000002';
    const LEFT     = '00000000-0000-4000-8000-000000000003'; // had activity, then left
    const OUTSIDER = '00000000-0000-4000-8000-000000000009';
    const BOT      = 'bot-2'; // bot-N -> 'Earnings Ed' (index 2)

    const [l1] = await q(`insert into leagues (name) values ('L1') returning id`);
    const [l2] = await q(`insert into leagues (name) values ('L2') returning id`);
    const L1 = l1.id as string;
    const L2 = l2.id as string;

    // L1 roster: MEMBER, OPP, BOT. LEFT is NOT on the roster.
    await q(`insert into league_members (league_id, user_id) values ($1,$2),($1,$3),($1,$4)`, [L1, MEMBER, OPP, BOT]);
    // L2: OPP and OUTSIDER are members. MEMBER is NOT.
    await q(`insert into league_members (league_id, user_id) values ($1,$2),($1,$3)`, [L2, OPP, OUTSIDER]);
    await q(`insert into league_standings (league_id, user_id) values ($1,$2),($1,$3)`, [L1, MEMBER, LEFT]);

    await q(`insert into user_profiles (id, username) values ($1,'maya'),($2,'sam')`, [MEMBER, OPP]);
    await q(`insert into symbols (symbol, name) values
      ('NVDA','NVIDIA Corp'), ('AMD','Advanced Micro Devices'), ('AAPL','Apple Inc'),
      ('TSLA','Tesla Inc'), ('ZZZ','Unrelated Co')`);

    // L1 activity. The SKIP row must be excluded by the view. LEFT's pick stays
    // in activity even though LEFT is no longer a member.
    await q(`insert into drafts (league_id, user_id, symbol, entry_price, quantity, round, pick_number, created_at) values
      ($1,$2,'NVDA',290.10,6.5,1,3,'2026-09-01T10:00:00Z'),
      ($1,$3,'SKIP',0,0,2,4,'2026-09-02T10:00:00Z'),
      ($1,$4,'AMD',160.00,10,1,5,'2026-09-10T10:00:00Z')`, [L1, MEMBER, OPP, LEFT]);
    await q(`insert into trades (league_id, user_id, symbol, action, quantity, price, total_value, created_at) values
      ($1,$2,'AAPL','buy',5,200,1000,'2026-09-20T15:00:00Z')`, [L1, MEMBER]);
    // A pick in L2 by MEMBER. MEMBER is not in L2, so it must never surface.
    await q(`insert into drafts (league_id, user_id, symbol, entry_price, quantity, round, pick_number) values
      ($1,$2,'TSLA',250,2,1,1)`, [L2, MEMBER]);

    await t.step('(a) member: activity ordered and scoped, names for activity symbols only, current members only', async () => {
      await db.exec(`RESET ROLE;`);
      await db.exec(`SET ROLE authenticated;`);
      await db.exec(`SELECT set_config('request.jwt.claim.sub', '${MEMBER}', false);`);
      const [row] = await q(`select public.get_portfolio_ledger($1) as result`, [L1]);
      const r = row.result;

      assertEquals(Object.keys(r).sort(), ['activity', 'members', 'symbol_names']);

      // Ordered by occurred_at; SKIP and the L2 TSLA pick are absent.
      assertEquals(r.activity.map((a: Row) => a.symbol), ['NVDA', 'AMD', 'AAPL']);
      assertEquals(r.activity[0].kind, 'draft');
      assertEquals(r.activity[2].kind, 'trade');
      assertEquals(Object.keys(r.activity[0]).sort(), ACTIVITY_KEYS);

      // Names exactly for the activity symbols: no ZZZ, no TSLA.
      assertEquals(r.symbol_names, {
        NVDA: 'NVIDIA Corp',
        AMD: 'Advanced Micro Devices',
        AAPL: 'Apple Inc',
      });

      // Current members: MEMBER and OPP by username, BOT by its bot name.
      // LEFT has activity and a standings row but is not a member, so absent.
      assertEquals(r.members.length, 3);
      const byId = Object.fromEntries(r.members.map((m: Row) => [m.user_id, m]));
      assertEquals(byId[MEMBER], { user_id: MEMBER, display_name: 'maya', is_bot: false });
      assertEquals(byId[OPP], { user_id: OPP, display_name: 'sam', is_bot: false });
      assertEquals(byId[BOT], { user_id: BOT, display_name: 'Earnings Ed', is_bot: true });
      assert(!(LEFT in byId), 'a former participant leaked into members');

      // SHOULD-1 (review): the function's gate is not the only barrier. The view
      // itself must honour RLS as the caller: MEMBER has a pick in L2 but is not
      // a member there, so no L2 row may appear in a direct read of the view.
      const direct = await q(`select league_id from public.league_activity`);
      assert(direct.length > 0, 'the member should see their own league activity');
      assert(!direct.some((r) => r.league_id === L2), 'league_activity leaked another league to a non-member');

      await db.exec(`RESET ROLE;`);
    });

    await t.step('(b) non-member: empty shape, for a league with no access and for a league holding the caller\'s own data', async () => {
      await db.exec(`RESET ROLE;`);
      const EMPTY = { activity: [], symbol_names: {}, members: [] };

      await db.exec(`SET ROLE authenticated;`);
      await db.exec(`SELECT set_config('request.jwt.claim.sub', '${OUTSIDER}', false);`);
      const [outRow] = await q(`select public.get_portfolio_ledger($1) as result`, [L1]);
      assertEquals(outRow.result, EMPTY);
      await db.exec(`RESET ROLE;`);

      // MEMBER has a TSLA pick in L2 but is not a member of L2. Must be empty,
      // not a leaked row and not an error from get_league_display_names.
      await db.exec(`SET ROLE authenticated;`);
      await db.exec(`SELECT set_config('request.jwt.claim.sub', '${MEMBER}', false);`);
      const [l2Row] = await q(`select public.get_portfolio_ledger($1) as result`, [L2]);
      assertEquals(l2Row.result, EMPTY);
      await db.exec(`RESET ROLE;`);
    });

    await t.step('(c) anon: refused with SQLSTATE 42501', async () => {
      await db.exec(`RESET ROLE;`);
      await db.exec(`SET ROLE anon;`);
      let code: string | undefined;
      let threw = false;
      try {
        await q(`select public.get_portfolio_ledger($1)`, [L1]);
      } catch (e) {
        threw = true;
        code = (e as { code?: string }).code;
      }
      await db.exec(`RESET ROLE;`);
      assert(threw, 'anon call should have been refused');
      assertEquals(code, '42501');
    });

    await t.step('(d) proacl: explicit revokes survive Supabase-simulated default grants; INVOKER; search_path pinned', async () => {
      await db.exec(`RESET ROLE;`);
      const [meta] = await q(`select proacl::text acl, prosecdef, proconfig::text cfg
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and proname = 'get_portfolio_ledger'`);
      assert(meta.acl, 'proacl must be explicit (non-null) after the revokes');
      assert(!/(^|[{,])=/.test(meta.acl), `PUBLIC must have no grant: ${meta.acl}`);
      assert(!meta.acl.includes('anon='), `anon must have no grant: ${meta.acl}`);
      assert(!meta.acl.includes('service_role='), `service_role must have no grant: ${meta.acl}`);
      assert(meta.acl.includes('authenticated='), `authenticated must be granted: ${meta.acl}`);
      assertEquals(meta.prosecdef, false);
      assert(meta.cfg.includes('search_path=public, pg_temp'), `search_path not pinned: ${meta.cfg}`);
    });
  },
});
