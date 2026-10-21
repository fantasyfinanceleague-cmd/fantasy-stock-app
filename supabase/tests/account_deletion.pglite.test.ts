/**
 * Account deletion, the database half (plan docs/plans/2026-10-21-account-deletion.md,
 * W2): migrations 20261125000000-07 on the WHOLE migration chain (full_chain.ts), so
 * every live trigger, CHECK and policy from every other feature is in play. A
 * replica could not show that nothing else refuses the succession mid-season.
 *
 * Against REAL Postgres (PGlite). NOT hermetic: the first run fetches
 * npm:@electric-sql/pglite. Run: `deno test --allow-read --allow-env supabase/tests/`
 *
 * Cast. A is deleted. B, C, D are leaguemates. E takes A's seat; F is too late.
 * G and H are two more deletions for the heal pass.
 *   LPRE   pre-draft, commissioner B; A a member          -> A leaves (the leave_league branch)
 *   LPRE2  pre-draft, commissioner B; A LEFT earlier       -> the old reconfirm name becomes the label
 *   LPC    pre-draft, commissioner A; D joined before C    -> D commissioner, then A leaves
 *   LMID   mid-season matchup, commissioner A; B earliest -> B commissioner; A's seat stays, deleted
 *   LDRAFT live draft, commissioner B                      -> A's seat stays (auto-picks), queue gone
 *   LAFTER completed, commissioner C; A hid after it,
 *          A champion                                      -> seat deleted, frozen name scrubbed
 *   LEMPTY pre-draft, A + a bot only                       -> deleted
 *   LOLD   completed, A + a bot only, renewed as LNEW      -> kept (ON DELETE RESTRICT), seat marked
 *   LNEW   the renewal, commissioner A, C in, B pending    -> C commissioner, A leaves
 *   LR2    a renewal of LAFTER by C, A's reply pending     -> A's reply deleted (the gate frees)
 *   LRS    a renewal of LPRE2 that has DRAFTED, A 'in'     -> A's seat kept, so its 'in' reply stays
 * LOLD also holds a hidden leaver B and an earlier-deleted seat Z, both joined before
 * anyone: neither may inherit the title. I's scrub is sabotaged to prove the effect check.
 */
import { assert, assertEquals, assertMatch, assertNotEquals, assertRejects } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';
import { applyFrom, loadChain, migrationFiles, readMigration } from './full_chain.ts';

// deno-lint-ignore no-explicit-any
type Row = any;

const ROOT = new URL('../../', import.meta.url);
const LABEL = 'Former manager';

const A = 'a1a1a1a1-0000-4000-8000-0000000000a1';
const B = 'b2b2b2b2-0000-4000-8000-0000000000b2';
const C = 'c3c3c3c3-0000-4000-8000-0000000000c3';
const D = 'd4d4d4d4-0000-4000-8000-0000000000d4';
const E = 'e5e5e5e5-0000-4000-8000-0000000000e5';
const F = 'f6f6f6f6-0000-4000-8000-0000000000f6';
const G = '07070707-0000-4000-8000-000000000007';
const H = '08080808-0000-4000-8000-000000000008';
const I = '09090909-0000-4000-8000-000000000009';
const Z = '0a0a0a0a-0000-4000-8000-00000000000a'; // an account deleted before this test (no auth row)
const A_FALLBACK = 'Player A1A1'; // participant_display_name's missing-username label for A
const lg = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const LPRE = lg(1), LPRE2 = lg(2), LPC = lg(3), LMID = lg(4), LDRAFT = lg(5), LAFTER = lg(6),
  LEMPTY = lg(7), LOLD = lg(8), LNEW = lg(9), LR2 = lg(10), LRS = lg(11);

/** The exact text from `start` up to and including the first `end` after it. */
function slice(src: string, start: string, end: string): string {
  const i = src.indexOf(start);
  if (i < 0) throw new Error(`slice start not found: ${start}`);
  const j = src.indexOf(end, i);
  if (j < 0) throw new Error(`slice end not found: ${end}`);
  return src.slice(i, j + end.length);
}
const fnBody = async (file: string, fn: string) =>
  slice(await readMigration(file), `create or replace function public.${fn}(`, '\n$$;');
function undo(body: string, pairs: [string, string][]): string {
  for (const [added, original] of pairs) {
    assert(body.includes(added), `expected change not found:\n${added}`);
    body = body.split(added).join(original);
  }
  return body;
}

// ---------------------------------------------------------------------------
// Static: each re-created function is its latest source plus ONLY the marked change.
// ---------------------------------------------------------------------------
const RECREATED: { fn: string; mine: string; source: string }[] = [
  { fn: 'league_members_freeze_leaver', mine: '20261125000001_deleted_seat_and_label.sql', source: '20261119000000_frozen_leaver_names.sql' },
  { fn: 'league_participant_display_name', mine: '20261125000001_deleted_seat_and_label.sql', source: '20261119000000_frozen_leaver_names.sql' },
  { fn: 'get_visible_profiles', mine: '20261125000001_deleted_seat_and_label.sql', source: '20261119000000_frozen_leaver_names.sql' },
  { fn: 'transfer_commissioner', mine: '20261125000002_deleted_seat_guards.sql', source: '20261120000000_transfer_commissioner_refuses_hidden.sql' },
  { fn: 'renew_league', mine: '20261125000002_deleted_seat_guards.sql', source: '20261115000003_run_it_back_rpcs.sql' },
  { fn: 'leave_league', mine: '20261125000004_leave_before_draft_shared.sql', source: '20261110000001_leave_league_transfer_first.sql' },
  { fn: 'enforce_league_draft_order_rows', mine: '20261125000006_take_over_team.sql', source: '20261013000000_draft_order_modes.sql' },
  { fn: 'invite_preview_lookup', mine: '20261125000008_takeover_codes_not_join_codes.sql', source: '20261124000000_invite_preview.sql' },
];

Deno.test('account deletion: each re-created function supersedes exactly its latest source', async () => {
  const files = await migrationFiles();
  for (const r of RECREATED) {
    const definers: string[] = [];
    for (const f of files) if ((await readMigration(f)).includes(`create or replace function public.${r.fn}(`)) definers.push(f);
    assertEquals(definers.at(-1), r.mine, `${r.fn}: the latest definition must be ${r.mine}`);
    assertEquals(definers.at(-2), r.source, `${r.fn}: the superseded definition must be ${r.source}`);
  }
  // join_league_by_code is defined without the schema prefix.
  const joins: string[] = [];
  for (const f of files) if (/create or replace function (public\.)?join_league_by_code\(/.test(await readMigration(f))) joins.push(f);
  assertEquals(joins.slice(-2), ['20261123000000_join_refuses_once_room_opens.sql', '20261125000008_takeover_codes_not_join_codes.sql']);
});

Deno.test('account deletion: re-created bodies differ from their source ONLY by the marked change', async () => {
  const S1 = '20261119000000_frozen_leaver_names.sql', M1 = '20261125000001_deleted_seat_and_label.sql';
  assertEquals(undo(await fnBody(M1, 'league_members_freeze_leaver'), [[
    `  if new.deleted_at is not null then
    -- 20261125000001: a deleted manager's seat keeps NO name or avatar, hidden
    -- or not (the account-deletion scrub). Checked first, so the "still hidden:
    -- keep the snapshot" branch below can never restore one.
    new.frozen_username := null;
    new.frozen_avatar   := null;
    new.frozen_at       := null;
  elsif new.hidden_at is null then`,
    `  if new.hidden_at is null then`,
  ]]), await fnBody(S1, 'league_members_freeze_leaver'));

  assertEquals(undo(await fnBody(M1, 'league_participant_display_name'), [[
    `    -- 20261125000001: a deleted manager's seat reads the placeholder, FIRST: before
    -- the frozen branch (a hidden seat that was then deleted) and before
    -- participant_display_name (whose 'Player XXXX' fallback is what a
    -- profile-less id would otherwise get).
    if exists (select 1 from public.league_members m
                where m.league_id = p_league_id and lower(m.user_id) = lower(p_user_id)
                  and m.deleted_at is not null) then
      return public.deleted_manager_label();
    end if;
`, '',
  ]]), await fnBody(S1, 'league_participant_display_name'));

  const gvp = await fnBody(M1, 'get_visible_profiles');
  const deletedCte = slice(gvp, '  ),\n  -- 20261125000001: a visible id', '       and m.deleted_at is not null\n  )');
  assertEquals(undo(gvp, [
    [deletedCte, '  )'],
    ['\n     and p.id::text not in (select d.uid from deleted d)   -- 20261125000001', ''],
    ['\n  union all\n  select d.uid::uuid, public.deleted_manager_label(), null::text   -- 20261125000001\n    from deleted d;', ';'],
  ]), await fnBody(S1, 'get_visible_profiles'));

  const M2 = '20261125000002_deleted_seat_guards.sql';
  assertEquals(undo(await fnBody(M2, 'transfer_commissioner'), [[
    `          and hidden_at is null   -- 20261120000000: a player who has left is not a current member
          and deleted_at is null) then   -- 20261125000002: nor is a deleted manager's seat`,
    `          and hidden_at is null) then   -- 20261120000000: a player who has left is not a current member`,
  ]]), await fnBody('20261120000000_transfer_commissioner_refuses_hidden.sql', 'transfer_commissioner'));
  assertEquals(undo(await fnBody(M2, 'renew_league'), [
    [`  -- 20261125000002: nor is a deleted manager's seat: their pending reply would
  -- hold the renewal gate shut until the commissioner removed it by hand.
`, ''],
    ['\n     and m.deleted_at is null;   -- 20261125000002: a deleted manager is never invited back', ';'],
  ]), await fnBody('20261115000003_run_it_back_rpcs.sql', 'renew_league'));

  // leave_league = its source with the tail moved into _leave_league_before_draft.
  const SRC = await fnBody('20261110000001_leave_league_transfer_first.sql', 'leave_league');
  const cut = '  -- ---- Run it back (dynamic: #94 may not be on this database) ---------------\n';
  const srcHead = SRC.slice(0, SRC.indexOf(cut));
  const srcTail = SRC.slice(SRC.indexOf(cut), SRC.lastIndexOf('end;\n$$;'));
  const M4 = '20261125000004_leave_before_draft_shared.sql';
  const mine = await fnBody(M4, 'leave_league');
  assert(mine.startsWith(srcHead.replace(/declare[\s\S]*?begin\n/, `declare
  v_l             public.leagues%rowtype;
  v_window        text;
  v_is_comm       boolean;
begin
`)), 'leave_league: everything before the pre-draft branch is unchanged');
  assert(mine.includes(
    'return public._leave_league_before_draft(p_league_id, p_user_id, public.participant_display_name(p_user_id));'));
  const internal = await fnBody(M4, '_leave_league_before_draft');
  assert(internal.includes(srcTail.split('public.participant_display_name(p_user_id)').join('p_leaver_name')),
    '_leave_league_before_draft: the source tail verbatim, name -> p_leaver_name');

  const M8 = '20261125000008_takeover_codes_not_join_codes.sql';
  const joinBody = async (f: string) => slice(await readMigration(f), 'create or replace function join_league_by_code(', '\n$$;');
  assertEquals(undo(await joinBody(M8), [[
    "    select * into v_invite from league_invites where code = p_code\n      and kind = 'invite';   -- 20261125000008: never a takeover code",
    '    select * into v_invite from league_invites where code = p_code;']]),
    await joinBody('20261123000000_join_refuses_once_room_opens.sql'));
  assertEquals(undo(await fnBody(M8, 'invite_preview_lookup'), [[
    "\n         and kind = 'invite';   -- 20261125000008: a takeover code is a MISS here", ';']]),
    await fnBody('20261124000000_invite_preview.sql', 'invite_preview_lookup'));

  const M6 = '20261125000006_take_over_team.sql';
  const order = await fnBody(M6, 'enforce_league_draft_order_rows');
  const added = slice(order, '  -- 20261125000006: take_over_team hands', '    return new;\n  end if;\n\n');
  assertEquals(undo(order, [[added, '']]), await fnBody('20261013000000_draft_order_modes.sql', 'enforce_league_draft_order_rows'));
});

Deno.test('account deletion: the label is one constant that can never be a username', async () => {
  const sql = await readMigration('20261125000001_deleted_seat_and_label.sql');
  const code = (src: string) => src.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
  assertEquals((code(sql).match(/'Former manager'/g) ?? []).length, 1, 'the wording lives in exactly one place');
  for (const f of await migrationFiles()) {
    if (f >= '20261125000000') {
      const n = (code(await readMigration(f)).match(/'Former manager'|'Open team'/g) ?? []).length;
      if (f !== '20261125000001_deleted_seat_and_label.sql') assertEquals(n, 0, `${f} hardcodes the label`);
    }
  }
  assert(!/^[A-Za-z0-9_]{3,20}$/.test(LABEL), 'user_profiles_username_format must reject the label');
});

// ---------------------------------------------------------------------------
// trades survive the auth delete (the FK drop), proven both ways.
// ---------------------------------------------------------------------------
Deno.test({
  name: 'account deletion: trades.user_id cascade is dropped (hazard before, survival after)',
  sanitizeResources: false, sanitizeOps: false,
  async fn() {
    const seed = async (db: PGlite) => {
      await db.query(`insert into auth.users (id, raw_user_meta_data) values ($1, '{"username":"tom_t"}')`, [A]);
      await db.query(`insert into leagues (id, name, commissioner_id, invite_code, num_participants, league_type)
                      values ($1, 'T', $2, 'TCODE1', 4, 'duration')`, [LMID, A]);
      await db.query(`insert into trades (league_id, user_id, symbol, action, quantity, price, total_value)
                      values ($1, $2, 'AAPL', 'buy', 1, 100, 100)`, [LMID, A]);
      await db.query(`delete from auth.users where id = $1`, [A]);
      return (await db.query<Row>(`select count(*)::int n from trades where user_id = $1`, [A])).rows[0].n;
    };
    const before = new PGlite();
    await loadChain(before, { untilBefore: '20261125000000' });
    assertEquals(await seed(before), 0, 'BEFORE the drop: deleting the auth user erased their trades');

    const after = new PGlite();
    await loadChain(after, { untilBefore: '20261125000000' });
    const applied = await applyFrom(after, '20261125000000');
    assertEquals(applied[0], '20261125000000_trades_user_fk_drop.sql');
    assertEquals(await seed(after), 1, 'AFTER the drop: the trade history stays');
    const fk = (await after.query<Row>(`select count(*)::int n from pg_constraint where conrelid = 'public.trades'::regclass
      and contype = 'f' and confrelid = 'auth.users'::regclass`)).rows[0].n;
    assertEquals(fk, 0);
    // Re-running the migration is a no-op (it finds nothing to drop).
    await after.exec(await readMigration('20261125000000_trades_user_fk_drop.sql'));
    await before.close(); await after.close();
  },
});

// ---------------------------------------------------------------------------
// The whole flow on the full chain.
// ---------------------------------------------------------------------------
Deno.test({
  name: 'account deletion on the full migration chain (PGlite)',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const db = new PGlite();
    await loadChain(db);
    const q = async (s: string, p: unknown[] = []) => (await db.query<Row>(s, p)).rows;
    const one = async (s: string, p: unknown[] = []) => (await q(s, p))[0];
    const as = async <T>(role: string, sub: string | null, fn: () => Promise<T>): Promise<T> => {
      await db.exec(`set role ${role}`);
      await db.query(`select set_config('request.jwt.claims', $1, false)`,
        [JSON.stringify(sub ? { sub, role } : { role })]);
      try { return await fn(); } finally {
        await db.exec('reset role').catch(() => {});
        await db.query(`select set_config('request.jwt.claims', '', false)`);
      }
    };
    const svc = <T>(fn: () => Promise<T>) => as('service_role', null, fn);
    const rpc = async (fn: string, args: unknown[]) =>
      (await one(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')}) r`, args)).r;
    const svcRpc = (fn: string, args: unknown[]) => svc(() => rpc(fn, args));
    const minutes = (n: number) => `now() - interval '${100 - n} minutes'`;

    // ---- fixtures (superuser, auth.uid() NULL: the service path) ----------------
    const users: [string, string][] = [[A, 'alice_a'], [B, 'bob_b'], [C, 'cara_c'], [D, 'dan_d'], [E, 'eve_e'],
      [F, 'fay_f'], [G, 'gus_g'], [H, 'hal_h'], [I, 'ivy_i']];
    for (const [id, name] of users) {
      await q(`insert into auth.users (id, raw_user_meta_data) values ($1, $2)`, [id, { username: name }]);
    }
    await q(`update user_profiles set avatar = 'avatar-of-' || username`);
    const league = async (id: string, name: string, comm: string, type = 'matchup', extra = '') =>
      await q(`insert into leagues (id, name, commissioner_id, invite_code, num_participants, league_type, num_weeks,
               playoff_teams${extra ? ', previous_league_id' : ''}) values ($1::uuid, $2, $3, upper(substr(md5($1::text), 1, 10)), 8,
               $4, 4, 2${extra ? ', $5::uuid' : ''})`, extra ? [id, name, comm, type, extra] : [id, name, comm, type]);
    const members = async (id: string, list: [string, number][], comm: string) => {
      for (const [u, at] of list) {
        await q(`insert into league_members (league_id, user_id, role, joined_at) values ($1, $2, $3, ${minutes(at)})`,
          [id, u, u === comm ? 'commissioner' : 'member']);
      }
    };
    const start = async (id: string) => q(`update leagues set draft_status = 'in_progress', draft_started_at = now() where id = $1`, [id]);
    const finish = async (id: string) => q(`update leagues set draft_status = 'completed', league_start_date = now() - interval '14 days',
      league_end_date = now() + interval '14 days' where id = $1`, [id]);

    await league(LPRE, 'Pre', B); await members(LPRE, [[B, 0], [A, 1], [C, 2]], B);
    await league(LPRE2, 'Pre2', B); await members(LPRE2, [[B, 0], [A, 1], [C, 2]], B);
    // A left LPRE2 earlier, through the real leave_league: the reconfirm snapshots 'alice_a'.
    assertEquals((await svcRpc('leave_league', [LPRE2, A, null])).status, 'left');
    await league(LPC, 'PreComm', A); await members(LPC, [[A, 0], [C, 2], [D, 1]], A);
    await league(LMID, 'Mid', A); await members(LMID, [[A, 0], [C, 2], [B, 1], [D, 3]], A);
    await start(LMID); await finish(LMID);
    await q(`insert into league_seasons (league_id, season_number) values ($1, 1)`, [LMID]);
    await q(`insert into matchups (league_id, week_number, team1_user_id, team2_user_id, team1_gain, team2_gain, winner_user_id)
             values ($1, 1, $2, $3, 5, 3, $2), ($1, 1, $4, $5, 1, 2, $5), ($1, 2, $3, $2, 3, 1, $3),
                    ($1, 3, $5, $4, 4, 1, $5)`, [LMID, A, B, C, D]);   // A 1-1, D 2-0: A is not 1st
    for (const [u, w, l] of [[A, 1, 1], [B, 1, 1], [C, 0, 2], [D, 2, 0]] as const) {   // the ranker reads these
      await q(`insert into league_standings (league_id, user_id, wins, losses) values ($1, $2, $3, $4)`, [LMID, u, w, l]);
    }
    await q(`insert into drafts (league_id, user_id, symbol, entry_price, quantity, round, pick_number)
             values ($1, $2, 'AAPL', 100, 1, 1, 1), ($1, $3, 'MSFT', 100, 1, 1, 2)`, [LMID, A, B]);
    await q(`insert into trades (league_id, user_id, symbol, action, quantity, price, total_value)
             values ($1, $2, 'NVDA', 'buy', 2, 50, 100), ($1, $2, 'AAPL', 'sell', 1, 110, 110)`, [LMID, A]);
    await q(`insert into week_snapshots (league_id, user_id, week_number, symbol, quantity, week_start_price)
             values ($1, $2, 1, 'AAPL', 1, 100)`, [LMID, A]);
    await q(`insert into league_invites (league_id, inviter_id, invited_identifier, code, status)
             values ($1, $2, 'friend@example.com', 'PENDA1', 'pending'), ($1, $2, 'old@example.com', 'ACCPA1', 'accepted')`, [LMID, A]);

    await league(LDRAFT, 'Draft', B); await members(LDRAFT, [[B, 0], [A, 1], [C, 2], [D, 3]], B);
    await start(LDRAFT);
    await q(`insert into draft_queue (league_id, user_id, symbol, position) values ($1, $2, 'AAPL', 1)`, [LDRAFT, A]);

    await league(LAFTER, 'After', C); await members(LAFTER, [[C, 0], [A, 1], [B, 2]], C);
    await start(LAFTER); await finish(LAFTER);
    await q(`update leagues set season_status = 'completed' where id = $1`, [LAFTER]);
    await q(`insert into league_seasons (league_id, season_number, completed_at, champion_user_id, runner_up_user_id)
             values ($1, 1, now(), $2, $3)`, [LAFTER, A, B]);
    await q(`update leagues set current_season_id = (select id from league_seasons where league_id = $1) where id = $1`, [LAFTER]);
    await q(`insert into matchups (league_id, week_number, team1_user_id, team2_user_id, team1_gain, team2_gain, winner_user_id)
             values ($1, 1, $2, $3, 9, 1, $2)`, [LAFTER, A, B]);
    await q(`insert into league_standings (league_id, user_id, wins) values ($1, $2, 1), ($1, $3, 0), ($1, $4, 0)`, [LAFTER, A, B, C]);
    await q(`insert into trades (league_id, user_id, symbol, action, quantity, price, total_value)
             values ($1, $2, 'TSLA', 'buy', 1, 10, 10)`, [LAFTER, A]);
    // A leaves LAFTER after the season, through the real leave_league: hidden + frozen 'alice_a'.
    assertEquals((await svcRpc('leave_league', [LAFTER, A, null])).status, 'hidden');
    assertEquals((await one(`select frozen_username from league_members where league_id = $1 and user_id = $2`, [LAFTER, A])).frozen_username, 'alice_a');

    await league(LEMPTY, 'Empty', A); await members(LEMPTY, [[A, 0], ['bot-1', 1]], A);

    await league(LOLD, 'Old', A); await members(LOLD, [[A, 0], ['bot-1', 1]], A);
    // Joined before anyone, but neither can run a league: a hidden leaver and a deleted seat.
    await q(`insert into league_members (league_id, user_id, role, joined_at, hidden_at) values ($1, $2, 'member', ${minutes(-3)}, now())`, [LOLD, B]);
    await q(`insert into league_members (league_id, user_id, role, joined_at, deleted_at) values ($1, $2, 'member', ${minutes(-5)}, now())`, [LOLD, Z]);
    await start(LOLD); await finish(LOLD);
    await q(`update leagues set season_status = 'completed' where id = $1`, [LOLD]);
    await league(LNEW, 'New', A, 'matchup', LOLD); await members(LNEW, [[A, 0], [C, 1]], A);
    // Replies are born pending (trg_league_renewal_responses_transitions), then answered.
    await q(`insert into league_renewal_responses (league_id, user_id, status) values ($1, $2, 'pending'), ($1, $3, 'pending')`, [LNEW, A, C]);
    await q(`update league_renewal_responses set status = 'in', decided_by = 'player', responded_at = now() where league_id = $1`, [LNEW]);
    await q(`insert into league_renewal_responses (league_id, user_id, status) values ($1, $2, 'pending')`, [LNEW, B]);
    // Someone else's notification ABOUT A, with A's name snapshotted in detail.
    await q(`insert into league_notifications (league_id, user_id, kind, subject_user_id, detail)
             values ($1, $2, 'renewal_invite', $3, '{"commissioner_name":"alice_a","league_name":"New"}')`, [LNEW, B, A]);

    await league(LR2, 'R2', C, 'matchup', LAFTER); await members(LR2, [[C, 0]], C);
    await q(`insert into league_renewal_responses (league_id, user_id, status) values ($1, $2, 'pending')`, [LR2, C]);
    await q(`update league_renewal_responses set status = 'in', decided_by = 'player', responded_at = now() where league_id = $1`, [LR2]);
    await q(`insert into league_renewal_responses (league_id, user_id, status) values ($1, $2, 'pending')`, [LR2, A]);
    await q(`insert into league_notifications (league_id, user_id, kind, subject_user_id, detail)
             values ($1, $2, 'renewal_invite', $3, '{"commissioner_name":"cara_c"}')`, [LR2, A, C]);
    await q(`insert into push_tokens (user_id, token) values ($1, 'ExponentPushToken[a]')`, [A]);

    // LRS: a renewal that has drafted, with A 'in' and seated: the seat (and so the reply) stays.
    await league(LRS, 'RS', B, 'matchup', LPRE2); await members(LRS, [[B, 0], [A, 1], [C, 2], [D, 3]], B);
    await q(`insert into league_renewal_responses (league_id, user_id, status) values ($1, $2, 'pending'), ($1, $3, 'pending'),
             ($1, $4, 'pending'), ($1, $5, 'pending')`, [LRS, A, B, C, D]);
    await q(`update league_renewal_responses set status = 'in', decided_by = 'player', responded_at = now() where league_id = $1`, [LRS]);
    await start(LRS); await finish(LRS);

    // The waiver-wire plan's tables, as that plan specifies them (not on main yet): the scrub and
    // the takeover reach them dynamically, so they must work once they exist.
    await q(`create table public.watchlist (league_id uuid, user_id text, symbol text, primary key (league_id, user_id, symbol))`);
    await q(`create table public.claims (id uuid primary key default gen_random_uuid(), league_id uuid, user_id text,
             symbol text, status text check (status in ('pending','won','lost','failed','cancelled')))`);
    await q(`create table public.waiver_order (league_id uuid, user_id text, position smallint, primary key (league_id, user_id))`);
    await q(`insert into watchlist values ($1, $2, 'AAPL'), ($1, $3, 'AAPL')`, [LMID, A, B]);
    await q(`insert into claims (league_id, user_id, symbol, status) values ($1, $2, 'NVDA', 'pending'), ($1, $2, 'TSLA', 'won'),
             ($1, $3, 'NVDA', 'pending')`, [LMID, A, B]);
    await q(`insert into waiver_order values ($1, $2, 1), ($1, $3, 2)`, [LMID, A, B]);

    // ---- grants -------------------------------------------------------------------
    await t.step('grants: every function and the ledger table, proacl exact', async () => {
      const SVC = '{postgres=X/postgres,service_role=X/postgres}';
      const OWNER = '{postgres=X/postgres}';
      const AUTH = '{postgres=X/postgres,authenticated=X/postgres}';
      const want: Record<string, string> = {
        scrub_deleted_manager: SVC, take_over_team: SVC, takeover_preview: SVC, heal_account_deletions: SVC,
        heal_account_deletions_due: SVC, leave_league: SVC,
        transfer_commissioner: SVC, account_deletion_open: SVC, account_deletion_cancel: SVC,
        account_deletion_set_apple: SVC, account_deletion_stash_apple_token: SVC, account_deletion_apple_token: SVC,
        account_deletion_apple_revoked: SVC, account_deletion_apple_unrevoked: SVC, account_deletion_fail: SVC,
        account_deletion_mark_done: SVC,
        _leave_league_before_draft: OWNER, league_participant_display_name: OWNER, league_members_freeze_leaver: OWNER,
        enforce_league_draft_order_rows: OWNER, _takeover_check: OWNER, _account_deletion_settle_apple: OWNER,
        _account_deletion_apple_rank: OWNER, takeover_guess_try_lock: OWNER,
        join_league_by_code: SVC, invite_preview_lookup: SVC,
        get_visible_profiles: AUTH, create_takeover_invite: AUTH, renew_league: AUTH,
        deleted_manager_label: '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}',
      };
      const rows = await q(`select proname, proacl::text a, prosecdef, proconfig::text c from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and proname = any($1)`, [Object.keys(want)]);
      assertEquals(rows.length, Object.keys(want).length, 'exactly one overload each');
      for (const r of rows) {
        assertEquals(r.a, want[r.proname], `${r.proname} proacl`);
        assertMatch(r.c, /^\{"search_path=public, pg_temp"/, `${r.proname} search_path`);
        // The constants and the try-lock need no privilege; everything else is a definer.
        assertEquals(r.prosecdef, !['deleted_manager_label', '_account_deletion_apple_rank', 'takeover_guess_try_lock'].includes(r.proname),
          `${r.proname} security mode`);
      }
      for (const tbl of ['account_deletions', 'takeover_guess_limits']) {
        const t1 = await one(`select relrowsecurity, relacl::text a from pg_class where oid = ('public.' || $1)::regclass`, [tbl]);
        assert(t1.relrowsecurity, `${tbl}: RLS on`);
        assertMatch(t1.a, /^\{postgres=[a-zA-Z]+\/postgres\}$/, `${tbl}: owner only, no service_role either`);
        assertEquals((await one(`select count(*)::int n from pg_policies where tablename = $1`, [tbl])).n, 0);
      }
    });

    await t.step('grants: the check is sensitive (a REVOKE FROM PUBLIC alone is caught)', async () => {
      await q(`create function public.zz_probe() returns int language sql as $$ select 1 $$`);
      await q(`revoke all on function public.zz_probe() from public`);
      const a = (await one(`select proacl::text a from pg_proc where proname = 'zz_probe'`)).a;
      assert(a.includes('anon=X') && a.includes('authenticated=X'), `Supabase default grants survive: ${a}`);
      await q(`drop function public.zz_probe()`);
    });

    await t.step('grants: refused callers (anon / authenticated / service_role on tables)', async () => {
      const denied = async (role: string, sub: string | null, sql: string, args: unknown[] = []) =>
        await assertRejects(() => as(role, sub, () => q(sql, args)), Error, 'permission denied');
      for (const [fn, args] of [['scrub_deleted_manager', [A]], ['take_over_team', ['X', E]],
        ['takeover_preview', ['X', E]], ['heal_account_deletions', []], ['heal_account_deletions_due', []],
        ['account_deletion_open', [A, false]], ['account_deletion_mark_done', [A]],
        ['account_deletion_apple_token', [A]], ['account_deletion_apple_unrevoked', [A]],
        ['leave_league', [LPRE, A, null]]] as [string, unknown[]][]) {
        const call = `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')})`;
        await denied('anon', null, call, args);
        await denied('authenticated', A, call, args);
      }
      await denied('anon', null, `select public.create_takeover_invite($1, $2)`, [LMID, A]);
      await denied('anon', null, `select public.deleted_manager_label()`);
      for (const role of ['anon', 'authenticated', 'service_role']) {
        await denied(role, role === 'authenticated' ? A : null, `select * from public.account_deletions`);
        await denied(role, role === 'authenticated' ? A : null, `select * from public.takeover_guess_limits`);
      }
      // The internals are callable by nobody but the owner.
      await denied('service_role', null, `select public._leave_league_before_draft($1, $2, 'x')`, [LPRE, A]);
      await denied('service_role', null, `select public._takeover_check('X', $1, false)`, [E]);
      await denied('service_role', null, `select public._account_deletion_settle_apple($1, 'done')`, [A]);
      await denied('authenticated', A, `select public.league_participant_display_name($1, $2)`, [LMID, A]);
      assertEquals(await as('authenticated', A, () => rpc('deleted_manager_label', [])), LABEL);
    });

    // ---- the ledger guards -------------------------------------------------------------
    await t.step('ledger: no ledger, no scrub; no account, no ledger', async () => {
      assertEquals(await svcRpc('scrub_deleted_manager', [A]), { status: 'refused', reason: 'no_ledger' });
      assertEquals((await svcRpc('account_deletion_open', ['99999999-0000-4000-8000-000000000099', false])).reason, 'no_such_user');
      assertEquals((await one(`select count(*)::int n from user_profiles where id = $1`, [A])).n, 1, 'nothing scrubbed');
    });

    // ---- the label through the seam BEFORE: A is live everywhere -----------------------
    const namesIn = async (viewer: string, league: string) => Object.fromEntries((await as('authenticated', viewer, () =>
      q(`select user_id, display_name from public.get_league_display_names($1)`, [league])))
      .map((r: Row) => [r.user_id, r.display_name]));
    assertEquals((await namesIn(B, LMID))[A], 'alice_a');

    let scrub: Row;
    await t.step('scrub: open the ledger and scrub A', async () => {
      const open = await svcRpc('account_deletion_open', [A, false]);
      assertEquals(open, { status: 'open', stage: 'requested', apple_revoke: 'none' });
      scrub = await svcRpc('scrub_deleted_manager', [A]);
      assertEquals(scrub.status, 'scrubbed');
      assertEquals(scrub.stage, 'scrubbed');
      assertEquals((await one(`select stage from account_deletions where user_id = $1`, [A])).stage, 'scrubbed');
    });

    await t.step('scrub: succession to the earliest-joined other current human, in every window', async () => {
      const succ = Object.fromEntries(scrub.successions.map((s: Row) => [s.league_id, s.new_commissioner]));
      for (const x of scrub.successions) assertEquals([x.recipient, typeof x.notice_id, typeof x.league_name],
        [x.new_commissioner, 'string', 'string'], 'what W3 needs to push, without a read');
      assertEquals(succ, { [LPC]: D, [LMID]: B, [LNEW]: C });
      for (const [l, who] of [[LPC, D], [LMID, B], [LNEW, C]]) {
        assertEquals((await one(`select commissioner_id from leagues where id = $1`, [l])).commissioner_id, who);
        const roles = await q(`select user_id, role from league_members where league_id = $1 and role = 'commissioner'`, [l]);
        assertEquals(roles.map((r: Row) => r.user_id), [who], `${l}: exactly one commissioner role, kept in step`);
        assertEquals((await one(`select count(*)::int n from league_notifications where league_id = $1 and user_id = $2
          and kind = 'commissioner_transferred'`, [l, who])).n, 1);
      }
      assertEquals(scrub.leagues_deleted, [LEMPTY]);
      assertEquals((await one(`select count(*)::int n from leagues where id = $1`, [LEMPTY])).n, 0, 'the empty league is gone');
      assertEquals(scrub.leagues_kept, [LOLD], 'a renewed league is kept as history (ON DELETE RESTRICT); '
        + 'its hidden leaver and its deleted seat never inherit the title');
      assertEquals((await one(`select commissioner_id from leagues where id = $1`, [LOLD])).commissioner_id, A);
    });

    await t.step('scrub: before the draft = leave (row gone, reconfirm with the LABEL, member_left)', async () => {
      const left = Object.fromEntries(scrub.left.map((x: Row) => [x.league_id, x.notify_user_id]));
      assertEquals(left, { [LPRE]: B, [LPC]: D, [LNEW]: C });
      for (const l of [LPRE, LPC, LNEW]) {
        assertEquals((await one(`select count(*)::int n from league_members where league_id = $1 and user_id = $2`, [l, A])).n, 0);
      }
      const rc = (await one(`select departed from league_roster_reconfirm where league_id = $1`, [LPRE])).departed;
      assertEquals(rc.map((e: Row) => [e.user_id, e.name]), [[A, LABEL]], 'no name snapshot: the label');
      const rc2 = (await one(`select departed from league_roster_reconfirm where league_id = $1`, [LPRE2])).departed;
      assertEquals(rc2.map((e: Row) => [e.user_id, e.name]), [[A, LABEL]], 'an EARLIER leave snapshot is scrubbed too');
      assertEquals((await one(`select count(*)::int n from league_notifications where league_id = $1 and user_id = $2
        and kind = 'member_left'`, [LPRE, B])).n, 1);
      // LNEW: A was a renewal invitee ('in'): no reconfirm (leave_league's rule), and the sync trigger ran.
      assertEquals((await one(`select count(*)::int n from league_roster_reconfirm where league_id = $1`, [LNEW])).n, 0);
    });

    await t.step('scrub: every other seat stays, marked deleted, frozen_* NULL (hidden too)', async () => {
      assertEquals([...scrub.seats_marked].sort(), [LMID, LDRAFT, LAFTER, LOLD, LRS].sort());
      for (const l of [LMID, LDRAFT, LAFTER, LOLD, LRS]) {
        const m = await one(`select deleted_at, frozen_username, frozen_avatar, frozen_at from league_members
          where league_id = $1 and user_id = $2`, [l, A]);
        assert(m.deleted_at, `${l}: deleted_at set`);
        assertEquals([m.frozen_username, m.frozen_avatar, m.frozen_at], [null, null, null], `${l}: nothing frozen`);
      }
      assert((await one(`select hidden_at from league_members where league_id = $1 and user_id = $2`, [LAFTER, A])).hidden_at,
        'the hide is kept; only the name went');
      assertEquals((await one(`select count(*)::int n from league_draft_order where league_id = $1 and user_id = $2`, [LDRAFT, A])).n, 1,
        'a live draft keeps the seat in the order (it auto-picks)');
    });

    await t.step('scrub: private rows gone, history kept', async () => {
      const n = async (sql: string, p: unknown[]) => (await one(sql, p)).n;
      assertEquals(await n(`select count(*)::int n from user_profiles where id = $1`, [A]), 0);
      assertEquals(await n(`select count(*)::int n from push_tokens where user_id = $1`, [A]), 0);
      assertEquals(await n(`select count(*)::int n from draft_queue where user_id = $1`, [A]), 0);
      assertEquals(await n(`select count(*)::int n from league_notifications where user_id = $1`, [A]), 0);
      assertEquals((await q(`select league_id, status from league_renewal_responses where user_id = $1`, [A])),
        [{ league_id: LRS, status: 'in' }], 'replies go where the seat went; a kept seat keeps its in (in <=> member)');
      assertEquals(await n(`select count(*)::int n from league_renewal_responses where league_id = $1 and user_id = $2`, [LNEW, B]), 1,
        'other invitees untouched');
      assertEquals((await q(`select code from league_invites where inviter_id = $1 order by code`, [A])).map((r: Row) => r.code),
        ['ACCPA1'], 'pending invites they sent are gone; accepted history stays');
      const det = (await one(`select detail from league_notifications where league_id = $1 and user_id = $2`, [LNEW, B])).detail;
      assertEquals(det, { commissioner_name: LABEL, league_name: 'New' }, 'their name in others\' notifications');
      assertEquals(await n(`select count(*)::int n from trades where user_id = $1`, [A]), 3, 'trades stay');
      assertEquals(await n(`select count(*)::int n from watchlist where user_id = $1`, [A]), 0);
      assertEquals((await q(`select user_id, status from claims order by user_id, status`)).map((r: Row) => `${r.user_id === A ? 'A' : 'B'}:${r.status}`),
        ['A:won', 'B:pending'], 'their PENDING claims go; a resolved claim is history');
      assertEquals(await n(`select count(*)::int n from matchups where team1_user_id = $1 or team2_user_id = $1`, [A]), 3);
      assertEquals((await one(`select champion_user_id from league_seasons where league_id = $1`, [LAFTER])).champion_user_id, A);
    });

    await t.step('seam: a deleted seat reads the label EVERYWHERE, never alice_a nor Player XXXX', async () => {
      // Without the deleted branch, a profile-less id would read the fallback:
      assertEquals(await rpc('participant_display_name', [A]), A_FALLBACK);
      assertEquals((await namesIn(B, LMID))[A], LABEL);
      assertEquals((await namesIn(B, LAFTER))[A], LABEL, 'hidden + deleted: the label, not the frozen name');
      assertEquals((await namesIn(C, LDRAFT))[A], LABEL);
      const reads: [string, string, unknown[]][] = [
        [B, `select to_jsonb(x) j from public.get_home_summary() x`, []],
        [B, `select public.get_home_league($1) j`, [LMID]],
        [B, `select to_jsonb(x) j from public.get_season_matchups($1) x`, [LMID]],
        [B, `select to_jsonb(x) j from public.get_league_history($1) x`, [LAFTER]],
        [B, `select to_jsonb(x) j from public.get_season_result($1) x`, [LAFTER]],
        [C, `select public.get_renewal_roster($1) j`, [LR2]],
        [B, `select to_jsonb(x) j from public.get_visible_profiles($1) x`, [[A, B]]],
      ];
      for (const [viewer, sql, args] of reads) {
        const out = JSON.stringify(await as('authenticated', viewer, () => q(sql, args)));
        assert(!out.includes('alice_a'), `${sql}: leaks the old name`);
        assert(!out.includes(A_FALLBACK), `${sql}: shows the Player XXXX fallback`);
        assert(!out.includes('avatar-of-alice_a'), `${sql}: leaks the avatar`);
      }
      const matchups = JSON.stringify(await as('authenticated', B, () => q(`select to_jsonb(x) j from public.get_season_matchups($1) x`, [LMID])));
      assert(matchups.includes(LABEL), 'the matchups name the seat with the label');
      const hist = JSON.stringify(await as('authenticated', B, () => q(`select to_jsonb(x) j from public.get_league_history($1) x`, [LAFTER])));
      assert(hist.includes(LABEL), 'the champion reads the label');
      const vis = await as('authenticated', B, () => q(`select id, username, avatar from public.get_visible_profiles($1) order by username`, [[A, B]]));
      assertEquals(vis, [{ id: A, username: LABEL, avatar: null }, { id: B, username: 'bob_b', avatar: 'avatar-of-bob_b' }]);
      // Visibility is unchanged: a stranger to A's leagues still sees nothing.
      assertEquals(await as('authenticated', E, () => q(`select id from public.get_visible_profiles($1)`, [[A]])), []);
    });

    await t.step('guards: a deleted seat is never a commissioner target, an invitee, or born on insert', async () => {
      assertEquals((await svcRpc('transfer_commissioner', [LAFTER, C, A])).reason, 'target_invalid');
      // Run it back from LMID's league after its season: the deleted seat is not invited.
      const LM2 = lg(20);
      await league(LM2, 'Done', B); await members(LM2, [[B, 0], [A, 1], [C, 2], [D, 3]], B);
      await start(LM2); await finish(LM2);
      // A was deleted mid-season (a pre-draft deletion removes the seat instead).
      // Marked by hand here, so also drop what the scrub would have (the draft's
      // draft_order_set notice to A); the idempotency step below re-runs the real scrub.
      await q(`update league_members set deleted_at = now() where league_id = $1 and user_id = $2`, [LM2, A]);
      await q(`delete from league_notifications where league_id = $1 and user_id = $2`, [LM2, A]);
      await q(`update leagues set season_status = 'completed' where id = $1`, [LM2]);
      await q(`insert into league_seasons (league_id, season_number, completed_at) values ($1, 1, now())`, [LM2]);
      await q(`update leagues set current_season_id = (select id from league_seasons where league_id = $1) where id = $1`, [LM2]);
      const ren = await as('authenticated', B, () => rpc('renew_league', [LM2]));
      assertEquals(ren.status, 'renewed');
      assertEquals(ren.invited, 2, 'C and D only');
      assertEquals((await q(`select user_id from league_renewal_responses where league_id = $1 and status = 'pending' order by 1`,
        [ren.league_id])).map((r: Row) => r.user_id), [C, D]);
      // After the season, the title can't go to a deleted seat that is NOT hidden either.
      assertEquals((await svcRpc('transfer_commissioner', [LM2, B, A])).reason, 'target_invalid');
      assertEquals((await svcRpc('transfer_commissioner', [LM2, B, C])).status, 'transferred', 'a live member still can');
      // The shared leave's own preconditions (a backstop behind its callers) raise on a breach.
      await assertRejects(() => q(`select public._leave_league_before_draft($1, $2, 'x')`, [LMID, C]), Error, 'precondition failed');
      await assertRejects(() => q(`select public._leave_league_before_draft($1, $2, 'x')`, [LPRE, B]), Error, 'precondition failed');
      // A commissioner cannot insert their own seat born deleted.
      const LX = lg(21);
      await league(LX, 'X', E);
      await assertRejects(() => as('authenticated', E, () => q(`insert into league_members (league_id, user_id, role, deleted_at)
        values ($1, $2, 'commissioner', now())`, [LX, E])), Error, 'row-level security');
      await as('authenticated', E, () => q(`insert into league_members (league_id, user_id, role) values ($1, $2, 'commissioner')`, [LX, E]));
    });

    await t.step('idempotent: a re-run changes nothing and writes no notice', async () => {
      const snap = async () => JSON.stringify(await q(`select
        (select jsonb_agg(jsonb_build_array(league_id, user_id, kind, subject_user_id, detail) order by created_at, id)
           from league_notifications) n, (select count(*) from leagues) l,
        (select jsonb_agg(m order by league_id, user_id) from (select league_id, user_id, role, deleted_at, frozen_username
           from league_members) m) mem,
        (select jsonb_agg(r order by league_id) from league_roster_reconfirm r) rc`));
      const before = await snap();
      const again = await svcRpc('scrub_deleted_manager', [A]);
      assertEquals([again.successions, again.left, again.seats_marked, again.leagues_deleted],
        [[], [], [], []]);
      assertEquals(again.leagues_kept, [LOLD]);
      assertEquals(await snap(), before);
    });

    // ---- takeover ------------------------------------------------------------------------
    let code = '';
    await t.step('takeover: the commissioner makes ONE code per deleted seat, in the window only', async () => {
      const r = await as('authenticated', B, () => rpc('create_takeover_invite', [LMID, A]));
      assertEquals([r.status, r.created], ['ok', true]);
      code = r.code;
      assertMatch(code, /^[A-Z0-9]{10}$/, 'the invite-code shape the client validates');
      assertMatch(code, /^[A-HJ-NP-Z2-9]{10}$/, 'from the app\'s 32-symbol alphabet');
      assertEquals((await as('authenticated', B, () => rpc('create_takeover_invite', [LMID, A]))).code, code, 'the same code again');
      const ttl = await one(`select extract(epoch from (expires_at - now()))::int s from league_invites where code = $1`, [code]);
      assert(Math.abs(ttl.s - 14 * 86400) < 120, 'valid 14 days');
      // A pending code past its expiry is retired and replaced.
      await q(`update league_invites set expires_at = now() - interval '1 second' where code = $1`, [code]);
      const fresh = await as('authenticated', B, () => rpc('create_takeover_invite', [LMID, A]));
      assertEquals(fresh.created, true);
      assertNotEquals(fresh.code, code);
      assertEquals((await one(`select status from league_invites where code = $1`, [code])).status, 'expired');
      code = fresh.code;
      assertEquals((await as('authenticated', C, () => rpc('create_takeover_invite', [LMID, A]))).reason, 'not_commissioner');
      assertEquals((await as('authenticated', B, () => rpc('create_takeover_invite', [LMID, D]))).reason, 'not_deleted');
      assertEquals((await as('authenticated', C, () => rpc('create_takeover_invite', [LAFTER, A]))).reason, 'window');
      assertEquals((await as('authenticated', B, () => rpc('create_takeover_invite', [LDRAFT, A]))).reason, 'window',
        'not during a live draft');
      // Clients cannot write a takeover row themselves.
      await assertRejects(() => as('authenticated', B, () => q(`insert into league_invites
        (league_id, inviter_id, invited_identifier, code, kind, seat_user_id) values ($1, $2, 'x', 'FORGED1', 'takeover', $3)`,
        [LMID, B, D])), Error, 'row-level security');
      await assertRejects(() => q(`insert into league_invites (league_id, inviter_id, invited_identifier, code, kind)
        values ($1, $2, 'x', 'BADSEAT1', 'takeover')`, [LMID, B]), Error, 'league_invites_takeover_seat');
    });

    const countsOf = async (u: string, l: string) => (await one(`select
      (select count(*)::int from league_members where league_id = $1 and user_id = $2) mem,
      (select count(*)::int from league_draft_order where league_id = $1 and user_id = $2) ord,
      (select count(*)::int from matchups where league_id = $1 and (team1_user_id = $2 or team2_user_id = $2)) mat,
      (select count(*)::int from matchups where league_id = $1 and winner_user_id = $2) win,
      (select count(*)::int from league_standings where league_id = $1 and user_id = $2) st,
      (select count(*)::int from week_snapshots where league_id = $1 and user_id = $2) ws,
      (select count(*)::int from drafts where league_id = $1 and user_id = $2) dr,
      (select count(*)::int from trades where league_id = $1 and user_id::text = $2) tr`, [l, u]));

    await t.step('takeover: refusals write nothing, and the preview agrees with the takeover on every one', async () => {
      // Fixture codes: a live seat; a code issued in LPRE naming A's id (A holds no seat THERE,
      // so it cannot reach LMID's seat); an expired code.
      await q(`insert into league_invites (league_id, inviter_id, invited_identifier, code, kind, seat_user_id, expires_at)
               values ($1, $2, 'takeover', 'LIVESEAT22', 'takeover', $3, now() + interval '1 day'),
                      ($4, $2, 'takeover', 'OTHERLG222', 'takeover', $5, now() + interval '1 day'),
                      ($6, $2, 'takeover', 'EXPIRED222', 'takeover', $5, now() - interval '1 minute')`,
        [LMID, B, D, LPRE, A, LDRAFT]);
      const before = await countsOf(A, LMID);
      const writes = async () => JSON.stringify(await q(`select (select count(*) from league_notifications) n,
        (select jsonb_agg(jsonb_build_array(code, status) order by code) from league_invites) inv`));
      const w0 = await writes();
      const both = async (c: string, u: string, reason: string, why: string) => {
        const pv = await svcRpc('takeover_preview', [c, u]);
        assertEquals(pv, { ok: false, reason }, `preview: ${why}`);
        const tk = await svcRpc('take_over_team', [c, u]);
        assertEquals(tk, { status: 'refused', reason }, `takeover: ${why}`);
      };
      await both('NOPE234567', E, 'invalid_code', 'an unknown code');
      await both(code.toLowerCase(), E, 'invalid_code', 'codes match exactly (the client upper-cases)');
      await both(` ${code}`, E, 'invalid_code', 'codes match exactly (the client trims)');
      await both(code, C, 'already_member', 'a member of the league');
      await both(code, A, 'not_eligible', 'a deleted account cannot take a seat');
      await both(code, '99999999-0000-4000-8000-000000000099', 'not_eligible', 'no forged ids');
      await both('LIVESEAT22', F, 'not_deleted', 'a live manager\'s seat is never taken');
      await both('OTHERLG222', F, 'taken', 'a code from one league cannot take a seat in another');
      await both('EXPIRED222', F, 'invalid_code', 'an expired code');
      assertEquals(await countsOf(A, LMID), before);
      assertEquals(await writes(), w0, 'refusals and previews write nothing');
      // The preview of a takeable seat: its record and rank, nothing else.
      const pv = await svcRpc('takeover_preview', [code, E]);
      assertEquals(Object.keys(pv).sort(), ['league_name', 'losses', 'ok', 'rank', 'wins']);
      assertEquals([pv.ok, pv.league_name, Number(pv.wins), Number(pv.losses)], [true, 'Mid', 1, 1]);
      const ranked = await one(`select rank from public.league_standings_ranked($1) where user_id = $2`, [LMID, A]);
      assertEquals(pv.rank, ranked.rank);
      assert(pv.rank > 1, 'A (1-1) is not first: the rank is read, not assumed');
    });

    await t.step('takeover: gone (the league vanished under a live code; the FK normally cascades it away)', async () => {
      const LG = lg(30);
      await league(LG, 'Gone', B);
      await q(`insert into league_invites (league_id, inviter_id, invited_identifier, code, kind, seat_user_id, expires_at)
               values ($1, $2, 'takeover', 'GONECODE22', 'takeover', $3, now() + interval '1 day')`, [LG, B, A]);
      // replica mode skips the ON DELETE CASCADE (an RI trigger on leagues), leaving the code orphaned.
      await q(`set session_replication_role = replica`);
      await q(`delete from leagues where id = $1`, [LG]);
      await q(`set session_replication_role = origin`);
      assertEquals(await svcRpc('takeover_preview', ['GONECODE22', F]), { ok: false, reason: 'gone' });
      assertEquals(await svcRpc('take_over_team', ['GONECODE22', F]), { status: 'refused', reason: 'gone' });
      await q(`delete from league_invites where code = 'GONECODE22'`);
    });

    await t.step('takeover codes and join codes never cross, in either direction', async () => {
      // A takeover code is not a join code, and not an invite-preview code.
      const j = await svc(() => q(`select public.join_league_by_code($1, $2) r`, [code, F]));
      assertEquals(j[0].r.reason, 'invalid_code', 'join_league_by_code treats a takeover code as unknown');
      await q(`insert into vault.secrets (name, secret) values ('invite_preview_ip_salt', 'fixture-salt-0123456789abcdef')`);
      const pvTake = await svc(() => rpc('invite_preview_lookup', [code, '203.0.113.7']));
      assertEquals(pvTake.status, 'not_found', 'the no-session preview names no league for a takeover code');
      const pvInvite = await svc(() => rpc('invite_preview_lookup', ['ACCPA1', '203.0.113.7']));
      assertEquals(pvInvite.status, 'not_found', 'an accepted invite is a miss there too (unchanged behaviour)');
      await q(`insert into league_invites (league_id, inviter_id, invited_identifier, code) values ($1, $2, 'x@example.com', 'PLAINVITE2')`, [LDRAFT, B]);
      assertEquals((await svc(() => rpc('invite_preview_lookup', ['PLAINVITE2', '203.0.113.7']))).status, 'found',
        'an ordinary pending invite still previews');
      // And a join code is not a takeover code: an ordinary invite, a league's own invite_code.
      const lcode = (await one(`select invite_code from leagues where id = $1`, [LMID])).invite_code;
      for (const c of ['PLAINVITE2', lcode]) {
        assertEquals(await svcRpc('takeover_preview', [c, F]), { ok: false, reason: 'invalid_code' });
        assertEquals(await svcRpc('take_over_team', [c, F]), { status: 'refused', reason: 'invalid_code' });
      }
      await q(`delete from takeover_guess_limits`);   // the misses above are not this suite's budget
    });

    await t.step('limiter: a per-user lockout after 10 misses, a global ceiling, a contended lock; all fail closed', async () => {
      const misses = async (u: string) => (await one(`select coalesce(sum(hits), 0)::int n from takeover_guess_limits
        where subject = 'miss-user:' || $1`, [u])).n;
      for (let i = 0; i < 5; i++) {
        await svcRpc('takeover_preview', ['WRONGCODE' + i, F]);
        await svcRpc('take_over_team', ['WRONGCODE' + i, F]);
      }
      assertEquals(await misses(F), 10);
      assertEquals(await svcRpc('takeover_preview', [code, F]), { ok: false, reason: 'rate_limited' },
        'locked out: even a valid code is refused');
      assertEquals(await misses(F), 10, 'a refused caller spends nothing more');
      assertEquals((await svcRpc('takeover_preview', [code, E])).ok, true, 'another user is not locked out');
      // Global ceiling.
      await q(`insert into takeover_guess_limits (subject, window_start, hits) values ('miss-all', date_trunc('hour', now()), 300)
               on conflict (subject, window_start) do update set hits = 300`);
      assertEquals(await svcRpc('takeover_preview', [code, E]), { ok: false, reason: 'rate_limited' });
      await q(`delete from takeover_guess_limits`);
      // A contended lock refuses, never queues (PGlite has one session: stub the try-lock).
      const lockFn = slice(await readMigration('20261125000006_take_over_team.sql'),
        'create or replace function public.takeover_guess_try_lock()', '\n$$;');
      await q(`create or replace function public.takeover_guess_try_lock() returns boolean language sql as $$ select false $$`);
      assertEquals(await svcRpc('take_over_team', [code, E]), { status: 'refused', reason: 'rate_limited' });
      await db.exec(lockFn);
      await q(`revoke all on function public.takeover_guess_try_lock() from public, anon, authenticated, service_role`);
      // Old windows are pruned on every call.
      await q(`insert into takeover_guess_limits (subject, window_start, hits) values ('miss-all', now() - interval '3 hours', 5)`);
      await svcRpc('takeover_preview', [code, E]);
      assertEquals((await one(`select count(*)::int n from takeover_guess_limits where window_start < now() - interval '2 hours'`)).n, 0);
      await q(`delete from takeover_guess_limits`);
    });

    await t.step('takeover: every row of the seat moves; the record is kept; a second taker gets taken', async () => {
      const before = await countsOf(A, LMID);
      const joined = (await one(`select joined_at from league_members where league_id = $1 and user_id = $2`, [LMID, A])).joined_at;
      const pos = (await one(`select position from league_draft_order where league_id = $1 and user_id = $2`, [LMID, A])).position;
      const res = await svcRpc('take_over_team', [code, E]);
      assertEquals(res.status, 'taken_over');
      assertEquals([res.notify_user_id, res.new_name, res.seat_label, res.league_name], [B, 'eve_e', LABEL, 'Mid']);
      assertEquals(await countsOf(E, LMID), before, 'E holds exactly what A held');
      assertEquals(await countsOf(A, LMID), { mem: 0, ord: 0, mat: 0, win: 0, st: 0, ws: 0, dr: 0, tr: 0 });
      const m = await one(`select role, deleted_at, joined_at, frozen_username from league_members where league_id = $1 and user_id = $2`, [LMID, E]);
      assertEquals([m.role, m.deleted_at, m.frozen_username], ['member', null, null]);
      assertEquals(String(m.joined_at), String(joined), 'joined_at kept (the standings tiebreak)');
      assertEquals((await one(`select position from league_draft_order where league_id = $1 and user_id = $2`, [LMID, E])).position, pos);
      assertEquals((await one(`select status from league_invites where code = $1`, [code])).status, 'accepted');
      assertEquals((await one(`select count(*)::int n from league_notifications where league_id = $1 and user_id = $2
        and kind = 'seat_taken_over' and subject_user_id = $3`, [LMID, B, E])).n, 1);
      assertEquals((await namesIn(B, LMID))[E], 'eve_e', 'past weeks now read the new manager');
      assertEquals((await one(`select user_id from waiver_order where league_id = $1 and position = 1`, [LMID])).user_id, E,
        'the waiver position comes with the seat');
      assertEquals((await one(`select count(*)::int n from claims where user_id = $1 and status = 'won'`, [E])).n, 1);
      assertEquals((await svcRpc('take_over_team', [code, F])).reason, 'taken');
      assertEquals(await svcRpc('takeover_preview', [code, F]), { ok: false, reason: 'taken' }, 'the preview agrees');
      assertEquals((await one(`select count(*)::int n from takeover_guess_limits where subject = 'miss-user:' || $1`, [F])).n, 0,
        'a used code is not a miss');
      // A's seats in OTHER leagues are untouched.
      assert((await one(`select deleted_at from league_members where league_id = $1 and user_id = $2`, [LDRAFT, A])).deleted_at);
    });

    await t.step('takeover: a set or locked draft order still refuses every OTHER change', async () => {
      await assertRejects(() => q(`update league_draft_order set user_id = $1 where league_id = $2 and user_id = $3`, [F, LMID, B]),
        Error, 'draft_order');
      await assertRejects(() => as('authenticated', B, () => q(`update league_draft_order set user_id = $1 where league_id = $2 and user_id = $3`, [F, LDRAFT, A])),
        Error, 'permission denied');
    });

    await t.step('takeover: a seat in the season window via a stray code still refuses after the season', async () => {
      await q(`insert into league_invites (league_id, inviter_id, invited_identifier, code, kind, seat_user_id, expires_at)
               values ($1, $2, 'takeover', 'LATECODE22', 'takeover', $3, now() + interval '1 day')`, [LAFTER, C, A]);
      assertEquals((await svcRpc('take_over_team', ['LATECODE22', F])).reason, 'window');
      assertEquals(await svcRpc('takeover_preview', ['LATECODE22', F]), { ok: false, reason: 'window' });
    });

    // ---- the final stage ------------------------------------------------------------------
    await t.step('ledger: done only after the auth user is really gone; trades survive it', async () => {
      assertEquals(await svcRpc('account_deletion_mark_done', [A]), { status: 'refused', reason: 'auth_user_exists', stage: 'scrubbed' });
      const tr = (await one(`select count(*)::int n from trades where user_id = $1`, [A])).n;
      await q(`delete from auth.users where id = $1`, [A]);
      assertEquals((await one(`select count(*)::int n from trades where user_id = $1`, [A])).n, tr, 'no cascade');
      assertEquals(await svcRpc('account_deletion_mark_done', [A]), { status: 'ok', stage: 'done' });
      assertEquals(await svcRpc('account_deletion_mark_done', [A]), { status: 'ok', stage: 'done' });
      assertEquals((await svcRpc('account_deletion_cancel', [A])).cancelled, false, 'never cancelled once scrubbed');
      assertEquals((await namesIn(B, LAFTER))[A], LABEL, 'still the label with the auth row gone');
    });

    await t.step('ledger: apple revoke state is forward-only; the token lives in vault until revoked', async () => {
      assertEquals(await svcRpc('account_deletion_open', [G, true]), { status: 'open', stage: 'requested', apple_revoke: 'required' });
      assertEquals((await svcRpc('account_deletion_open', [G, false])).apple_revoke, 'required', 'a re-open never changes it');
      assertEquals((await svcRpc('account_deletion_stash_apple_token', [G, 'r.secret-refresh'])).apple_revoke, 'pending');
      assertEquals((await svcRpc('account_deletion_apple_token', [G])).token, 'r.secret-refresh');
      assertEquals((await svcRpc('account_deletion_set_apple', [G, 'none'])).reason, 'backward');
      assertEquals((await svcRpc('account_deletion_apple_revoked', [G])).apple_revoke, 'done');
      assertEquals((await one(`select count(*)::int n from vault.secrets where name like 'apple_revoke:%'`)).n, 0);
      assertEquals((await svcRpc('account_deletion_apple_token', [G])).token, null);
      assertEquals((await svcRpc('account_deletion_stash_apple_token', [G, 'again'])).reason, 'backward');
      assertEquals((await svcRpc('account_deletion_set_apple', [G, 'pending'])).reason, 'backward');
      assertEquals((await svcRpc('account_deletion_apple_unrevoked', [G])).reason, 'backward', 'done never becomes unrevoked');
      const err = await svcRpc('account_deletion_fail', [G, 'x'.repeat(5000)]);
      assertEquals(err.recorded, true);
      assertEquals((await one(`select length(last_error) n from account_deletions where user_id = $1`, [G])).n, 1000);
      // cancel works ONLY at 'requested' (the bad-proof path), and clears any stashed token.
      await svcRpc('account_deletion_open', [H, true]);
      await svcRpc('account_deletion_stash_apple_token', [H, 'h-token']);
      assertEquals((await svcRpc('account_deletion_cancel', [H])).cancelled, true);
      assertEquals((await one(`select count(*)::int n from vault.secrets where name = $1`, [`apple_revoke:${H}`])).n, 0);
      assertEquals((await one(`select count(*)::int n from account_deletions where user_id = $1`, [H])).n, 0);
      assertEquals(await svcRpc('account_deletion_mark_done', [G]), { status: 'refused', reason: 'not_scrubbed', stage: 'requested' },
        'never skip the scrub; a refusal reports the current stage');
    });

    await t.step('scrub verifies its EFFECT: a delete that silently does nothing rolls everything back', async () => {
      await q(`insert into push_tokens (user_id, token) values ($1, 'ExponentPushToken[i]')`, [I]);
      await q(`create function pg_temp.keep() returns trigger language plpgsql as $$ begin return null; end $$`);
      await q(`create trigger zz_keep before delete on public.push_tokens for each row execute function pg_temp.keep()`);
      await svcRpc('account_deletion_open', [I, false]);
      await assertRejects(() => svcRpc('scrub_deleted_manager', [I]), Error, 'effect check failed');
      assertEquals((await one(`select count(*)::int n from user_profiles where id = $1`, [I])).n, 1, 'the profile delete rolled back too');
      await q(`drop trigger zz_keep on public.push_tokens`);
      assertEquals((await svcRpc('scrub_deleted_manager', [I])).stage, 'scrubbed');
      await q(`delete from auth.users where id = $1`, [I]);
      assertEquals((await svcRpc('account_deletion_mark_done', [I])).stage, 'done');
    });

    await t.step('heal: an interrupted request at each stage reaches done; one failure blocks nobody', async () => {
      // G: opened, never scrubbed (the request died). H: opened, and its scrub FAILS.
      await svcRpc('account_deletion_open', [H, false]);
      await q(`update account_deletions set updated_at = now() - interval '1 hour' where user_id in ($1, $2)`, [G, H]);
      await q(`create function pg_temp.boom() returns trigger language plpgsql as $$
               begin if old.id = '${H}' then raise exception 'injected failure'; end if; return old; end $$`);
      await q(`create trigger zz_boom before delete on public.user_profiles for each row execute function pg_temp.boom()`);
      // A fresh request (in flight) is left alone.
      await svcRpc('account_deletion_open', [F, false]);
      const h1 = await svcRpc('heal_account_deletions', []);
      assertEquals(h1.scrubbed, [G]);
      assertEquals(h1.scrub_results.map((x: Row) => [x.status, x.stage]), [['scrubbed', 'scrubbed']],
        'each heal-run scrub body, for the handler\'s pushes');
      assertEquals(h1.scrub_errors.map((e: Row) => e.user_id), [H]);
      assertMatch(h1.scrub_errors[0].error, /injected failure/);
      assertEquals(h1.auth_delete, [G], 'the scrubbed one is owed an auth delete; A is already done');
      assertEquals(h1.apple_pending, []);
      const hRow = await one(`select stage, last_error from account_deletions where user_id = $1`, [H]);
      assertEquals(hRow.stage, 'requested');
      assertMatch(hRow.last_error, /^heal scrub: injected failure/);
      assertEquals((await one(`select count(*)::int n from user_profiles where id = $1`, [H])).n, 1, 'H rolled back whole');
      assertEquals((await one(`select stage from account_deletions where user_id = $1`, [F])).stage, 'requested', 'F not healed yet');

      // The fault clears: the next pass finishes H; the edge function's auth delete + mark_done finish both.
      await q(`drop trigger zz_boom on public.user_profiles`);
      await q(`update account_deletions set updated_at = now() - interval '1 hour' where user_id = $1`, [H]);
      const h2 = await svcRpc('heal_account_deletions', []);
      assertEquals(h2.scrubbed, [H]);
      assertEquals([...h2.auth_delete].sort(), [G, H].sort());
      for (const u of [G, H]) {
        await q(`delete from auth.users where id = $1`, [u]);
        assertEquals((await svcRpc('account_deletion_mark_done', [u])).stage, 'done');
      }
      // Nothing done is owed again; F (in flight until now) is healed once its age passes.
      const h3 = await svcRpc('heal_account_deletions', ['0 seconds']);
      assertEquals([h3.scrubbed, h3.auth_delete], [[F], [F]]);
    });

    await t.step('heal: apple pending is listed until revoked; done rows purge after 7 days', async () => {
      await svcRpc('account_deletion_stash_apple_token', [F, 'f-token']);
      const h = await svcRpc('heal_account_deletions', []);
      assertEquals(h.apple_pending, [F]);
      await q(`update account_deletions set updated_at = now() - interval '8 days' where stage = 'done'`);
      const p = await svcRpc('heal_account_deletions', []);
      assertEquals(p.purged, 4, 'A, G, H, I');
      assertEquals((await q(`select user_id from account_deletions order by 1`)).map((r: Row) => r.user_id), [F]);
      await assertRejects(() => svcRpc('heal_account_deletions', ['-1 minute']), Error, 'invalid_arguments');
    });

    await db.close();
  },
});

// ---------------------------------------------------------------------------
// The ledger state machines, the heal's Apple expiry, and heal_account_deletions_due,
// on a fresh full chain (no league fixtures: only ledger rows and auth users).
// ---------------------------------------------------------------------------
Deno.test({
  name: 'account deletion: ledger states, updated_at bumps, Apple expiry, heal_account_deletions_due',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const db = new PGlite();
    await loadChain(db);
    const q = async (s: string, p: unknown[] = []) => (await db.query<Row>(s, p)).rows;
    const one = async (s: string, p: unknown[] = []) => (await q(s, p))[0];
    const svc = async (fn: string, args: unknown[]) => {
      await db.exec('set role service_role');
      try {
        return (await one(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')}) r`, args)).r;
      } finally { await db.exec('reset role'); }
    };
    const U = (n: number) => `0b0b0b0b-0000-4000-8000-${String(n).padStart(12, '0')}`;
    for (let n = 1; n <= 9; n++) await q(`insert into auth.users (id) values ($1)`, [U(n)]);
    const row = (u: string) => one(`select stage, apple_revoke, updated_at, requested_at, last_error from account_deletions where user_id = $1`, [u]);
    const age = (u: string, col: string, iv: string) => q(`update account_deletions set ${col} = now() - interval '${iv}' where user_id = $1`, [u]);
    const due = async () => (await svc('heal_account_deletions_due', [])) as boolean;

    await t.step('every ledger write bumps updated_at', async () => {
      const u = U(1);
      const writes: [string, unknown[]][] = [
        ['account_deletion_open', [u, true]],          // insert
        ['account_deletion_open', [u, true]],          // re-open
        ['account_deletion_set_apple', [u, 'pending']],
        ['account_deletion_stash_apple_token', [u, 'tok-1']],
        ['account_deletion_fail', [u, 'boom']],
        ['account_deletion_apple_revoked', [u]],
        ['scrub_deleted_manager', [u]],
      ];
      for (const [fn, args] of writes) {
        if (fn !== 'account_deletion_open' || (await q(`select 1 from account_deletions where user_id = $1`, [u])).length) {
          await age(u, 'updated_at', '1 hour');
        }
        await svc(fn, args);
        const r = await row(u);
        assert(Date.now() - new Date(r.updated_at).getTime() < 60_000, `${fn} must bump updated_at`);
      }
      await q(`delete from auth.users where id = $1`, [u]);
      await age(u, 'updated_at', '1 hour');
      assertEquals((await svc('account_deletion_mark_done', [u])).stage, 'done');
      assert(Date.now() - new Date((await row(u)).updated_at).getTime() < 60_000, 'mark_done must bump updated_at');
      // apple_unrevoked bumps too (on a row that can still settle).
      const v = U(2);
      await svc('account_deletion_open', [v, true]);
      await age(v, 'updated_at', '1 hour');
      assertEquals((await svc('account_deletion_apple_unrevoked', [v])).apple_revoke, 'unrevoked');
      assert(Date.now() - new Date((await row(v)).updated_at).getTime() < 60_000, 'apple_unrevoked must bump updated_at');
    });

    await t.step('apple_revoke: forward only by rank, terminal states final, every settlement drops the vault entry', async () => {
      const u = U(3);
      assertEquals((await svc('account_deletion_open', [u, false])).apple_revoke, 'none');
      assertEquals((await svc('account_deletion_set_apple', [u, 'required'])).apple_revoke, 'required');
      assertEquals((await svc('account_deletion_set_apple', [u, 'none'])).reason, 'backward');
      assertEquals((await svc('account_deletion_stash_apple_token', [u, 'tok-3'])).apple_revoke, 'pending');
      assertEquals((await svc('account_deletion_set_apple', [u, 'required'])).reason, 'backward');
      assertEquals((await svc('account_deletion_apple_token', [u])).token, 'tok-3');
      assertEquals((await svc('account_deletion_set_apple', [u, 'unrevoked'])).apple_revoke, 'unrevoked');
      assertEquals((await one(`select count(*)::int n from vault.secrets where name = $1`, [`apple_revoke:${u}`])).n, 0,
        'set_apple settling drops the vault entry too');
      assertEquals((await svc('account_deletion_apple_revoked', [u])).reason, 'backward', 'unrevoked never becomes done');
      assertEquals((await svc('account_deletion_stash_apple_token', [u, 'tok-again'])).reason, 'backward');
      assertEquals((await svc('account_deletion_apple_token', [u])).token, null);
      const n = U(4);
      await svc('account_deletion_open', [n, false]);
      assertEquals((await svc('account_deletion_apple_unrevoked', [n])).reason, 'backward', 'no Apple identity, nothing to settle');
      await assertRejects(() => svc('account_deletion_set_apple', [n, 'bogus']), Error, 'invalid_arguments');
      await assertRejects(() => svc('account_deletion_open', [n, null]), Error, 'invalid_arguments');
      // Clean slate for the heal steps below.
      await q(`delete from account_deletions`);
    });

    await t.step('heal + due: stale required and expired pending settle as unrevoked; fresh ones are left alone', async () => {
      assertEquals(await due(), false, 'an empty ledger: no HTTP call');
      const fresh = U(5), stale = U(6), oldPending = U(7), newPending = U(8);
      for (const u of [fresh, stale, oldPending, newPending]) await svc('account_deletion_open', [u, true]);
      // Scrub them all so only the Apple state is in play here (scrubbed rows are 'due' for their auth delete).
      for (const u of [fresh, stale, oldPending, newPending]) await svc('scrub_deleted_manager', [u]);
      for (const u of [fresh, stale, oldPending, newPending]) { await q(`delete from auth.users where id = $1`, [u]); await svc('account_deletion_mark_done', [u]); }
      await svc('account_deletion_stash_apple_token', [oldPending, 'old-tok']);
      await svc('account_deletion_stash_apple_token', [newPending, 'new-tok']);
      await age(stale, 'updated_at', '20 minutes');
      await age(oldPending, 'requested_at', '8 days');
      await svc('account_deletion_fail', [oldPending, 'apple 503']);   // a recent retry bumps updated_at, not requested_at
      assertEquals(await due(), true);
      const h = await svc('heal_account_deletions', []);
      assertEquals([...h.apple_unrevoked].sort(), [stale, oldPending].sort());
      assertEquals(h.apple_pending, [newPending], 'only revokes still worth retrying');
      assertEquals((await row(fresh)).apple_revoke, 'required', 'a fresh required row belongs to an in-flight request');
      assertEquals((await one(`select count(*)::int n from vault.secrets where name = $1`, [`apple_revoke:${oldPending}`])).n, 0);
      assertEquals((await one(`select count(*)::int n from vault.secrets where name = $1`, [`apple_revoke:${newPending}`])).n, 1);
    });

    await t.step('purge: done rows with nothing owed go after 7 days; a pending or required revoke keeps its row', async () => {
      const [fresh, stale, oldPending, newPending] = [U(5), U(6), U(7), U(8)];
      for (const u of [fresh, stale, oldPending, newPending]) await age(u, 'updated_at', '8 days');
      const h = await svc('heal_account_deletions', ['1 year']);   // a long age: no required row is settled here
      assertEquals(h.purged, 2, 'stale + oldPending (both unrevoked)');
      assertEquals((await q(`select user_id from account_deletions order by user_id`)).map((r: Row) => r.user_id),
        [fresh, newPending].sort());
      // fresh settles first; then newPending is the ONLY reason anything is due (a revoke to retry).
      await svc('account_deletion_apple_unrevoked', [fresh]);
      assertEquals(await due(), true, 'a pending revoke alone makes the heal due');
      await svc('account_deletion_apple_revoked', [newPending]);
      assertEquals(await due(), false, 'settled and recent: nothing to do');
      for (const u of [fresh, newPending]) await age(u, 'updated_at', '8 days');
      assertEquals(await due(), true, 'purgeable');
      assertEquals((await svc('heal_account_deletions', [])).purged, 2);
      assertEquals(await due(), false);
    });

    await t.step('heal: an expired pending revoke the expiry did not reach (p_limit) is still not listed as worth retrying', async () => {
      const [x, y] = [U(10), U(11)];
      for (const u of [x, y]) {
        await q(`insert into auth.users (id) values ($1)`, [u]);
        await svc('account_deletion_open', [u, true]);
        await svc('account_deletion_stash_apple_token', [u, `tok-${u}`]);
        await age(u, 'requested_at', '8 days');
      }
      const h = await svc('heal_account_deletions', ['10 minutes', 1]);
      assertEquals(h.apple_unrevoked.length, 1, 'p_limit bounds the expiry pass');
      assertEquals(h.apple_pending, [], 'the other one is expired too: never offered for retry');
      const h2 = await svc('heal_account_deletions', ['10 minutes', 1]);
      assertEquals(h2.apple_unrevoked.length, 1, 'the next pass takes the next oldest');
      for (const u of [x, y]) { await q(`delete from auth.users where id = $1`, [u]); }
      await q(`delete from account_deletions where user_id in ($1, $2)`, [x, y]);
    });

    await t.step('due agrees with the heal: a stalled requested row and a scrubbed row', async () => {
      const r1 = U(9);
      await svc('account_deletion_open', [r1, false]);
      assertEquals(await due(), false, 'in flight (under 10 minutes)');
      await age(r1, 'updated_at', '11 minutes');
      assertEquals(await due(), true, 'stalled requested');
      const h = await svc('heal_account_deletions', []);
      assertEquals([h.scrubbed, h.auth_delete], [[r1], [r1]]);
      assertEquals(await due(), true, 'scrubbed: its auth delete is owed');
      await q(`delete from auth.users where id = $1`, [r1]);
      await svc('account_deletion_mark_done', [r1]);
      assertEquals(await due(), false);
    });
    await db.close();
  },
});

// ---------------------------------------------------------------------------
// Regression on the full chain: the existing effect tests that drive the
// re-created functions still pass, and this workstream's own effect test passes.
// ---------------------------------------------------------------------------
Deno.test({
  name: 'account deletion: effect tests on the full chain (regression + docs/security/account-deletion-effect-test.sql)',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const run = async (name: string) => {
      const db = new PGlite();
      await loadChain(db);
      const sql = await Deno.readTextFile(new URL(`docs/security/${name}-effect-test.sql`, ROOT));
      let msg = '';
      try { await db.exec(sql); } catch (e) { msg = (e as Error).message; }
      await db.close();
      return msg;
    };
    for (const name of ['leave-league', 'leaver-gaps', 'frozen-leaver-names']) {
      const msg = await run(name);
      assert(msg.length > 0, `${name}: the block must end by raising its results`);
      assertEquals(msg.split('\n').filter((l) => /\bFAIL\b/.test(l)), [], `${name}: no FAIL lines`);
    }
    const mine = await run('account-deletion');
    assertMatch(mine.split('\n')[0], /^ACCOUNT DELETION EFFECT TEST: PASS \(\d+\/\d+ lines PASS\)/, mine);
    assertNotEquals(mine.indexOf('PASS'), -1);
  },
});
