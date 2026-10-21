/**
 * Handler-level proof that the sweep keeps an UNCLOCKED draft moving when the current
 * picker is a DELETED seat, and never touches a live manager's seat: the REAL
 * draft-autopick-sweep/index.ts with Deno.serve captured and fetch faked as PostgREST.
 *
 * "Reached the auto-pick" is observed as the sweep's first auto-pick read:
 * GET draft_stalls (autoPickTurn's recentStall), which nothing else in the sweep does.
 * The pick's legality and writing are the existing, separately tested autoPickTurn path;
 * what this file pins is the ROUTING decision the new pass makes:
 *   - the current picker is a deleted seat, draft unclocked        -> auto-pick reached
 *   - the current picker is LIVE (a deleted seat elsewhere in it)  -> never reached
 *   - the deleted_at read errors                                   -> never reached, reported as an error
 *   - a clocked draft's deleted seat                               -> unchanged (not this pass)
 *   - the list rpc failing does not break the sweep's other passes
 *
 *   deno test --allow-read --allow-env --no-check supabase/tests/draft_autopick_sweep_deleted_seat.test.ts
 */
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert';

const FAKE_ENV: Record<string, string> = {
  SB_SECRET_KEY_CRON: 'test-cron-key-not-a-secret',
  SUPABASE_URL: 'http://stub.supabase.test',
  SB_SECRET_KEY_INTERNAL: 'test-internal-key-not-a-secret',
  ALPACA_API_KEY: 'test-alpaca-id',
  ALPACA_API_SECRET: 'test-alpaca-secret',
};
const SAVED_ENV = new Map(Object.keys(FAKE_ENV).map((k) => [k, Deno.env.get(k)]));
for (const [k, v] of Object.entries(FAKE_ENV)) Deno.env.set(k, v);

const LEAGUE = '33333333-3333-4333-8333-333333333333';
const JSON_HEADERS = { 'content-type': 'application/json', 'content-range': '*/0' };
const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: JSON_HEADERS });
const err = () => new Response(JSON.stringify({ message: 'boom', code: 'XX000' }), { status: 500, headers: JSON_HEADERS });

interface Member { user_id: string; deleted_at: string | null }

class Fake {
  members: Member[] = [{ user_id: 'u1', deleted_at: null }, { user_id: 'u2', deleted_at: null }];
  order = ['u1', 'u2'];
  picksMade = 0;
  clockRunning = false;
  deadlineAt: string | null = null;
  /** the rows unclocked_deleted_seat_turns() returns; null = derive from picksMade (the usual case) */
  listed: Array<{ league_id: string; pick_number: number }> | null = null;
  listFails = false;
  seatReadFails = false;
  /** every request, 'METHOD path' (rpc as rpc:<name>) */
  seen: string[] = [];
  /** every deleted_at read: which league and which user it asked about */
  seatReads: Array<{ league: string | undefined; user: string | undefined }> = [];

  reached = () => this.seen.includes('GET /rest/v1/draft_stalls');
}

function install(f: Fake): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const req = input instanceof Request ? input : null;
    const url = new URL(req ? req.url : String(input));
    const method = (req?.method ?? init?.method ?? 'GET').toUpperCase();
    const p = url.pathname;
    const eq = (col: string) => url.searchParams.get(col)?.replace('eq.', '');

    if (p.startsWith('/rest/v1/rpc/')) {
      const name = p.split('/').pop()!;
      f.seen.push(`rpc:${name}`);
      switch (name) {
        case 'due_draft_starts':
        case 'draft_watch_due':
        case 'overdue_draft_turns':
          return ok([]);
        case 'unclocked_deleted_seat_turns':
          return f.listFails ? err() : ok(f.listed ?? [{ league_id: LEAGUE, pick_number: f.picksMade + 1 }]);
        case 'get_draft_clock':
          return ok([{
            league_id: LEAGUE, draft_status: 'in_progress', clock_running: f.clockRunning, pick_seconds: 60,
            picks_made: f.picksMade, turn_started_at: null, deadline_at: f.deadlineAt, server_now: new Date().toISOString(),
          }]);
        default:
          return err(); // anything the pick itself would call: it stops there
      }
    }
    f.seen.push(`${method} ${p}`);
    if (p === '/rest/v1/leagues') {
      return ok([{
        id: LEAGUE, name: 'L', commissioner_id: 'u1', num_rounds: 2, draft_status: 'in_progress', stake_mode: null,
        budget_amount: null, notional_per_slot: null, allow_undraftable: false, league_type: 'standard',
        num_weeks: 8, duration_days: 56, playoff_teams: 2,
      }]);
    }
    if (p === '/rest/v1/league_members') {
      if (url.searchParams.get('select') === 'deleted_at') {
        f.seatReads.push({ league: eq('league_id'), user: eq('user_id') });
        if (f.seatReadFails) return err();
        const m = f.members.find((x) => x.user_id === eq('user_id'));
        return ok(m ? [{ deleted_at: m.deleted_at }] : []);
      }
      return ok(f.members.map((m) => ({ user_id: m.user_id })));
    }
    if (p === '/rest/v1/league_draft_order') return ok(f.order.map((user_id, i) => ({ position: i + 1, user_id })));
    if (p === '/rest/v1/drafts') {
      return ok(Array.from({ length: f.picksMade }, (_, i) => ({
        user_id: f.order[i % f.order.length], symbol: `S${i}`, entry_price: 1, quantity: 1, pick_number: i + 1, slot_id: null,
      })));
    }
    return ok([]);
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
    await import(new URL('../functions/draft-autopick-sweep/index.ts', import.meta.url).href);
  } finally {
    Deno.serve = original;
  }
  assert(captured, 'index.ts did not call Deno.serve');
  handler = captured;
  return handler;
}

// deno-lint-ignore no-explicit-any
async function sweep(f: Fake): Promise<any> {
  const h = await load();
  const restore = install(f);
  const o = { log: console.log, error: console.error, warn: console.warn };
  console.log = console.error = console.warn = () => {};
  try {
    const res = await h(new Request('http://localhost/fn', {
      method: 'POST',
      headers: { apikey: 'test-cron-key-not-a-secret', 'content-type': 'application/json' },
      body: '{}',
    }));
    return await res.json();
  } finally {
    restore();
    Object.assign(console, o);
  }
}

// deno-lint-ignore no-explicit-any
const outcomes = (r: any): string[] => [...(r.results ?? []), ...(r.errors ?? [])].map((x: { outcome: string }) => x.outcome);

Deno.test('an unclocked draft whose current picker is a DELETED seat reaches the auto-pick', async () => {
  const f = new Fake();
  f.members[0].deleted_at = '2026-10-21T00:00:00Z'; // u1 picks first
  const r = await sweep(f);
  assert(f.reached(), `the sweep never reached autoPickTurn: ${f.seen.join(', ')}`);
  assertEquals(r.ok, true);
  assertEquals(r.deleted_seat_total, 1);
});

Deno.test('the seat read asks about THIS league and THIS turn\'s picker, and only that', async () => {
  const f = new Fake();
  f.members[0].deleted_at = '2026-10-21T00:00:00Z';
  await sweep(f);
  assertEquals(f.seatReads, [{ league: LEAGUE, user: 'u1' }]);
  const g = new Fake();
  g.picksMade = 1; // u2 is up
  await sweep(g);
  assertEquals(g.seatReads, [{ league: LEAGUE, user: 'u2' }]);
});

Deno.test('a LIVE manager in an unclocked draft is never auto-picked, even with a deleted seat elsewhere in it', async () => {
  const f = new Fake();
  f.members[1].deleted_at = '2026-10-21T00:00:00Z'; // u2 is deleted, but it is u1's turn
  const r = await sweep(f);
  assertFalse(f.reached(), 'a live seat must never be auto-picked');
  assert(outcomes(r).includes('seat_live'), JSON.stringify(r));
});

Deno.test("the deleted seat's turn comes round: after u1 picks, it is u2's turn and u2 (deleted) is picked for", async () => {
  const f = new Fake();
  f.members[1].deleted_at = '2026-10-21T00:00:00Z';
  f.picksMade = 1; // u1 has picked; u2 is up
  await sweep(f);
  assert(f.reached());
});

Deno.test('snake order: round two reverses, so the deleted seat is judged on the right turn', async () => {
  const f = new Fake();
  f.members[0].deleted_at = '2026-10-21T00:00:00Z'; // u1 deleted
  f.picksMade = 2; // round 2 starts reversed: u2 first, then u1
  await sweep(f);
  assertFalse(f.reached(), "pick 3 is u2's (live)");
  const g = new Fake();
  g.members[0].deleted_at = '2026-10-21T00:00:00Z';
  g.picksMade = 3; // pick 4: u1
  await sweep(g);
  assert(g.reached());
});

Deno.test('a FULL unclocked draft (listed one past the last pick) has no picker: nothing to do, and it is NOT finalized by this pass', async () => {
  const f = new Fake();
  f.members[0].deleted_at = '2026-10-21T00:00:00Z';
  f.picksMade = 4; // 2 managers x 2 rounds: every pick made
  f.listed = [{ league_id: LEAGUE, pick_number: 5 }];
  const r = await sweep(f);
  assertFalse(f.reached(), 'no picker, no auto-pick');
  assert(outcomes(r).includes('no_turn'), JSON.stringify(r));
  assertFalse(outcomes(r).some((o) => o.startsWith('finalize')), 'finalizing is not this pass\'s job');
  assertFalse(f.seen.some((s) => s.includes('league_seasons') || s.includes('rpc:finalize')), f.seen.join(', '));
});

Deno.test('an unreadable deleted_at is never a pick, and is reported as an error (not silently skipped)', async () => {
  const f = new Fake();
  f.members[0].deleted_at = '2026-10-21T00:00:00Z';
  f.seatReadFails = true;
  const r = await sweep(f);
  assertFalse(f.reached());
  assert((r.errors ?? []).some((e: { outcome: string }) => e.outcome === 'seat_read_failed'), JSON.stringify(r));
});

Deno.test("a CLOCKED draft's deleted seat is not this pass's business: the clock still decides", async () => {
  const f = new Fake();
  f.members[0].deleted_at = '2026-10-21T00:00:00Z';
  f.clockRunning = true;
  f.deadlineAt = new Date(Date.now() + 3_600_000).toISOString(); // an hour left
  await sweep(f);
  assertFalse(f.reached(), 'the clock has not expired: nothing to pick');
});

Deno.test('a STALE row (the draft moved on since the list) is never acted on: the next tick names the new turn', async () => {
  const f = new Fake();
  f.members[0].deleted_at = '2026-10-21T00:00:00Z'; // u1 is deleted and IS up (picks_made 0) ...
  f.listed = [{ league_id: LEAGUE, pick_number: 2 }]; // ... but the list said pick 2
  const r = await sweep(f);
  assertFalse(f.reached(), 'act only on what the list asserted');
  assert(outcomes(r).includes('stale_pick_number'), JSON.stringify(r));
});

Deno.test('the sweep calls W2\'s list by name, and not the clocked list for it', async () => {
  const f = new Fake();
  await sweep(f);
  assert(f.seen.includes('rpc:unclocked_deleted_seat_turns'));
});

Deno.test('nothing listed → nothing read, nothing picked; the list failing is reported and does not break the sweep', async () => {
  const none = new Fake();
  none.listed = [];
  const r0 = await sweep(none);
  assertFalse(none.reached());
  assertEquals(r0.deleted_seat_total, 0);

  const broken = new Fake();
  broken.listFails = true;
  const r1 = await sweep(broken);
  assertEquals(r1.ok, true, 'the overdue pass and the starts still ran');
  assert((r1.start_errors ?? []).some((e: { outcome: string }) => e.outcome === 'deleted_seat_list_failed'), JSON.stringify(r1));
  assert(broken.seen.includes('rpc:overdue_draft_turns'));
});

Deno.test('restore env', () => {
  for (const [k, v] of SAVED_ENV) {
    if (v === undefined) Deno.env.delete(k);
    else Deno.env.set(k, v);
  }
});
