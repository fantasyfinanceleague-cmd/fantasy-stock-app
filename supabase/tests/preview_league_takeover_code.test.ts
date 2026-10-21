/**
 * preview-league must not resolve a TAKEOVER code. league_invites holds both ordinary invites and
 * takeover codes (kind = 'invite' | 'takeover'); a takeover code is a bearer capability for a deleted
 * manager's seat, and pasted into the join preview it must read EXACTLY like an unknown code, not show
 * that league's name and member count.
 *
 * The REAL index.ts runs with Deno.serve captured and fetch faked as GoTrue + PostgREST. The fake
 * league_invites table honours the query's filters (code=eq.X, kind=eq.Y) and, crucially, returns every
 * row matching the filters it was GIVEN, so removing the kind filter from the function makes the
 * takeover row visible and this test fail.
 *
 *   deno test --allow-read --allow-env --no-check supabase/tests/preview_league_takeover_code.test.ts
 */
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert';

const FAKE_ENV: Record<string, string> = {
  SUPABASE_URL: 'http://stub.supabase.test',
  SB_PUBLISHABLE_KEY: 'test-publishable-not-a-secret',
  SB_SECRET_KEY_INTERNAL: 'test-internal-key-not-a-secret',
};
const SAVED_ENV = new Map(Object.keys(FAKE_ENV).map((k) => [k, Deno.env.get(k)]));
for (const [k, v] of Object.entries(FAKE_ENV)) Deno.env.set(k, v);

const USER = '11111111-1111-4111-8111-111111111111';
const LEAGUE = '33333333-3333-4333-8333-333333333333';
const JSON_HEADERS = { 'content-type': 'application/json', 'content-range': '*/0' };
const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: JSON_HEADERS });

const INVITES = [
  { code: 'INVITE0001', kind: 'invite', league_id: LEAGUE, status: 'pending', expires_at: null },
  { code: 'ABCDE12345', kind: 'takeover', league_id: LEAGUE, status: 'pending', expires_at: null },
];
const LEAGUE_ROW = {
  id: LEAGUE, name: 'Secret League Name', commissioner_id: 'c0', num_participants: 8, season_status: 'active',
  draft_status: 'pending', draft_date: null, invite_code: 'LEGACY0001',
};

function install(seen: string[], requests: string[] = []): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const req = input instanceof Request ? input : null;
    const url = new URL(req ? req.url : String(input));
    const method = (req?.method ?? init?.method ?? 'GET').toUpperCase();
    requests.push(`${method} ${url.pathname}`);
    if (url.pathname === '/auth/v1/user') return ok({ id: USER, aud: 'authenticated' });
    if (url.pathname.startsWith('/rest/v1/rpc/')) return ok(true); // the rate limiter
    if (url.pathname === '/rest/v1/league_invites' && method === 'GET') {
      seen.push(url.search);
      let rows = INVITES;
      for (const col of ['code', 'kind']) {
        const f = url.searchParams.get(col);
        if (f?.startsWith('eq.')) rows = rows.filter((r) => (r as Record<string, unknown>)[col] === f.slice(3));
      }
      return ok(rows);
    }
    if (url.pathname === '/rest/v1/leagues' && method === 'GET') {
      const inviteCode = url.searchParams.get('invite_code');
      const id = url.searchParams.get('id');
      const rows = [LEAGUE_ROW].filter((l) => (inviteCode ? l.invite_code === inviteCode.replace('eq.', '') : true) &&
        (id ? l.id === id.replace('eq.', '') : true));
      return ok(rows);
    }
    if (url.pathname === '/rest/v1/league_members') return new Response('[]', { status: 200, headers: { ...JSON_HEADERS, 'content-range': '*/3' } });
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
    await import(new URL('../functions/preview-league/index.ts', import.meta.url).href);
  } finally {
    Deno.serve = original;
  }
  assert(captured, 'index.ts did not call Deno.serve');
  handler = captured;
  return handler;
}

async function preview(code: string, seen: string[] = [], requests: string[] = []): Promise<{ status: number; text: string }> {
  const h = await load();
  const restore = install(seen, requests);
  const o = { log: console.log, error: console.error };
  console.log = console.error = () => {};
  try {
    const res = await h(new Request('http://localhost/fn', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer test.jwt.token' },
      body: JSON.stringify({ code }),
    }));
    return { status: res.status, text: await res.text() };
  } finally {
    restore();
    Object.assign(console, o);
  }
}

Deno.test('a TAKEOVER code gets the identical not-found answer as an unknown code (no league name, no counts)', async () => {
  const takeover = await preview('ABCDE12345');
  const unknown = await preview('ZZZZZ99999');
  assertEquals(takeover, unknown, 'byte-identical status and body');
  assertEquals(JSON.parse(takeover.text), { found: false, reason: 'invalid_code' });
  assertFalse(takeover.text.includes('Secret League Name'));
});

Deno.test('a takeover code does EXACTLY the same work as an unknown code (no league, member-count or profile reads)', async () => {
  const a: string[] = [], b: string[] = [];
  await preview('ABCDE12345', [], a);
  await preview('ZZZZZ99999', [], b);
  assertEquals(a, b);
  assertFalse(a.some((r) => r.includes('league_members') || r.includes('user_profiles')), a.join(', '));
  assertEquals(a.filter((r) => r === 'GET /rest/v1/leagues').length, 1, 'only the invite_code lookup, never the by-id read');
});

Deno.test('lowercase takeover code (the handler uppercases) is equally refused', async () => {
  assertEquals(JSON.parse((await preview('abcde12345')).text), { found: false, reason: 'invalid_code' });
});

Deno.test('an ordinary invite code still resolves (the kind filter did not break the join preview)', async () => {
  const r = await preview('INVITE0001');
  assertEquals(r.status, 200);
  const j = JSON.parse(r.text);
  assertEquals(j.found ?? true, true);
  assert(r.text.includes('Secret League Name'), r.text);
});

Deno.test('the league_invites lookup carries the kind=invite filter (pins the query, not just the outcome)', async () => {
  const seen: string[] = [];
  await preview('ABCDE12345', seen);
  assertEquals(seen.length, 1);
  assert(seen[0].includes('kind=eq.invite'), seen[0]);
});

Deno.test('restore env', () => {
  for (const [k, v] of SAVED_ENV) {
    if (v === undefined) Deno.env.delete(k);
    else Deno.env.set(k, v);
  }
});
