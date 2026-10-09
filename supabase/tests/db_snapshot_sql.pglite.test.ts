/**
 * docs/architecture/db-snapshot.sql is run by hand against prod, so a syntax
 * error or a wrong catalog column would only surface there. This runs the file
 * VERBATIM in PGlite (Postgres 16) over stub cron.job / storage.buckets and a
 * small public schema, and checks that every block -- including the grant /
 * default-privilege / bucket / publication blocks added for the 2026-10-08
 * lockdown audit -- reports what is actually there.
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';

const ROOT = new URL('../../', import.meta.url);

Deno.test({
  name: 'db-snapshot.sql runs and captures grants, column ACLs, views, default privileges, buckets, publications',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema cron; create table cron.job (jobid bigint, jobname text, schedule text, active boolean,
        database text, username text, command text);
      insert into cron.job values (1, 'j', '* * * * *', true, 'postgres', 'postgres',
        'select net.http_post(headers := jsonb_build_object(''apikey'', ''sb_secret_abcdefghijklmnop''))');
      create schema storage; create table storage.buckets (id text primary key, name text, public boolean);
      insert into storage.buckets values ('avatars', 'avatars', true), ('private', 'private', false);
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      create table public.t_open (id int, secret text);
      create table public.t_cols (id int, note text);
      revoke all on public.t_cols from anon, authenticated;
      grant select (id) on public.t_cols to authenticated;
      create view public.v_inv with (security_invoker = true) as select id from public.t_open;
      create view public.v_owner as select id from public.t_open;
      create publication supabase_realtime for table public.t_open;
      create function public.f() returns int language sql as 'select 1';
    `);
    const sql = await Deno.readTextFile(new URL('docs/architecture/db-snapshot.sql', ROOT));
    const out = (await db.query<{ db_snapshot: string }>(sql)).rows[0].db_snapshot;
    const snap = JSON.parse(out);

    for (const k of ['functions', 'tables', 'views', 'defaultPrivileges', 'storageBuckets', 'publications', 'cronJobs']) {
      assert(Array.isArray(snap[k]), `${k} missing`);
    }
    const open = snap.tables.find((t: { name: string }) => t.name === 't_open');
    assert(open.acl.some((a: string) => a.startsWith('anon=')), `anon grant not captured: ${open.acl}`);
    assertEquals(open.columnAcls, {});
    const cols = snap.tables.find((t: { name: string }) => t.name === 't_cols');
    assertEquals(cols.acl.some((a: string) => a.startsWith('anon=')), false);
    assertEquals(Object.keys(cols.columnAcls), ['id']);
    assert(cols.columnAcls.id.some((a: string) => a.startsWith('authenticated=r')));

    const views = Object.fromEntries(snap.views.map((v: { name: string; securityInvoker: boolean }) => [v.name, v.securityInvoker]));
    assertEquals(views, { v_inv: true, v_owner: false });
    assert(snap.defaultPrivileges.some((d: { schema: string; objectType: string; acl: string[] }) =>
      d.schema === 'public' && d.objectType === 'r' && d.acl.some((a) => a.startsWith('anon='))));
    assertEquals(snap.storageBuckets.map((b: { id: string; public: boolean }) => [b.id, b.public]),
      [['avatars', true], ['private', false]]);
    assertEquals(snap.publications.map((p: { publication: string; table: string }) => `${p.publication}:${p.table}`),
      ['supabase_realtime:t_open']);
    // The pre-existing redaction still holds.
    assert(snap.cronJobs[0].command.includes('[REDACTED:sb_key]'));
    assertEquals(snap.cronJobs[0].command.includes('sb_secret_abc'), false);
  },
});
