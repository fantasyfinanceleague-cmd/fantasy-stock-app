/**
 * Handler-level proof that every exit of the cron handlers ends in a terminal,
 * truthful cron_job_status — run against the REAL index.ts files, not a copy.
 *
 * HOW: Deno.serve is replaced for the duration of each import so the handler is
 * captured instead of served, and globalThis.fetch is replaced by a fake PostgREST
 * (an in-memory cron_job_status table; every other table reads as empty). supabase-js
 * builds real requests against it, so the status writes are the real writer's.
 *
 * WHY THIS FILE EXISTS (CLAUDE.md "Success signals" #6): process-week-results wrote
 * 'running' and then had returns that never wrote a terminal status, so its row
 * stayed 'running' forever; and its unconditional upsert let a no-op 22:00Z heal
 * erase the 21:15Z run's "processed N". The fixes are each pinned below, and the
 * mutation checks in the PR description show these tests fail without them.
 *
 * Run (the handlers import jsr:@supabase/supabase-js, and the tests set env):
 *   deno test --allow-read --allow-env --no-check supabase/tests/cron_status_handlers.test.ts
 * `--no-check`: process-week-results/index.ts has 10 pre-existing type errors
 * (STATUS.md §4 item 14) that a type-checking import would trip. The plain
 * `deno test --allow-read --allow-env supabase/tests/` run does not type-check
 * the dynamically imported handlers, so it works without the flag too.
 */
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert';

const CRON_KEY = 'test-cron-key-not-a-secret';
Deno.env.set('SB_SECRET_KEY_CRON', CRON_KEY);
Deno.env.set('SUPABASE_URL', 'http://stub.supabase.test');
Deno.env.set('SB_SECRET_KEY_INTERNAL', 'test-internal-key-not-a-secret');
Deno.env.set('ALPACA_API_KEY', 'test-alpaca-id');
Deno.env.set('ALPACA_API_SECRET', 'test-alpaca-secret');

// ---------------------------------------------------------------------------
// Fake PostgREST
// ---------------------------------------------------------------------------

interface Row {
  job_name: string;
  run_date: string;
  status: string;
  attempt_number: number;
  error_message: string | null;
}
interface Req { method: string; url: URL; body: unknown }
type Route = (req: Req) => Response | undefined;

class Fake {
  rows = new Map<string, Row>();
  /** every cron_job_status POST, in order */
  statusWrites: string[] = [];
  /** every rpc called, by name */
  rpcs: string[] = [];
  route: Route = () => undefined;
  /** make the cron_job_status upsert itself fail (resolved error, not a throw) */
  rejectStatusWrites = false;

  today = () => new Date().toISOString().split('T')[0];
  key = (job: string) => `${job}|${this.today()}`;
  seed(job: string, status: string, error_message: string | null) {
    this.rows.set(this.key(job), {
      job_name: job, run_date: this.today(), status, attempt_number: 1, error_message,
    });
  }
  row(job: string): Row | undefined { return this.rows.get(this.key(job)); }
}

const JSON_HEADERS = { 'content-type': 'application/json', 'content-range': '*/0' };

function install(fake: Fake): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const req = input instanceof Request ? input : null;
    const url = new URL(req ? req.url : String(input));
    const method = (req?.method ?? init?.method ?? 'GET').toUpperCase();
    const raw = req ? await req.text() : (init?.body as string | undefined);
    const body = raw ? JSON.parse(raw) : undefined;

    const custom = fake.route({ method, url, body });
    if (custom) return custom;

    if (url.pathname === '/rest/v1/cron_job_status') {
      if (method === 'POST') {
        if (fake.rejectStatusWrites) {
          return new Response(JSON.stringify({ message: 'violates check constraint' }), { status: 400, headers: JSON_HEADERS });
        }
        const r = body as Row;
        fake.statusWrites.push(r.status);
        fake.rows.set(`${r.job_name}|${r.run_date}`, { ...r });
        return new Response(null, { status: 201 });
      }
      const job = url.searchParams.get('job_name')?.replace('eq.', '') ?? '';
      const date = url.searchParams.get('run_date')?.replace('eq.', '') ?? '';
      const row = fake.rows.get(`${job}|${date}`);
      return new Response(JSON.stringify(row ? [row] : []), { status: 200, headers: JSON_HEADERS });
    }
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      fake.rpcs.push(url.pathname.split('/').pop()!);
      return new Response('null', { status: 200, headers: JSON_HEADERS });
    }
    // Any other table reads as empty.
    return new Response('[]', { status: 200, headers: JSON_HEADERS });
  }) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

// ---------------------------------------------------------------------------
// Handler loading
// ---------------------------------------------------------------------------

type Handler = (req: Request) => Promise<Response>;
const handlers = new Map<string, Handler>();

async function load(fn: string): Promise<Handler> {
  const cached = handlers.get(fn);
  if (cached) return cached;
  let captured: Handler | undefined;
  const original = Deno.serve;
  // deno-lint-ignore no-explicit-any
  (Deno as any).serve = (h: Handler) => { captured = h; return {}; };
  try {
    await import(new URL(`../functions/${fn}/index.ts`, import.meta.url).href);
  } finally {
    Deno.serve = original;
  }
  assert(captured, `${fn}: index.ts did not call Deno.serve`);
  handlers.set(fn, captured);
  return captured;
}

function call(h: Handler, headers: Record<string, string> = {}): Promise<Response> {
  return h(new Request('http://localhost/fn', {
    method: 'POST',
    headers: { apikey: CRON_KEY, 'content-type': 'application/json', ...headers },
    body: '{}',
  }));
}

/** Quiet the handlers' own console noise; restore after. */
async function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const o = { log: console.log, error: console.error, warn: console.warn };
  console.log = console.error = console.warn = () => {};
  try { return await fn(); } finally { Object.assign(console, o); }
}

async function run<T>(fake: Fake, fn: () => Promise<T>): Promise<T> {
  const restore = install(fake);
  try { return await quiet(fn); } finally { restore(); }
}

const isPendingQuery = (r: Req) =>
  r.url.pathname === '/rest/v1/matchups' && (r.url.searchParams.get('select') ?? '').includes('leagues!inner');

const PWR = 'process-week-results';

// ---------------------------------------------------------------------------
// process-week-results
// ---------------------------------------------------------------------------

Deno.test('process-week-results: no pending matchups → running then success work=0 (never stranded)', async () => {
  const h = await load(PWR);
  const fake = new Fake();
  const res = await run(fake, () => call(h));
  assertEquals(res.status, 200);
  assertEquals(fake.statusWrites, ['running', 'success']);
  const row = fake.row(PWR)!;
  assertEquals(row.status, 'success');
  assert(row.error_message!.startsWith('work=0 processed 0 matchups: no pending matchups'), row.error_message ?? 'null');
});

Deno.test('process-week-results: the matchup query failing → running then failed, HTTP 500', async () => {
  const h = await load(PWR);
  const fake = new Fake();
  fake.route = (r) => isPendingQuery(r)
    ? new Response(JSON.stringify({ message: 'boom', code: 'XX000' }), { status: 500, headers: JSON_HEADERS })
    : undefined;
  const res = await run(fake, () => call(h));
  assertEquals(res.status, 500);
  assertEquals(fake.statusWrites, ['running', 'failed']);
  assert(fake.row(PWR)!.error_message!.startsWith('Failed to fetch matchups:'));
});

Deno.test('process-week-results: an unhandled throw → running then failed, HTTP 500', async () => {
  const h = await load(PWR);
  const fake = new Fake();
  // A null row makes isScoreableNow throw inside the body: the catch path.
  fake.route = (r) => isPendingQuery(r)
    ? new Response('[null]', { status: 200, headers: JSON_HEADERS })
    : undefined;
  const res = await run(fake, () => call(h));
  assertEquals(res.status, 500);
  assertEquals(fake.statusWrites, ['running', 'failed']);
  assertEquals(fake.row(PWR)!.status, 'failed');
});

Deno.test('process-week-results F2: a no-op heal does NOT overwrite the 21:15Z run\'s "processed N"', async () => {
  const h = await load(PWR);
  const fake = new Fake();
  const friday = 'work=5 processed 5 matchups; 0 refused by eligibility guards (batches or matchups, left pending)';
  fake.seed(PWR, 'success', friday);
  const res = await run(fake, () => call(h));
  assertEquals(res.status, 200);
  assertEquals(fake.statusWrites, [], 'the heal wrote nothing over real work');
  assertEquals(fake.row(PWR)!.error_message, friday);
});

Deno.test('process-week-results F2: a no-op heal does NOT erase an earlier failure', async () => {
  const h = await load(PWR);
  const fake = new Fake();
  fake.seed(PWR, 'failed', 'Failed to fetch matchups: boom');
  const res = await run(fake, () => call(h));
  assertEquals(res.status, 200);
  assertEquals(fake.statusWrites, []);
  assertEquals(fake.row(PWR)!.status, 'failed');
});

Deno.test('process-week-results: a stranded same-day running row is healed by the next run', async () => {
  const h = await load(PWR);
  const fake = new Fake();
  fake.seed(PWR, 'running', null);
  await run(fake, () => call(h));
  assertEquals(fake.row(PWR)!.status, 'success');
});

Deno.test('process-week-results: a REJECTED status write cannot change the HTTP response', async () => {
  const h = await load(PWR);
  const fake = new Fake();
  fake.rejectStatusWrites = true;
  const res = await run(fake, () => call(h));
  assertEquals(res.status, 200, 'telemetry failure must not turn a clean run into an error');
});

Deno.test('process-week-results: unauthenticated → 401 and NO status row (no forged rows)', async () => {
  const h = await load(PWR);
  const fake = new Fake();
  const res = await run(fake, () => call(h, { apikey: 'wrong' }));
  assertEquals(res.status, 401);
  assertEquals(fake.statusWrites, []);
  assertEquals(fake.rows.size, 0);
});

// ---------------------------------------------------------------------------
// snapshot-week-start / snapshot-week-end
// ---------------------------------------------------------------------------

for (const fn of ['snapshot-week-start', 'snapshot-week-end']) {
  Deno.test(`${fn}: no active leagues → running then success work=0`, async () => {
    const h = await load(fn);
    const fake = new Fake();
    const res = await run(fake, () => call(h));
    assertEquals(res.status, 200);
    assertEquals(fake.statusWrites, ['running', 'success']);
    assert(fake.row(fn)!.error_message!.startsWith('work=0'));
  });

  Deno.test(`${fn}: a no-op run does not overwrite earlier same-day work`, async () => {
    const h = await load(fn);
    const fake = new Fake();
    fake.seed(fn, 'success', 'work=4');
    await run(fake, () => call(h));
    assertEquals(fake.statusWrites, []);
    assertEquals(fake.row(fn)!.error_message, 'work=4');
  });

  Deno.test(`${fn}: a throw on attempt 1 schedules a retry and ends 'retrying' (not stranded)`, async () => {
    const h = await load(fn);
    const fake = new Fake();
    fake.route = (r) => r.url.pathname === '/rest/v1/market_calendar'
      ? new Response(JSON.stringify({ message: 'calendar down' }), { status: 500, headers: JSON_HEADERS })
      : undefined;
    const res = await run(fake, () => call(h));
    assertEquals(res.status, 500);
    assertEquals(fake.rpcs, ['schedule_snapshot_retry']);
    assertEquals(fake.statusWrites, ['running', 'retrying']);
  });

  Deno.test(`${fn}: a throw when the retry cannot be scheduled ends 'failed'`, async () => {
    const h = await load(fn);
    const fake = new Fake();
    fake.route = (r) => {
      if (r.url.pathname === '/rest/v1/market_calendar') {
        return new Response(JSON.stringify({ message: 'calendar down' }), { status: 500, headers: JSON_HEADERS });
      }
      if (r.url.pathname === '/rest/v1/rpc/schedule_snapshot_retry') {
        return new Response(JSON.stringify({ message: 'cron.schedule failed' }), { status: 400, headers: JSON_HEADERS });
      }
      return undefined;
    };
    await run(fake, () => call(h));
    assertEquals(fake.statusWrites, ['running', 'failed']);
    assertEquals(fake.row(fn)!.error_message, 'retry could not be scheduled');
  });

  Deno.test(`${fn}: a throw on the last attempt ends 'failed' without scheduling`, async () => {
    const h = await load(fn);
    const fake = new Fake();
    fake.route = (r) => r.url.pathname === '/rest/v1/market_calendar'
      ? new Response(JSON.stringify({ message: 'calendar down' }), { status: 500, headers: JSON_HEADERS })
      : undefined;
    const res = await run(fake, () => call(h, { 'X-Retry-Attempt': '3' }));
    assertEquals(res.status, 500);
    assertEquals(fake.rpcs, []);
    assertEquals(fake.statusWrites, ['running', 'failed']);
    assertFalse((await res.clone().text()).includes('calendar down'), 'internal error text must not reach the cron caller');
  });
}

// ---------------------------------------------------------------------------
// refresh-market-calendar (the new status row)
// ---------------------------------------------------------------------------

const RMC = 'refresh-market-calendar';

function alpaca(fake: Fake, respond: (r: Req) => Response) {
  const prev = fake.route;
  fake.route = (r) => r.url.hostname === 'paper-api.alpaca.markets' ? respond(r) : prev(r);
}

Deno.test('refresh-market-calendar: unauthenticated → 401, no row', async () => {
  const h = await load(RMC);
  const fake = new Fake();
  const res = await run(fake, () => call(h, { apikey: 'wrong' }));
  assertEquals(res.status, 401);
  assertEquals(fake.rows.size, 0);
});

Deno.test('refresh-market-calendar: Alpaca 401 → running then failed alpaca_fetch_failed (never "no sessions")', async () => {
  const h = await load(RMC);
  const fake = new Fake();
  alpaca(fake, () => new Response('forbidden', { status: 401 }));
  const res = await run(fake, () => call(h));
  assertEquals(res.status, 502);
  assertEquals(fake.statusWrites, ['running', 'failed']);
  assertEquals(fake.row(RMC)!.error_message, 'alpaca_fetch_failed status=401');
  assertEquals(fake.rpcs, [], 'nothing was applied');
});

Deno.test('refresh-market-calendar: an implausible 200 body → failed, nothing applied', async () => {
  const h = await load(RMC);
  const fake = new Fake();
  alpaca(fake, () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }));
  const res = await run(fake, () => call(h));
  assertEquals(res.status, 502);
  assertEquals(fake.statusWrites, ['running', 'failed']);
  assertEquals(fake.rpcs, []);
});
