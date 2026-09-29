/**
 * 20261007000000_username_write_path against REAL Postgres (PGlite = Postgres 16
 * in WASM). NOT hermetic: the first run fetches npm:@electric-sql/pglite.
 * Run instructions: supabase/tests/README.md.
 *
 * WHAT IS LOADED VERBATIM (in order), on a stubbed Supabase shell:
 *   20251210100000_create_user_profiles        table, LOWER(username) partial
 *                                              unique index, own-row policies,
 *                                              updated_at trigger
 *   20251230230000_add_avatar_to_profiles
 *   20260122000000_add_push_tokens
 *   20260728000001_gate_user_profiles_to_authenticated   SELECT TO authenticated
 *   20261005000001_signup_username_trigger     handle_new_user_profile on auth.users
 *   20261007000000_username_write_path         <- under test
 * STUBBED: roles anon/authenticated/service_role + Supabase's ALTER DEFAULT
 * PRIVILEGES (explicit per-role EXECUTE/table grants, so the proacl assertion
 * proves the explicit revokes work); auth.users (id, email,
 * raw_user_meta_data only); auth.uid() (same body as Supabase's: request.jwt
 * claim `sub`); the supabase_realtime publication.
 *
 * WHAT THIS CANNOT PROVE — the SQL-editor effect test
 * (docs/security/username-write-path-effect-test.sql) still owns these:
 *   - Supabase's REAL roles and their REAL default grants. The roles here are
 *     created by this file and the default privileges are simulated, so a
 *     passing proacl step proves the migration's revokes against the
 *     simulation, not against prod's catalog.
 *   - PostgREST's role switch and GoTrue-issued JWT claims. Here `set role` +
 *     a hand-set request.jwt.claims stand in for them; the real auth.uid()
 *     may differ in detail.
 *   - The real auth.users table and GoTrue's signup transaction. The trigger
 *     function runs verbatim, but on a three-column stub, fired by a plain
 *     INSERT rather than by GoTrue.
 *   - Real concurrency. PGlite is one connection, so the unique_violation
 *     race is SIMULATED by a test-only BEFORE INSERT trigger that plays the
 *     concurrent writer inside set_username's own statement.
 *   - Prod data. The fail-closed step proves a violating row aborts the whole
 *     migration; whether prod HAS one is the migration's PRE-CHECK's job.
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';

const ROOT = new URL('../../', import.meta.url);
const mig = (f: string) => Deno.readTextFile(new URL(`supabase/migrations/${f}`, ROOT));
const PRIOR = [
  '20251210100000_create_user_profiles.sql',
  '20251230230000_add_avatar_to_profiles.sql',
  '20260122000000_add_push_tokens.sql',
  '20260728000001_gate_user_profiles_to_authenticated.sql',
  '20261005000001_signup_username_trigger.sql',
];
const TARGET = '20261007000000_username_write_path.sql';
const TRIGGER = '20261005000001_signup_username_trigger.sql';

const SCHEMA = `
create role anon; create role authenticated; create role service_role;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
-- Supabase: every new public function/table gets explicit per-role grants.
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
create publication supabase_realtime;
`;

// deno-lint-ignore no-explicit-any
type Row = any;
type Role = 'anon' | 'authenticated' | null;

async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SCHEMA);
  for (const f of PRIOR) await db.exec(await mig(f));
  return db;
}

/** Postgres array literal, so NULL elements survive parameter serialization. */
const pgArr = (a: (string | null)[]) =>
  '{' + a.map((x) => (x === null ? 'NULL' : '"' + x.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"')).join(',') + '}';

/** Resolve to the SQLSTATE a statement raised, or 'no error'. */
async function sqlstate(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'no error';
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
}

Deno.test({
  name: 'username write path on real Postgres (PGlite)',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const target = await mig(TARGET);

    await t.step('regex parity: CHECK, both RPCs and the signup trigger use one pattern', async () => {
      const pats = (s: string) => [...s.matchAll(/~\s*'(\^[^']*\$)'/g)].map((m) => m[1]);
      const inTarget = pats(target);
      const inTrigger = pats(await mig(TRIGGER));
      assert(inTarget.length >= 3, `expected CHECK + 2 RPC patterns, found ${inTarget.length}`);
      assert(inTrigger.length >= 1, 'trigger pattern not found');
      assertEquals([...new Set([...inTarget, ...inTrigger])], ['^[A-Za-z0-9_]{3,20}$']);
    });

    await t.step('fails closed: one violating row aborts the WHOLE migration', async () => {
      const db = await freshDb();
      const id = crypto.randomUUID();
      await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'v@t.invalid', '{"username":"ok_name"}')`, [id]);
      await db.query(`update user_profiles set username = 'bad name!' where id = $1`, [id]); // pre-CHECK: allowed
      assertEquals(await sqlstate(db.exec(target)), '23514');
      const [r] = (await db.query(`select
          (select count(*)::int from pg_proc where proname in ('set_username','check_usernames')) fns,
          (select count(*)::int from pg_constraint where conname = 'user_profiles_username_format') cons`)).rows as Row[];
      assertEquals([r.fns, r.cons], [0, 0]); // nothing half-applied
      await db.close();
    });

    // ------------------------------------------------------------------------
    // Main database: fixtures created through the verbatim signup trigger
    // BEFORE the migration (as prod's existing rows were), then the migration.
    // ------------------------------------------------------------------------
    const db = await freshDb();
    const q = async (s: string, p: unknown[] = []) => (await db.query(s, p)).rows as Row[];
    const signup = async (meta: Record<string, unknown> | null) => {
      const id = crypto.randomUUID();
      await q(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)`,
        [id, `${id}@t.invalid`, meta ? JSON.stringify(meta) : null]);
      return id;
    };
    const nameOf = async (id: string) => (await q(`select username from user_profiles where id = $1`, [id]))[0]?.username;

    /** Run fn as `role` (null = the privileged session role) with JWT sub = `sub`. */
    async function as<T>(role: Role, sub: string | null, fn: () => Promise<T>): Promise<T> {
      await q(`select set_config('request.jwt.claims', $1, false)`,
        [sub ? JSON.stringify({ sub, role: role ?? 'authenticated' }) : role === 'anon' ? '{}' : '']);
      if (role) await db.exec(`set role ${role}`);
      try {
        return await fn();
      } finally {
        await db.exec('reset role');
        await q(`select set_config('request.jwt.claims', '', false)`);
      }
    }
    const setU = (name: string | null) => q(`select public.set_username($1) r`, [name]).then((r) => r[0].r as string);
    const check = (a: (string | null)[] | null) =>
      q(`select username, status from public.check_usernames($1::text[])`, [a === null ? null : pgArr(a)]);

    const alice = await signup({ username: 'alice_fx' });
    const bob = await signup({ username: 'bob_fx' });
    const carol = await signup({ username: 'carol_fx' });
    const dave = await signup({ username: 'dave_fx' });
    const nobody = await signup(null); // NULL username: the 3b-1 first-run case
    await db.exec(target);

    await t.step('migration applied: CHECK present and validated', async () => {
      const r = await q(`select convalidated from pg_constraint where conname = 'user_profiles_username_format'`);
      assertEquals(r, [{ convalidated: true }]);
      assertEquals(await nameOf(nobody), null); // pre-existing NULL survived validation
    });

    await t.step('grants: authenticated only; DEFINER; search_path pinned', async () => {
      const rows = await q(`select proname, proacl::text a, prosecdef d, proconfig::text c from pg_proc
        where proname in ('set_username','check_usernames') order by proname`);
      assertEquals(rows.length, 2);
      for (const r of rows) {
        assert(!/anon=/.test(r.a), `${r.proname}: ${r.a}`);
        assert(!/(^|[{,])=X/.test(r.a), `${r.proname}: PUBLIC still has EXECUTE: ${r.a}`);
        assert(/authenticated=X/.test(r.a), `${r.proname}: ${r.a}`);
        assert(r.d, `${r.proname} is not SECURITY DEFINER`);
        assert(r.c.includes('search_path=public, pg_temp'), `${r.proname}: ${r.c}`);
      }
    });

    await t.step('CHECK on a direct write: valid / invalid / NULL', async () => {
      const upd = (v: string | null) => sqlstate(q(`update user_profiles set username = $1 where id = $2`, [v, dave]));
      for (const ok of ['dave_fx2', 'abc', 'a'.repeat(20), 'A_1', null]) assertEquals(await upd(ok), 'no error', String(ok));
      for (const bad of ['ab', 'a'.repeat(21), 'bad name!', 'dash-name', 'ünï_x', 'abc\n', ' abc', '']) {
        assertEquals(await upd(bad), '23514', JSON.stringify(bad));
      }
      await q(`update user_profiles set username = 'dave_fx' where id = $1`, [dave]);
    });

    await t.step('set_username: ok, idempotent, re-case own, case-insensitive taken', async () => {
      await as('authenticated', alice, async () => {
        assertEquals(await setU('alice_new'), 'ok');
        assertEquals(await nameOf(alice), 'alice_new');
        assertEquals(await setU('alice_new'), 'ok'); // idempotent
        assertEquals(await setU('ALICE_New'), 'ok'); // re-case own name
        assertEquals(await nameOf(alice), 'ALICE_New');
      });
      await as('authenticated', bob, async () => {
        assertEquals(await setU('alice_new'), 'taken'); // other user, other case
        assertEquals(await setU('CAROL_FX'), 'taken');
        assertEquals(await nameOf(bob), 'bob_fx');
      });
    });

    await t.step('set_username: invalid (NULL, empty, newline, non-ASCII, ...) writes nothing', async () => {
      await as('authenticated', bob, async () => {
        for (const bad of [null, '', 'ab', 'a'.repeat(21), 'bob_fx\n', ' bob_fx', 'ünï_name', 'has space', 'x;--drop', 'dash-name']) {
          assertEquals(await setU(bad), 'invalid', JSON.stringify(bad));
        }
        assertEquals(await nameOf(bob), 'bob_fx'); // never NULLed
      });
    });

    await t.step('set_username: account with no profile row gets one (ON CONFLICT insert arm)', async () => {
      await q(`delete from user_profiles where id = $1`, [dave]);
      await as('authenticated', dave, async () => assertEquals(await setU('dave_back'), 'ok'));
      assertEquals(await nameOf(dave), 'dave_back');
    });

    await t.step('set_username: race — concurrent writer takes the name after the pre-check -> taken', async () => {
      // Test-only stand-in for a second connection: when test.race_other is
      // set, a BEFORE INSERT trigger gives that user the incoming name AFTER
      // set_username's EXISTS pre-check has passed, so the upsert's UPDATE arm
      // hits the LOWER(username) index and raises unique_violation.
      await db.exec(`
        create function test_race() returns trigger language plpgsql as $$
        declare v text := current_setting('test.race_other', true);
        begin
          if coalesce(v, '') <> '' then
            update public.user_profiles set username = new.username where id = v::uuid;
          end if;
          return new;
        end $$;
        create trigger test_race before insert on public.user_profiles
          for each row execute function test_race();`);
      await q(`select set_config('test.race_other', $1, false)`, [carol]);
      try {
        await as('authenticated', bob, async () => assertEquals(await setU('race_name'), 'taken'));
      } finally {
        await q(`select set_config('test.race_other', '', false)`);
        await db.exec(`drop trigger test_race on public.user_profiles; drop function test_race();`);
      }
      assertEquals(await nameOf(bob), 'bob_fx');
      // The handler's subtransaction rolled back the simulated writer too.
      assertEquals(await nameOf(carol), 'carol_fx');
    });

    await t.step('check_usernames: statuses, own name available, duplicates collapsed, order, NULL element', async () => {
      await as('authenticated', bob, async () => {
        const rows = await check(['alice_new', 'bob_fx', 'free_fx', 'ab', 'alice_new', null, 'Bob_FX']);
        assertEquals(rows, [
          { username: 'alice_new', status: 'taken' },
          { username: 'bob_fx', status: 'available' }, // caller's own
          { username: 'free_fx', status: 'available' },
          { username: 'ab', status: 'invalid' },
          { username: null, status: 'invalid' },
          { username: 'Bob_FX', status: 'available' }, // distinct is exact-string, not case-folded
        ]);
      });
    });

    await t.step('check_usernames: 10 ok, 11 -> 22023 (raw count), NULL / {} -> 0 rows', async () => {
      await as('authenticated', bob, async () => {
        assertEquals((await check(Array.from({ length: 10 }, (_, i) => `cand_${i}`))).length, 10);
        assertEquals(await sqlstate(check(Array(11).fill('same_name'))), '22023'); // duplicates still count
        assertEquals(await check(null), []);
        assertEquals(await check([]), []);
      });
    });

    await t.step('no JWT sub (auth.uid() NULL) -> 42501 from both, nothing written', async () => {
      await as(null, null, async () => {
        assertEquals(await sqlstate(setU('ghost_fx')), '42501');
        assertEquals(await sqlstate(check(['ghost_fx'])), '42501');
      });
      assertEquals((await q(`select count(*)::int n from user_profiles where username = 'ghost_fx'`))[0].n, 0);
    });

    await t.step('anon role -> 42501 permission denied (no EXECUTE) on both', async () => {
      // The message matters, not just the code: the functions' own no-JWT
      // RAISE is ALSO 42501, so an anon EXECUTE grant left in place would still
      // produce 42501 here. "permission denied" proves the GRANT refused it.
      const denied = async (p: Promise<unknown>) => {
        try {
          await p;
          return 'no error';
        } catch (e) {
          const { code, message } = e as { code?: string; message?: string };
          return `${code} ${/permission denied for function/.test(message ?? '') ? 'grant' : message}`;
        }
      };
      await as('anon', null, async () => {
        assertEquals(await denied(setU('anon_fx')), '42501 grant');
        assertEquals(await denied(check(['anon_fx'])), '42501 grant');
      });
    });

    await t.step('direct DML as authenticated through the real RLS policies', async () => {
      await as('authenticated', bob, async () => {
        assertEquals(await sqlstate(q(`update user_profiles set username = 'bad name!' where id = $1`, [bob])), '23514');
        // The exact shape supabase-js .upsert(..., { onConflict: 'id' }) sends.
        assertEquals(await sqlstate(q(`insert into user_profiles (id, username) values ($1, 'x')
          on conflict (id) do update set id = excluded.id, username = excluded.username`, [bob])), '23514');
        const other = await db.query(`update user_profiles set username = 'hijack_fx' where id = $1`, [alice]);
        assertEquals(other.affectedRows ?? 0, 0); // own-row policy unchanged
        const own = await db.query(`update user_profiles set username = null where id = $1`, [bob]);
        assertEquals(own.affectedRows, 1); // NULL stays allowed (3b-1 prompt)
      });
      assertEquals(await nameOf(alice), 'ALICE_New');
      assertEquals(await nameOf(bob), null);
    });

    await t.step('signup trigger after the CHECK: invalid / colliding metadata -> NULL, never an error', async () => {
      const bad = await signup({ username: 'bad name!' });
      const clash = await signup({ username: 'alice_NEW' }); // collides with ALICE_New
      const good = await signup({ username: 'erin_fx' });
      assertEquals([await nameOf(bad), await nameOf(clash), await nameOf(good)], [null, null, 'erin_fx']);
    });

    await db.close();
  },
});
