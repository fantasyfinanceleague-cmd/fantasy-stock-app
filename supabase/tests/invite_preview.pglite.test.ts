/**
 * 20261124000000: invite_preview_lookup + invite_preview_limits against REAL Postgres (PGlite). NOT hermetic:
 * the first run fetches npm:@electric-sql/pglite. Run:
 *   deno test --allow-read --allow-env supabase/tests/invite_preview.pglite.test.ts
 *
 * The no-session league preview behind the invite link (Onboarding W3). Vault does not exist in PGlite, so a
 * `vault.decrypted_secrets` TABLE with the same two columns stands in for it (the function reads nothing else).
 * What it proves:
 *   - GRANTS, with Supabase's default per-role grants simulated FIRST (the CLAUDE.md trap: REVOKE FROM PUBLIC
 *     alone leaves anon / authenticated able to call): anon and authenticated cannot execute the function or
 *     touch the table; service_role can execute and cannot touch the table; RLS on with no policies.
 *   - the lookup: a league code and a PENDING unexpired league_invites code are found; an expired, accepted,
 *     unknown or malformed one is a MISS, and every miss returns the same {status:'not_found'};
 *   - the disclosure: a hit carries the raw facts the edge function needs and nothing like an id, a code or an email;
 *     the inviter is the commissioner's username only (null for a blank name, a bot, a non-uuid id);
 *   - the limits: 10 misses/hour/IP, 300 misses/hour globally, 30 requests/minute/IP; once over, even a valid
 *     code is refused and the refusal spends nothing more; a hit never spends the miss budget;
 *   - the state: IPs are stored as sha256(salt || ':' || ip), the salt from Vault (no unsalted digest, no raw address);
 *     dead windows are pruned by the call itself;
 *   - FAIL CLOSED: a missing, empty or too-short salt answers rate_limited to everyone and records nothing;
 *   - the effect test's read-only PART 1 returns ok = true on every row, and ok = false on the exact row of each
 *     bad grant (anon / authenticated / PUBLIC on the function, any client role on the table or the salt helper),
 *     of a missing secret, and of RLS off.
 */
import { assert, assertEquals, assertFalse, assertNotEquals } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';

const ROOT = new URL('../../', import.meta.url);
const MIGRATION = new URL('supabase/migrations/20261124000000_invite_preview.sql', ROOT);

const COMMISSIONER = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';
const BLANK = '1f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';
const L1 = 'a0000000-0000-4000-8000-000000000001';
const L_BOT = 'a0000000-0000-4000-8000-000000000002';
const L_BLANK = 'a0000000-0000-4000-8000-000000000003';
const L_DONE = 'a0000000-0000-4000-8000-000000000004';

const SALT = 'test-salt-0123456789abcdef-not-a-real-one';

const SCHEMA = `
create role anon; create role authenticated; create role service_role;
create schema vault;
create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
insert into vault.decrypted_secrets values ('invite_preview_ip_salt', '${SALT}');
-- Supabase's defaults: every table and function is BORN granted to these roles.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create table public.leagues (
  id uuid primary key, name text not null, commissioner_id text not null, invite_code text unique not null,
  season_status text default 'active', draft_status text not null default 'not_started',
  draft_date timestamptz, num_participants int not null default 8
);
create table public.league_members (league_id uuid not null, user_id text not null, role text not null, primary key (league_id, user_id));
create table public.league_invites (
  id uuid primary key default gen_random_uuid(), league_id uuid not null references public.leagues(id) on delete cascade,
  inviter_id text not null, invited_identifier text not null, code text not null unique,
  status text not null default 'pending' check (status in ('pending','accepted','declined','expired')),
  expires_at timestamptz null
);
create table public.user_profiles (id uuid primary key, username text, email_secret text);

insert into public.user_profiles values ('${COMMISSIONER}', 'Roberto', 'r@example.com'), ('${BLANK}', '   ', 'b@example.com');
insert into public.leagues (id, name, commissioner_id, invite_code, num_participants) values
  ('${L1}', 'Stock Scudetto', '${COMMISSIONER}', 'K7Q2XRM3PA', 8),
  ('${L_BOT}', 'Bot League', 'bot-1', 'BOTBOTBOT2', 4),
  ('${L_BLANK}', 'Nameless', '${BLANK}', 'BLANKBLNK2', 4);
insert into public.leagues (id, name, commissioner_id, invite_code, season_status, draft_status)
  values ('${L_DONE}', 'Old League', '${COMMISSIONER}', 'OLDLEAGUE2', 'completed', 'completed');
insert into public.league_members values ('${L1}', 'u1', 'commissioner'), ('${L1}', 'u2', 'member'), ('${L1}', 'u3', 'member');
insert into public.league_invites (league_id, inviter_id, invited_identifier, code, status, expires_at) values
  ('${L1}', 'u1', 'a@x', 'PENDING234', 'pending', now() + interval '1 day'),
  ('${L1}', 'u1', 'b@x', 'NOEXPIRY22', 'pending', null),
  ('${L1}', 'u1', 'c@x', 'EXPIRED234', 'pending', now() - interval '1 minute'),
  ('${L1}', 'u1', 'd@x', 'ACCEPTED22', 'accepted', null),
  ('${L1}', 'u1', 'e@x', 'DECLINED22', 'declined', null);
`;

// deno-lint-ignore no-explicit-any
type Row = any;

Deno.test({
  name: '20261124000000: invite_preview_lookup (PGlite)',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const db = new PGlite();
    const q = async (s: string, p: unknown[] = []) => (await db.query(s, p)).rows as Row[];
    const look = async (code: string | null, ip: string | null = '203.0.113.9') =>
      (await q(`select public.invite_preview_lookup($1, $2) as r`, [code, ip]))[0].r as Row;
    const as = async <T>(role: string, fn: () => Promise<T>): Promise<T> => {
      await db.exec(`set role ${role}`);
      try { return await fn(); } finally { await db.exec('reset role').catch(() => {}); }
    };
    const reset = () => db.exec('delete from public.invite_preview_limits');
    const count = async (subjectLike: string) =>
      Number((await q(`select coalesce(sum(hits), 0) as n from public.invite_preview_limits where subject like $1`, [subjectLike]))[0].n);

    await db.exec(SCHEMA);
    const migration = await Deno.readTextFile(MIGRATION);
    await db.exec(migration);
    await db.exec(migration); // idempotent re-apply

    await t.step('grants: anon / authenticated can do nothing; service_role executes but never touches the table', async () => {
      const fn = 'public.invite_preview_lookup(text, text)';
      const exec = async (r: string) => (await q(`select has_function_privilege($1, $2, 'EXECUTE') as ok`, [r, fn]))[0].ok;
      assertFalse(await exec('anon'));
      assertFalse(await exec('authenticated'));
      assert(await exec('service_role'));
      for (const r of ['anon', 'authenticated', 'service_role']) {
        for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
          const ok = (await q(`select has_table_privilege($1, 'public.invite_preview_limits', $2) as ok`, [r, p]))[0].ok;
          assertFalse(ok, `${r} has ${p} on the limiter table`);
        }
      }
      const rls = await q(`select relrowsecurity as on from pg_class where oid = 'public.invite_preview_limits'::regclass`);
      assert(rls[0].on);
      assertEquals((await q(`select count(*)::int as n from pg_policies where tablename = 'invite_preview_limits'`))[0].n, 0);
      const acl = (await q(`select proacl::text as a from pg_proc where proname = 'invite_preview_lookup'`))[0].a as string;
      // The grantees, exactly: the owner and service_role. An empty grantee ('=X/postgres') would be PUBLIC.
      const grantees = acl.replace(/[{}]/g, '').split(',').map((e) => e.split('=')[0]).sort();
      assertEquals(grantees, ['postgres', 'service_role'], `proacl ${acl}`);
      // the salt helper: the owner only. Not even service_role may read the salt.
      const saltFn = 'public.invite_preview_ip_salt()';
      for (const r of ['anon', 'authenticated', 'service_role']) {
        assertFalse((await q(`select has_function_privilege($1, $2, 'EXECUTE') as ok`, [r, saltFn]))[0].ok, `${r} can call the salt helper`);
      }
      const saltAcl = (await q(`select proacl::text as a from pg_proc where proname = 'invite_preview_ip_salt'`))[0].a as string;
      assertEquals(saltAcl.replace(/[{}]/g, '').split(',').map((e) => e.split('=')[0]), ['postgres'], `proacl ${saltAcl}`);
      let saltCode = '';
      await as('service_role', async () => { try { await q(`select public.invite_preview_ip_salt()`); } catch (e) { saltCode = (e as { code?: string }).code ?? ''; } });
      assertEquals(saltCode, '42501');
      // and for real, as the role: 42501
      for (const role of ['anon', 'authenticated']) {
        let code = '';
        await as(role, async () => { try { await look('K7Q2XRM3PA'); } catch (e) { code = (e as { code?: string }).code ?? ''; } });
        assertEquals(code, '42501', role);
      }
    });

    await t.step('a league code is found: the raw facts, the commissioner\'s username, nothing like an id or a code', async () => {
      await reset();
      const r = await look('K7Q2XRM3PA');
      assertEquals(r.status, 'found');
      assertEquals(r.name, 'Stock Scudetto');
      assertEquals(r.inviter, 'Roberto');
      assertEquals(r.season_status, 'active');
      assertEquals(r.draft_status, 'not_started');
      assertEquals(r.current_members, 3);
      assertEquals(r.num_participants, 8);
      assertEquals(Object.keys(r).sort(), ['current_members', 'draft_date', 'draft_status', 'inviter', 'name', 'num_participants', 'season_status', 'status']);
      const text = JSON.stringify(r);
      for (const f of [L1, COMMISSIONER, 'K7Q2XRM3PA', 'r@example.com', 'u1', 'commissioner_id']) assertFalse(text.includes(f), f);
    });

    await t.step('lower case and spaces are normalised, like the join functions', async () => {
      assertEquals((await look('  k7q2xrm3pa ')).status, 'found');
    });

    await t.step('inviter: null for a blank username, a bot commissioner, and no profile', async () => {
      assertEquals((await look('BLANKBLNK2')).inviter, null);
      assertEquals((await look('BOTBOTBOT2')).inviter, null);
      assertEquals((await look('BOTBOTBOT2')).name, 'Bot League');
    });

    await t.step('a pending, unexpired league_invites code resolves to its league', async () => {
      assertEquals((await look('PENDING234')).name, 'Stock Scudetto');
      assertEquals((await look('NOEXPIRY22')).name, 'Stock Scudetto');
    });

    await t.step('expired, accepted, declined, unknown and malformed codes: ONE not_found shape', async () => {
      await reset();
      const shapes = new Set<string>();
      for (const c of ['EXPIRED234', 'ACCEPTED22', 'DECLINED22', 'NOSUCHCODE', 'ABC', 'A'.repeat(13), "X'; drop table x;--", '', '../../etc', null]) {
        // a different IP each time so the per-IP miss budget does not interfere here
        shapes.add(JSON.stringify(await look(c, `198.51.100.${shapes.size + 10}`)));
      }
      assertEquals([...shapes], ['{"status":"not_found"}']);
    });

    await t.step('a completed league is still FOUND (the edge function turns its facts into season_completed)', async () => {
      const r = await look('OLDLEAGUE2');
      assertEquals(r.status, 'found');
      assertEquals(r.season_status, 'completed');
    });

    await t.step('per-IP misses: 10 an hour, then everything from that IP is refused, valid codes too, and spends nothing', async () => {
      await reset();
      for (let i = 0; i < 10; i++) assertEquals((await look(`MISS${i}CODE22`)).status, 'not_found', `miss ${i + 1}`);
      assertEquals(await count('miss-ip:%'), 10);
      assertEquals(await look('K7Q2XRM3PA'), { status: 'rate_limited', limit: 'miss-ip' }, 'a valid code from the throttled IP');
      assertEquals(await look('MISSXCODE22'), { status: 'rate_limited', limit: 'miss-ip' });
      assertEquals(await count('miss-ip:%'), 10, 'a refusal does not spend more of the budget');
      assertEquals(await count('miss-all'), 10);
      // another IP is unaffected
      assertEquals((await look('K7Q2XRM3PA', '198.51.100.77')).status, 'found');
    });

    await t.step('hits never spend the miss budget; the request limit is 30 a minute', async () => {
      await reset();
      for (let i = 0; i < 30; i++) assertEquals((await look('K7Q2XRM3PA')).status, 'found', `hit ${i + 1}`);
      assertEquals(await count('miss-%'), 0);
      assertEquals(await look('K7Q2XRM3PA'), { status: 'rate_limited', limit: 'ip' }, 'the 31st request in the minute');
    });

    await t.step('the GLOBAL ceiling: 300 misses an hour refuses everyone, any IP, any code', async () => {
      await reset();
      await db.exec(`insert into public.invite_preview_limits values ('miss-all', date_trunc('hour', now()), 299)`);
      assertEquals((await look('K7Q2XRM3PA', '192.0.2.1')).status, 'found', 'one under the ceiling');
      assertEquals((await look('MISSAGAIN22', '192.0.2.2')).status, 'not_found', 'the 300th miss');
      assertEquals(await look('K7Q2XRM3PA', '192.0.2.3'), { status: 'rate_limited', limit: 'miss-all' }, 'a brand-new IP, a valid code');
      assertEquals(await count('miss-all'), 300, 'the refusal spent nothing');
    });

    await t.step('the GLOBAL request ceiling: 600 a minute refuses everyone, even a brand-new address with a valid code', async () => {
      await reset();
      await db.exec(`insert into public.invite_preview_limits values ('req-all', date_trunc('minute', now()), 599)`);
      assertEquals((await look('K7Q2XRM3PA', '192.0.2.50')).status, 'found', 'the 600th');
      assertEquals(await look('K7Q2XRM3PA', '192.0.2.51'), { status: 'rate_limited', limit: 'req-all' }, 'the 601st');
    });

    await t.step('the check-then-bump runs under ONE (try) advisory lock, taken before the first read', async () => {
      const body = migration.replace(/--.*$/gm, '');
      const lock = body.indexOf('if not public.invite_preview_try_lock() then');
      assert(lock > 0, 'the lock exists');
      assert(lock < body.indexOf("subject = 'miss-all'"), 'before the ceiling reads');
      assert(lock > body.indexOf('length(v_salt) < 16'), 'after the fail-closed return (which touches nothing)');
      // and the function really runs with it (PGlite supports advisory locks)
      await reset();
      assertEquals((await look('K7Q2XRM3PA', '192.0.2.60')).status, 'found');
      assertEquals((await q(`select count(*)::int as n from pg_locks where locktype = 'advisory'`))[0].n, 0, 'transaction-scoped: nothing left held');
    });

    await t.step('CONTENTION: when the lock cannot be taken at once the caller is REFUSED (never queued), and nothing is recorded', async () => {
      await reset();
      // PGlite has one session (an advisory lock is re-entrant there), so contention is simulated by stubbing the
      // helper the lookup asks. The migration is re-applied afterwards to restore the real one.
      await db.exec(`create or replace function public.invite_preview_try_lock() returns boolean language sql as $$ select false $$`);
      try {
        for (const code of ['K7Q2XRM3PA', 'NOSUCHCODE9']) {
          assertEquals(await look(code, '203.0.113.31'), { status: 'rate_limited', limit: 'contention' }, code);
        }
        assertEquals((await q(`select count(*)::int as n from public.invite_preview_limits`))[0].n, 0, 'a refused caller records nothing');
      } finally {
        await db.exec(migration);
      }
      assertEquals((await look('K7Q2XRM3PA', '203.0.113.31')).status, 'found', 'restored');
      // and the real helper really is a TRY lock (never the blocking one that would queue a flood)
      const body = migration.replace(/--.*$/gm, '');
      assert(body.includes("select pg_try_advisory_xact_lock(hashtext('invite_preview_lookup'))"));
      assertFalse(/pg_advisory_xact_lock\(/.test(body), 'no blocking advisory lock anywhere');
      assert(body.includes('if not public.invite_preview_try_lock() then'));
    });

    await t.step('timeouts: lock_timeout = 1s (a relation lock wait), and NO statement_timeout (a function-level SET would bound nothing)', async () => {
      const cfg = (await q(`select proconfig::text as c from pg_proc where proname = 'invite_preview_lookup'`))[0].c as string;
      assert(cfg.includes('lock_timeout=1s'), cfg);
      assertFalse(cfg.includes('statement_timeout'), 'a false control: the top-level statement already armed its timer');
      assertFalse(/statement_timeout/.test(migration.replace(/--.*$/gm, '')), 'not in any statement of the migration (comments explain why)');
      assertFalse(/alter\s+role/i.test(migration.replace(/--.*$/gm, '')), 'and no role-wide timeout (it would hit every cron and batch path)');
    });

    await t.step('state: IPs are stored as sha256(salt || \':\' || ip): no raw address, no UNSALTED digest; dead windows are pruned', async () => {
      await reset();
      await db.exec(`insert into public.invite_preview_limits values ('ip:old', now() - interval '3 hours', 5), ('miss-all', now() - interval '3 hours', 99), ('ip:recent', now() - interval '90 minutes', 1)`);
      await look('K7Q2XRM3PA', '203.0.113.250');
      const subjects = (await q(`select subject from public.invite_preview_limits order by subject`)).map((r: Row) => r.subject as string);
      assertFalse(subjects.some((s) => s.includes('203.0.113.250')), 'no raw IP in the table');
      assertFalse(subjects.includes('ip:old'));
      assert(subjects.includes('ip:recent'), 'a window under two hours old stays');
      assertEquals(await count('miss-all'), 0, 'the old global window is gone, so the ceiling resets');
      const sha = async (text: string) => (await q(`select encode(sha256(convert_to($1, 'utf8')), 'hex') as h`, [text]))[0].h as string;
      const salted = 'ip:' + await sha(`${SALT}:203.0.113.250`);
      const unsalted = 'ip:' + await sha('203.0.113.250');
      assert(subjects.includes(salted), 'the subject is sha256(salt:ip)');
      assertFalse(subjects.includes(unsalted), 'an unsalted digest of an IPv4 address is reversible in minutes: never stored');
      const emptyDigest = await sha('');
      assertFalse(subjects.some((s) => s.includes(emptyDigest)), 'and not the digest of an empty value either');
    });

    await t.step('a different salt gives different subjects (the salt really is in the hash)', async () => {
      await reset();
      await look('K7Q2XRM3PA', '203.0.113.7');
      const before = (await q(`select subject from public.invite_preview_limits where subject like 'ip:%'`))[0].subject;
      await reset();
      await db.exec(`update vault.decrypted_secrets set decrypted_secret = 'another-salt-0123456789abcdef' where name = 'invite_preview_ip_salt'`);
      await look('K7Q2XRM3PA', '203.0.113.7');
      const after = (await q(`select subject from public.invite_preview_limits where subject like 'ip:%'`))[0].subject;
      assertNotEquals(before, after);
      await db.exec(`update vault.decrypted_secrets set decrypted_secret = '${SALT}' where name = 'invite_preview_ip_salt'`);
    });

    await t.step('FAIL CLOSED: a missing, empty or too-short salt answers rate_limited to everyone and records NOTHING', async () => {
      for (const setup of [
        `delete from vault.decrypted_secrets where name = 'invite_preview_ip_salt'`,
        `update vault.decrypted_secrets set decrypted_secret = '' where name = 'invite_preview_ip_salt'`,
        `update vault.decrypted_secrets set decrypted_secret = null where name = 'invite_preview_ip_salt'`,
        `update vault.decrypted_secrets set decrypted_secret = 'short-salt-15ch' where name = 'invite_preview_ip_salt'`, // 15 characters
      ]) {
        await db.exec(`insert into vault.decrypted_secrets values ('invite_preview_ip_salt', '${SALT}') on conflict (name) do update set decrypted_secret = excluded.decrypted_secret`);
        await db.exec(setup);
        await reset();
        for (const code of ['K7Q2XRM3PA', 'NOSUCHCODE9', '', null]) {
          assertEquals(await look(code, '203.0.113.9'), { status: 'rate_limited', limit: 'salt' }, `${setup} / ${code}`);
        }
        assertEquals((await q(`select count(*)::int as n from public.invite_preview_limits`))[0].n, 0, `nothing recorded: ${setup}`);
      }
      // it never falls back to the unsalted hash: with no secret, no 'ip:' row of any kind exists
      await db.exec(`insert into vault.decrypted_secrets values ('invite_preview_ip_salt', '${SALT}') on conflict (name) do update set decrypted_secret = excluded.decrypted_secret`);
      assertEquals((await look('K7Q2XRM3PA', '203.0.113.9')).status, 'found', 'restored: works again');
    });

    const effectSql = (await Deno.readTextFile(new URL('docs/security/invite-preview-effect-test.sql', ROOT)))
      .replaceAll('<TEST_INVITE_CODE>', 'K7Q2XRM3PA').replaceAll('<EXPECTED_LEAGUE_NAME>', 'Stock Scudetto');
    const part1Sql = effectSql.slice(effectSql.indexOf('with\ntbl as'), effectSql.indexOf('-- PART 2'));
    const part2Sql = effectSql.slice(effectSql.indexOf('do $$'), effectSql.indexOf('-- PART 3'));
    const part1 = async () => new Map((await q(part1Sql)).map((r: Row) => [r.check_name as string, r.ok as boolean]));
    const ROW = {
      rls: 'table: RLS on, no policies',
      relacl: 'table: no PUBLIC / anon / authenticated / service_role privilege (relacl)',
      overload: 'lookup: exactly one overload',
      timeouts: 'lookup: lock_timeout = 1s',
      owner: 'functions and the limiter table are owned by postgres',
      lockAcl: 'lock helper: owner only (no PUBLIC / anon / authenticated / service_role can execute)',
      lookupEff: 'lookup: effective privilege: anon / authenticated cannot execute, service_role can',
      tableEff: 'table: effective privilege: no client role can select / insert / update / delete / reference',
      saltEff: 'salt helper: effective privilege: no client role (service_role included) can execute',
      proacl: 'lookup: service_role=X, and NO PUBLIC / anon=X / authenticated=X (proacl)',
      definer: 'lookup: SECURITY DEFINER with search_path pinned',
      saltAcl: 'salt helper: owner only (no PUBLIC / anon / authenticated / service_role)',
      saltDefiner: 'salt helper: SECURITY DEFINER with search_path pinned',
      vault: 'vault: secret invite_preview_ip_salt exists and is >= 16 characters',
      all: 'ALL CHECKS',
    };

    await t.step('effect test PART 1 (read-only): every row ok on the migration as written, and it changes nothing', async () => {
      await reset();
      const before = JSON.stringify(await q(`select * from public.invite_preview_limits`));
      const rows = await part1();
      assertEquals(rows.size, Object.keys(ROW).length, [...rows.keys()].join(' | '));
      for (const [name, ok] of rows) assert(ok === true, `${name} -> ${ok}`);
      assertEquals(JSON.stringify(await q(`select * from public.invite_preview_limits`)), before);
      const code1 = part1Sql.replace(/--.*$/gm, '').replace(/'[^']*'/g, "''"); // comments and string literals are not statements
      assertFalse(/\b(insert|update|delete|create|drop|alter|grant|revoke|truncate)\b/i.test(code1), 'PART 1 is read-only SQL');
      assertFalse(/select\s+decrypted_secret/i.test(part1Sql.replace(/--.*$/gm, '')) && !/length\(decrypted_secret\)/.test(part1Sql), 'the salt value is never selected');
      assert(!/select[^;]*\bdecrypted_secret\b\s+(as|from|,)/i.test(part1Sql.replace(/--.*$/gm, '')), 'the secret column is only measured, never returned');
    });

    // The rows that look at the same object may fail together (the ACL row and the effective-privilege row).
    const FAMILY: Record<string, string[]> = {
      [ROW.proacl]: [ROW.proacl, ROW.lookupEff], [ROW.relacl]: [ROW.relacl, ROW.tableEff], [ROW.saltAcl]: [ROW.saltAcl, ROW.saltEff],
      [ROW.tableEff]: [ROW.tableEff], [ROW.lookupEff]: [ROW.lookupEff], [ROW.rls]: [ROW.rls], [ROW.vault]: [ROW.vault], [ROW.definer]: [ROW.definer], [ROW.timeouts]: [ROW.timeouts], [ROW.lockAcl]: [ROW.lockAcl],
      [ROW.owner]: [ROW.owner, ROW.proacl, ROW.lookupEff, ROW.saltAcl, ROW.saltEff, ROW.lockAcl, ROW.relacl, ROW.tableEff],
    };

    // Each BAD GRANT (or a missing secret) must turn its own row false, and the ALL row with it.
    for (const bad of [
      ['execute on the lookup granted to authenticated', `grant execute on function public.invite_preview_lookup(text, text) to authenticated`, `revoke execute on function public.invite_preview_lookup(text, text) from authenticated`, ROW.proacl],
      ['execute on the lookup granted to anon', `grant execute on function public.invite_preview_lookup(text, text) to anon`, `revoke execute on function public.invite_preview_lookup(text, text) from anon`, ROW.proacl],
      ['execute on the lookup granted to PUBLIC', `grant execute on function public.invite_preview_lookup(text, text) to public`, `revoke execute on function public.invite_preview_lookup(text, text) from public`, ROW.proacl],
      ['execute REVOKED from service_role (the function would be dead)', `revoke execute on function public.invite_preview_lookup(text, text) from service_role`, `grant execute on function public.invite_preview_lookup(text, text) to service_role`, ROW.proacl, ROW.lookupEff],
      ['select on the limiter table granted to anon', `grant select on public.invite_preview_limits to anon`, `revoke select on public.invite_preview_limits from anon`, ROW.relacl],
      ['insert on the limiter table granted to authenticated', `grant insert on public.invite_preview_limits to authenticated`, `revoke insert on public.invite_preview_limits from authenticated`, ROW.relacl],
      ['all on the limiter table granted to service_role (Supabase\'s default)', `grant all on public.invite_preview_limits to service_role`, `revoke all on public.invite_preview_limits from service_role`, ROW.relacl],
      ['the limiter table granted to PUBLIC', `grant select on public.invite_preview_limits to public`, `revoke select on public.invite_preview_limits from public`, ROW.relacl],
      ['execute on the salt helper granted to service_role', `grant execute on function public.invite_preview_ip_salt() to service_role`, `revoke execute on function public.invite_preview_ip_salt() from service_role`, ROW.saltAcl],
      ['execute on the salt helper granted to authenticated', `grant execute on function public.invite_preview_ip_salt() to authenticated`, `revoke execute on function public.invite_preview_ip_salt() from authenticated`, ROW.saltAcl],
      ['a COLUMN-level select granted to anon (not visible in relacl)', `grant select (subject) on public.invite_preview_limits to anon`, `revoke select (subject) on public.invite_preview_limits from anon`, ROW.tableEff],
      ['privilege inherited through role membership (authenticated joins a role holding execute)', `create role leaky; grant execute on function public.invite_preview_lookup(text, text) to leaky; grant leaky to authenticated`, `revoke leaky from authenticated; revoke execute on function public.invite_preview_lookup(text, text) from leaky; drop role leaky`, ROW.lookupEff],
      ['RLS switched off on the limiter table', `alter table public.invite_preview_limits disable row level security`, `alter table public.invite_preview_limits enable row level security`, ROW.rls],
      ['a policy added on the limiter table', `create policy p_all on public.invite_preview_limits for select using (true)`, `drop policy p_all on public.invite_preview_limits`, ROW.rls],
      ['the Vault secret missing', `delete from vault.decrypted_secrets where name = 'invite_preview_ip_salt'`, `insert into vault.decrypted_secrets values ('invite_preview_ip_salt', '${SALT}')`, ROW.vault],
      ['the Vault secret too short', `update vault.decrypted_secrets set decrypted_secret = 'short' where name = 'invite_preview_ip_salt'`, `update vault.decrypted_secrets set decrypted_secret = '${SALT}' where name = 'invite_preview_ip_salt'`, ROW.vault],
      ['execute on the lock helper granted to authenticated', `grant execute on function public.invite_preview_try_lock() to authenticated`, `revoke execute on function public.invite_preview_try_lock() from authenticated`, ROW.lockAcl],
      ['execute on the lock helper granted to service_role', `grant execute on function public.invite_preview_try_lock() to service_role`, `revoke execute on function public.invite_preview_try_lock() from service_role`, ROW.lockAcl],
      ['lock helper privilege inherited through role membership', `create role leaky2; grant execute on function public.invite_preview_try_lock() to leaky2; grant leaky2 to authenticated`, `revoke leaky2 from authenticated; revoke execute on function public.invite_preview_try_lock() from leaky2; drop role leaky2`, ROW.lockAcl],
      ['the lookup\'s lock_timeout reset', `alter function public.invite_preview_lookup(text, text) reset lock_timeout`, `alter function public.invite_preview_lookup(text, text) set lock_timeout = '1s'`, ROW.timeouts],
      ['the LIMITER TABLE\'s owner is not postgres (an owner bypasses RLS)', `create role evil3; alter table public.invite_preview_limits owner to evil3`, `alter table public.invite_preview_limits owner to postgres; drop role evil3`, ROW.owner],
      ['the lookup\'s OWNER is not postgres (a definer runs with the owner\'s rights)', `create role evil; alter function public.invite_preview_lookup(text, text) owner to evil`, `alter function public.invite_preview_lookup(text, text) owner to postgres; drop role evil`, ROW.owner],
      ['the LOCK helper\'s OWNER is not postgres', `create role evil4; alter function public.invite_preview_try_lock() owner to evil4`, `alter function public.invite_preview_try_lock() owner to postgres; drop role evil4`, ROW.owner],
      ['the salt helper\'s OWNER is not postgres', `create role evil2; alter function public.invite_preview_ip_salt() owner to evil2`, `alter function public.invite_preview_ip_salt() owner to postgres; drop role evil2`, ROW.owner],
      ['the lookup made SECURITY INVOKER', `alter function public.invite_preview_lookup(text, text) security invoker`, `alter function public.invite_preview_lookup(text, text) security definer`, ROW.definer],
      ['the lookup\'s search_path unpinned', `alter function public.invite_preview_lookup(text, text) reset search_path`, `alter function public.invite_preview_lookup(text, text) set search_path = public, pg_temp`, ROW.definer],
    ] as const) {
      await t.step(`effect test PART 1 catches: ${bad[0]}`, async () => {
        await db.exec(bad[1]);
        try {
          const rows = await part1();
          assertEquals(rows.get(bad[3]), false, `${bad[3]} should be false`);
          // a dead function (service_role locked out) fails BOTH views of the same fact
          if (bad.length > 4) assertEquals(rows.get(bad[4] as string), false, `${bad[4]} should be false too`);
          assertEquals(rows.get(ROW.all), false, 'the ALL row follows');
          const wrong = [...rows].filter(([n, ok]) => !FAMILY[bad[3]].includes(n) && n !== ROW.all && !ok).map(([n]) => n);
          assertEquals(wrong, [], 'and no row outside its own object');
        } finally {
          await db.exec(bad[2]);
        }
        assertEquals((await part1()).get(ROW.all), true, 'restored');
      });
    }

    await t.step('effect test PART 2 (the lookup and the limiter) runs as written, every line PASSES, nothing is left behind', async () => {
      await reset();
      let message = '';
      try { await db.exec(part2Sql); } catch (e) { message = (e as Error).message; }
      assert(message.includes('rolled back on purpose'), message);
      const lines = message.split('\n').filter((l) => /^T\d /.test(l));
      assertEquals(lines.length, 4, message);
      for (const l of lines) assert(l.trimEnd().endsWith('PASS'), l);
      assertEquals((await q(`select count(*)::int as n from public.invite_preview_limits`))[0].n, 0, 'the raise rolled the limiter rows back');
    });

    await t.step('effect test PART 3 names the forged-header procedure with the exact expectations', async () => {
      const p3 = effectSql.slice(effectSql.indexOf('-- PART 3'));
      for (const needle of ["x-forwarded-for: 6.6.6.6", "cf-connecting-ip: 6.6.6.7", "x-real-ip: 6.6.6.8", '{"error":"rate_limited"} [429]', 'FAIL', 'other direction', 'delete from public.invite_preview_limits']) {
        assert(p3.includes(needle), needle);
      }
    });

    await t.step('an empty IP shares ONE bucket (the strict direction)', async () => {
      await reset();
      for (let i = 0; i < 10; i++) await look(`NOIP${i}CODE22`, '');
      assertEquals((await look('K7Q2XRM3PA', null)).status, 'rate_limited');
    });
  },
});
