/**
 * 20261122000002: public.note_draft_bounded, against REAL Postgres (PGlite =
 * Postgres 16 in WASM). NOT hermetic: the first run fetches
 * npm:@electric-sql/pglite. Run instructions: supabase/tests/README.md.
 *
 * The migration is loaded VERBATIM onto a replica of draft_stalls
 * (20261101000001) and Supabase's default privileges (EXECUTE granted to anon AND
 * authenticated separately from PUBLIC), so the revokes are proven.
 *
 * What it proves: service_role only (has_function_privilege, a refused call,
 * proacl); the first call inserts attempts 1; each call bumps by one in ONE
 * statement and re-arms last_seen_at; a legality-stall or outage row restarts
 * the count; the migration re-applies.
 */
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';

const ROOT = new URL('../../', import.meta.url);
const MIGRATION = 'supabase/migrations/20261122000002_draft_note_bounded.sql';
const SIG = 'public.note_draft_bounded(uuid, integer, text)';
const L = '00000000-0000-4000-8000-000000000001';

const SCHEMA = `
create role anon; create role authenticated; create role service_role;
alter role service_role bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
create table public.draft_stalls (
  league_id uuid not null, pick_number integer not null, picker_id text not null, reason text not null,
  attempts integer not null default 0, first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(), primary key (league_id, pick_number));
`;

// deno-lint-ignore no-explicit-any
type Row = any;

Deno.test({
  name: '20261122000002: note_draft_bounded on real Postgres (PGlite)',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const db = new PGlite();
    const q = async (s: string, p: unknown[] = []) => (await db.query(s, p)).rows as Row[];
    const as = async <T>(role: string, fn: () => Promise<T>): Promise<T> => {
      await db.exec(`set role ${role}`);
      try {
        return await fn();
      } finally {
        await db.exec('reset role').catch(() => {});
      }
    };
    const note = (pick: number, picker = 'u') =>
      as('service_role', () => q(`select * from public.note_draft_bounded($1::uuid, $2, $3)`, [L, pick, picker])).then((r) => ({ attempts: Number(r[0].attempts), reason: r[0].reason }));
    const row = async (pick: number) => (await q(`select * from public.draft_stalls where league_id = $1 and pick_number = $2`, [L, pick]))[0];

    await db.exec(SCHEMA);
    const migration = await Deno.readTextFile(new URL(MIGRATION, ROOT));
    await db.exec(migration);

    await t.step('grants: service_role only (by name)', async () => {
      const p = (await q(`select has_function_privilege('anon', '${SIG}', 'EXECUTE') as a,
                                 has_function_privilege('authenticated', '${SIG}', 'EXECUTE') as u,
                                 has_function_privilege('service_role', '${SIG}', 'EXECUTE') as s`))[0];
      assertEquals([p.a, p.u, p.s], [false, false, true]);
      const acl = String((await q(`select proacl::text as acl from pg_proc where proname = 'note_draft_bounded'`))[0].acl);
      assert(!/(^|[{,])anon=/.test(acl) && !/(^|[{,])authenticated=/.test(acl) && !/(^|[{,])=X/.test(acl), acl);
      for (const role of ['anon', 'authenticated']) {
        await assertRejects(() => as(role, () => q(`select * from public.note_draft_bounded($1::uuid, 1, 'u')`, [L])), Error, 'permission denied');
      }
    });

    await t.step('first call inserts attempts 1; each call bumps by one and re-arms last_seen_at', async () => {
      assertEquals(await note(5), { attempts: 1, reason: 'search_bounded' });
      await q(`update public.draft_stalls set last_seen_at = now() - interval '5 minutes' where pick_number = 5`);
      const before = Date.parse(String((await row(5)).last_seen_at));
      assertEquals(await note(5), { attempts: 2, reason: 'search_bounded' });
      assertEquals(await note(5), { attempts: 3, reason: 'search_bounded' });
      assert(Date.parse(String((await row(5)).last_seen_at)) > before, 'last_seen_at re-armed');
    });

    await t.step('a legality stall or an outage row restarts the count (a bound is a new claim)', async () => {
      await q(`insert into public.draft_stalls (league_id, pick_number, picker_id, reason, attempts) values ($1, 6, 'u', 'nothing_legal', 7), ($1, 7, 'u', 'vendor_outage', 0)`, [L]);
      assertEquals(await note(6), { attempts: 1, reason: 'search_bounded' });
      assertEquals(await note(7), { attempts: 1, reason: 'search_bounded' });
    });

    await t.step('the migration re-applies cleanly; grants unchanged', async () => {
      await db.exec(migration);
      const p = (await q(`select has_function_privilege('anon', '${SIG}', 'EXECUTE') as a, has_function_privilege('authenticated', '${SIG}', 'EXECUTE') as u`))[0];
      assertEquals([p.a, p.u], [false, false]);
    });
  },
});
