/**
 * Handler-level proof for heal-account-deletions: the REAL index.ts, with
 * Deno.serve captured and fetch faked as PostgREST + GoTrue (the
 * cron_status_handlers.test.ts technique), so the auth guard, the runJob bracket,
 * the cron_job_status writes and the ORDER of calls are the real code's.
 *
 * What it pins (CLAUDE.md "Success signals"):
 *   - a caller without the cron apikey gets 401 and writes NO status row;
 *   - every exit ends in exactly one terminal status, never a stranded 'running';
 *   - a deletion is reported healed only when account_deletion_mark_done says
 *     'done' (it verifies auth.users itself), and is 'failed' otherwise;
 *   - the auth user is deleted BEFORE mark_done is asked.
 *
 *   deno test --allow-read --allow-env --no-check supabase/tests/heal_account_deletions_handler.test.ts
 */
import { assert, assertEquals } from 'jsr:@std/assert';

const CRON_KEY = 'test-cron-key-not-a-secret';
const FAKE_ENV: Record<string, string> = {
  SB_SECRET_KEY_CRON: CRON_KEY,
  SUPABASE_URL: 'http://stub.supabase.test',
  SB_SECRET_KEY_INTERNAL: 'test-internal-key-not-a-secret',
};
const SAVED_ENV = new Map(Object.keys(FAKE_ENV).map((k) => [k, Deno.env.get(k)]));
for (const [k, v] of Object.entries(FAKE_ENV)) Deno.env.set(k, v);

const JOB = 'heal-account-deletions';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const JSON_HEADERS = { 'content-type': 'application/json', 'content-range': '*/0' };

interface Row { job_name: string; run_date: string; status: string; attempt_number: number; error_message: string | null }

class Fake {
  rows = new Map<string, Row>();
  statusWrites: string[] = [];
  /** every non-status call, in order: 'rpc:<name>' or 'auth-delete:<id>' */
  calls: string[] = [];
  /** rpc name -> response */
  rpc: Record<string, () => Response> = {};
  today = () => new Date().toISOString().split('T')[0];
  row(): Row | undefined { return this.rows.get(`${JOB}|${this.today()}`); }
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: JSON_HEADERS });

function install(fake: Fake): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const req = input instanceof Request ? input : null;
    const url = new URL(req ? req.url : String(input));
    const method = (req?.method ?? init?.method ?? 'GET').toUpperCase();
    const raw = req ? await req.text() : (init?.body as string | undefined);
    const body = raw ? JSON.parse(raw) : undefined;

    if (url.pathname === '/rest/v1/cron_job_status') {
      const job = url.searchParams.get('job_name')?.replace('eq.', '') ?? '';
      const date = url.searchParams.get('run_date')?.replace('eq.', '') ?? '';
      if (method === 'POST') {
        const r = body as Row;
        fake.statusWrites.push(r.status);
        fake.rows.set(`${r.job_name}|${r.run_date}`, { ...r });
        return new Response(null, { status: 201 });
      }
      if (method === 'PATCH') return new Response('[]', { status: 200, headers: JSON_HEADERS });
      const row = fake.rows.get(`${job}|${date}`);
      return new Response(JSON.stringify(row ? [row] : []), { status: 200, headers: JSON_HEADERS });
    }
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const name = url.pathname.split('/').pop()!;
      fake.calls.push(`rpc:${name}`);
      return (fake.rpc[name] ?? (() => ok(null)))();
    }
    if (url.pathname.startsWith('/auth/v1/admin/users/') && method === 'DELETE') {
      fake.calls.push(`auth-delete:${url.pathname.split('/').pop()}`);
      return ok({});
    }
    return new Response('[]', { status: 200, headers: JSON_HEADERS });
  }) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

type Handler = (req: Request) => Promise<Response>;
let handler: Handler | undefined;
async function load(): Promise<Handler> {
  if (handler) return handler;
  let captured: Handler | undefined;
  const original = Deno.serve;
  // deno-lint-ignore no-explicit-any
  (Deno as any).serve = (h: Handler) => { captured = h; return {}; };
  try {
    await import(new URL('../functions/heal-account-deletions/index.ts', import.meta.url).href);
  } finally {
    Deno.serve = original;
  }
  assert(captured, 'index.ts did not call Deno.serve');
  handler = captured;
  return handler;
}

const call = (h: Handler, headers: Record<string, string> = { apikey: CRON_KEY }) =>
  h(new Request('http://localhost/fn', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}' }));

async function run<T>(fake: Fake, fn: () => Promise<T>): Promise<T> {
  const restore = install(fake);
  const o = { log: console.log, error: console.error, warn: console.warn };
  console.log = console.error = console.warn = () => {};
  try { return await fn(); } finally { restore(); Object.assign(console, o); }
}

const HEAL_ONE = { scrubbed: [], scrub_results: [], scrub_errors: [], auth_delete: [A], apple_pending: [], apple_unrevoked: [], purged: 0 };

Deno.test('no apikey / a wrong apikey → 401 and NO status row (a caller cannot forge or spam them)', async () => {
  const h = await load();
  for (const headers of [{} as Record<string, string>, { apikey: 'nope' }]) {
    const fake = new Fake();
    const res = await run(fake, () => call(h, headers));
    assertEquals(res.status, 401);
    assertEquals(fake.statusWrites, []);
    assertEquals(fake.calls, []);
  }
});

Deno.test('a scrubbed row: auth user deleted BEFORE mark_done, mark_done says done → running then success work=1', async () => {
  const h = await load();
  const fake = new Fake();
  fake.rpc.heal_account_deletions = () => ok(HEAL_ONE);
  fake.rpc.account_deletion_mark_done = () => ok({ stage: 'done' });
  const res = await run(fake, () => call(h));
  assertEquals(res.status, 200);
  assertEquals(fake.calls, ['rpc:heal_account_deletions', `auth-delete:${A}`, 'rpc:account_deletion_mark_done']);
  assertEquals(fake.statusWrites, ['running', 'success']);
  assert(fake.row()!.error_message!.startsWith('work=1 '), fake.row()!.error_message ?? 'null');
  assertEquals((await res.json()).ok, true);
});

Deno.test('mark_done refusing (the database still sees the auth user) → FAILED, never success', async () => {
  const h = await load();
  const fake = new Fake();
  fake.rpc.heal_account_deletions = () => ok(HEAL_ONE);
  fake.rpc.account_deletion_mark_done = () => ok({ stage: 'scrubbed' });
  const res = await run(fake, () => call(h));
  assertEquals(fake.statusWrites, ['running', 'failed']);
  assertEquals(fake.row()!.status, 'failed');
  assertEquals((await res.json()).ok, false);
});

Deno.test('the heal RPC erroring → HTTP 500 and running then failed (never stranded at running)', async () => {
  const h = await load();
  const fake = new Fake();
  fake.rpc.heal_account_deletions = () =>
    new Response(JSON.stringify({ message: 'boom', code: '42883' }), { status: 404, headers: JSON_HEADERS });
  const res = await run(fake, () => call(h));
  assertEquals(res.status, 500);
  assertEquals(fake.statusWrites, ['running', 'failed']);
  assert(fake.row()!.error_message!.startsWith('heal_account_deletions failed'));
});

Deno.test('a scrub that FAILED in W2\'s SQL (scrub_errors array) is a failed run through the real handler, never success', async () => {
  const h = await load();
  const fake = new Fake();
  fake.rpc.heal_account_deletions = () => ok({
    ...HEAL_ONE, auth_delete: [], scrub_errors: [{ user_id: A, error: 'deadlock detected' }],
  });
  const res = await run(fake, () => call(h));
  assertEquals(fake.statusWrites, ['running', 'failed']);
  assertEquals(fake.row()!.status, 'failed');
  assertEquals((await res.json()).ok, false);
});

Deno.test('nothing to heal → running then success work=0', async () => {
  const h = await load();
  const fake = new Fake();
  fake.rpc.heal_account_deletions = () => ok({ scrubbed: [], scrub_results: [], scrub_errors: [], auth_delete: [], apple_pending: [], apple_unrevoked: [], purged: 0 });
  await run(fake, () => call(h));
  assertEquals(fake.statusWrites, ['running', 'success']);
  assert(fake.row()!.error_message!.startsWith('work=0'));
});

Deno.test('restore env', () => {
  for (const [k, v] of SAVED_ENV) {
    if (v === undefined) Deno.env.delete(k);
    else Deno.env.set(k, v);
  }
});
