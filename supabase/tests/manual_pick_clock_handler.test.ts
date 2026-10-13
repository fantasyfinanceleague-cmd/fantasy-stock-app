/**
 * Handler-level proof that validate-and-record-pick refuses a manager's OWN
 * pick (action:'pick') once their clock has expired — and that it does so
 * BEFORE any Alpaca call or write. Runs the REAL index.ts, not a copy.
 *
 * WHY (Giorgio, 2026-10-13, docs/PRODUCT_RULES.md › Draft): only action:'auto_pick'
 * read the clock, so after a manager's clock ran out the server still accepted
 * their pick until the auto-pick committed — about 0–3 s with a room connected,
 * up to the sweep interval with none, and as long as a modified client liked
 * if it never sent auto_pick. "A missed turn is always auto-picked."
 *
 * HOW (cron_status_handlers.test.ts pattern): Deno.serve is captured on import,
 * and globalThis.fetch is a fake PostgREST + GoTrue + Alpaca. The league has two
 * members, u1 then u2; u1 is the caller. The clock row is the fixture, so
 * server_now is set per test — the real wall clock is never read by the gate.
 *
 * Run: deno test --allow-read --allow-env supabase/tests/manual_pick_clock_handler.test.ts
 */
import { assert, assertEquals } from 'jsr:@std/assert';

const FAKE_ENV: Record<string, string> = {
  SUPABASE_URL: 'http://stub.supabase.test',
  SB_PUBLISHABLE_KEY: 'test-publishable-key-not-a-secret',
  SB_SECRET_KEY_INTERNAL: 'test-internal-key-not-a-secret',
  ALPACA_API_KEY: 'test-alpaca-id',
  ALPACA_API_SECRET: 'test-alpaca-secret',
};
const SAVED_ENV = new Map(Object.keys(FAKE_ENV).map((k) => [k, Deno.env.get(k)]));
for (const [k, v] of Object.entries(FAKE_ENV)) Deno.env.set(k, v);

const LEAGUE = '00000000-0000-4000-8000-000000000001';
const DEADLINE = '2026-10-13T12:01:00.000Z';
const JSON_HEADERS = { 'content-type': 'application/json' };

interface Clock {
  draft_status: string;
  clock_running: boolean;
  pick_seconds: number;
  picks_made: number;
  turn_started_at: string | null;
  deadline_at: string | null;
  server_now: string;
}

class Fake {
  picks: Record<string, unknown>[] = [];
  clock: Clock | 'error' = clockAt(DEADLINE);
  alpacaCalls = 0;
  rpcs: string[] = [];
  /** every write (POST/PATCH/DELETE) to a table, as "METHOD table" */
  writes: string[] = [];
}

function clockAt(serverNow: string, o: Partial<Clock> = {}): Clock {
  return {
    draft_status: 'in_progress',
    clock_running: true,
    pick_seconds: 60,
    picks_made: 0,
    turn_started_at: '2026-10-13T12:00:00.000Z',
    deadline_at: DEADLINE,
    server_now: serverNow,
    ...o,
  };
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: JSON_HEADERS });

function install(fake: Fake): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const req = input instanceof Request ? input : null;
    const url = new URL(req ? req.url : String(input));
    const method = (req?.method ?? init?.method ?? 'GET').toUpperCase();
    const accept = (req?.headers.get('accept') ?? new Headers(init?.headers).get('accept') ?? '');

    if (url.hostname.endsWith('alpaca.markets')) {
      fake.alpacaCalls++;
      return new Response('{"message":"stub"}', { status: 500, headers: JSON_HEADERS });
    }
    if (url.pathname === '/auth/v1/user') {
      return ok({ id: 'u1', aud: 'authenticated', role: 'authenticated', email: 'u1@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' });
    }
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const name = url.pathname.split('/').pop()!;
      fake.rpcs.push(name);
      if (name === 'check_and_bump_rate_limit') return ok(true);
      if (name === 'get_draft_clock') {
        return fake.clock === 'error'
          ? new Response(JSON.stringify({ message: 'boom', code: 'XX000' }), { status: 500, headers: JSON_HEADERS })
          : ok([{ league_id: LEAGUE, ...fake.clock }]);
      }
      return ok(null);
    }
    const table = url.pathname.replace('/rest/v1/', '');
    if (method !== 'GET' && method !== 'HEAD') {
      fake.writes.push(`${method} ${table}`);
      return new Response(JSON.stringify({ message: 'writes are not expected here' }), { status: 400, headers: JSON_HEADERS });
    }
    const rows: Record<string, unknown[]> = {
      leagues: [{
        id: LEAGUE, name: 'L', commissioner_id: 'u1', num_rounds: 6, draft_status: 'in_progress',
        stake_mode: null, budget_amount: null, notional_per_slot: null, allow_undraftable: false,
        league_type: 'season', num_weeks: null, duration_days: null, playoff_teams: null,
      }],
      league_members: [{ user_id: 'u1' }, { user_id: 'u2' }],
      league_draft_order: [{ position: 1, user_id: 'u1' }, { position: 2, user_id: 'u2' }],
      drafts: fake.picks,
    };
    const body = rows[table] ?? [];
    if (accept.includes('vnd.pgrst.object')) return ok(body[0] ?? null);
    return ok(body);
  }) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

type Handler = (req: Request) => Promise<Response>;
let cached: Handler | undefined;
async function load(): Promise<Handler> {
  if (cached) return cached;
  let captured: Handler | undefined;
  const original = Deno.serve;
  // deno-lint-ignore no-explicit-any
  (Deno as any).serve = (h: Handler) => { captured = h; return {}; };
  try {
    await import(new URL('../functions/validate-and-record-pick/index.ts', import.meta.url).href);
  } finally {
    Deno.serve = original;
  }
  assert(captured, 'validate-and-record-pick/index.ts did not call Deno.serve');
  cached = captured;
  return captured;
}

async function call(fake: Fake, body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  const h = await load();
  const restore = install(fake);
  const o = { log: console.log, error: console.error, warn: console.warn };
  console.log = console.error = console.warn = () => {};
  try {
    const res = await h(new Request('http://localhost/fn', {
      method: 'POST',
      headers: { authorization: 'Bearer test-user-jwt', 'content-type': 'application/json' },
      body: JSON.stringify({ league_id: LEAGUE, ...body }),
    }));
    return { status: res.status, json: await res.json() };
  } finally {
    Object.assign(console, o);
    restore();
  }
}

const pick = (fake: Fake) => call(fake, { symbol: 'AAPL' });

// ---------------------------------------------------------------------------

Deno.test('expired: past deadline + 2 s -> pick_clock_expired, with no Alpaca call and no write', async () => {
  const fake = new Fake();
  fake.clock = clockAt('2026-10-13T12:01:02.000Z');
  const r = await pick(fake);
  assertEquals(r.status, 200);
  assertEquals(r.json, { ok: false, reason: 'pick_clock_expired', deadline_at: DEADLINE, server_now: '2026-10-13T12:01:02.000Z' });
  assertEquals(fake.alpacaCalls, 0);
  assertEquals(fake.writes, []);
});

Deno.test('expired long ago (a stalled turn keeps its deadline) -> still refused before Alpaca', async () => {
  const fake = new Fake();
  fake.clock = clockAt('2026-10-13T13:00:00.000Z');
  const r = await pick(fake);
  assertEquals(r.json.reason, 'pick_clock_expired');
  assertEquals(fake.alpacaCalls, 0);
  assertEquals(fake.writes, []);
});

Deno.test('within the grace (deadline + 1.9 s) -> passes the clock and goes on to price the pick', async () => {
  const fake = new Fake();
  fake.clock = clockAt('2026-10-13T12:01:01.900Z');
  const r = await pick(fake);
  assert(r.json.reason !== 'pick_clock_expired', JSON.stringify(r.json));
  assert(fake.alpacaCalls > 0, 'the pick was never priced: the clock gate refused it');
  assert(fake.rpcs.includes('get_draft_clock'));
});

Deno.test('before the deadline -> passes the clock and goes on to price the pick', async () => {
  const fake = new Fake();
  fake.clock = clockAt('2026-10-13T12:00:30.000Z');
  const r = await pick(fake);
  assert(r.json.reason !== 'pick_clock_expired', JSON.stringify(r.json));
  assert(fake.alpacaCalls > 0);
});

Deno.test('unclocked draft (clock_running false) -> no deadline, the pick goes on', async () => {
  const fake = new Fake();
  fake.clock = clockAt('2026-10-13T13:00:00.000Z', { clock_running: false, turn_started_at: null, deadline_at: null });
  const r = await pick(fake);
  assert(r.json.reason !== 'pick_clock_expired', JSON.stringify(r.json));
  assert(fake.alpacaCalls > 0);
});

Deno.test('the clock read failing -> 500 unhandled (fail CLOSED), no Alpaca call, no write', async () => {
  const fake = new Fake();
  fake.clock = 'error';
  const r = await pick(fake);
  assertEquals(r.status, 500);
  assertEquals(r.json, { ok: false, reason: 'unhandled' });
  assertEquals(fake.alpacaCalls, 0);
  assertEquals(fake.writes, []);
});

Deno.test('a pick landed between the reads (clock is for a later pick) -> pick_conflict, no Alpaca call', async () => {
  const fake = new Fake();
  fake.clock = clockAt('2026-10-13T13:00:00.000Z', { picks_made: 1 });
  const r = await pick(fake);
  assertEquals(r.json, { ok: false, reason: 'pick_conflict' });
  assertEquals(fake.alpacaCalls, 0);
  assertEquals(fake.writes, []);
});

Deno.test('not your turn -> not_your_turn, never "your clock expired", and no clock read or Alpaca call', async () => {
  const fake = new Fake();
  // Pick 1 made (u1); pick 2 is u2's. Their clock is long expired.
  fake.picks = [{ user_id: 'u1', symbol: 'MSFT', entry_price: 400, quantity: 1, pick_number: 1, slot_id: null }];
  fake.clock = clockAt('2026-10-13T13:00:00.000Z', { picks_made: 1 });
  const r = await pick(fake);
  assertEquals(r.json, { ok: false, reason: 'not_your_turn' });
  assertEquals(fake.rpcs.includes('get_draft_clock'), false);
  assertEquals(fake.alpacaCalls, 0);
});

Deno.test('restore env', () => {
  for (const [k, v] of SAVED_ENV) {
    if (v === undefined) Deno.env.delete(k);
    else Deno.env.set(k, v);
  }
});
