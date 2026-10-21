/**
 * Handler-level proof for join-league's `takeover` action: the REAL index.ts with
 * Deno.serve captured and fetch faked as GoTrue + PostgREST + Expo (the
 * cron_status_handlers.test.ts technique).
 *
 * What it pins:
 *   - the user id sent to take_over_team is the VERIFIED JWT user's, never the body's;
 *   - 'taken' (a second taker) is a clean refusal with no push;
 *   - the commissioner push goes out only AFTER a committed takeover, and a push
 *     failure never fails the takeover;
 *   - an rpc error is a 500, never a fabricated success (supabase-js resolves
 *     { error }, it does not throw: CLAUDE.md "success signals" #5);
 *   - the legacy join body still reaches join_league_by_code, untouched.
 *
 *   deno test --allow-read --allow-env --no-check supabase/tests/join_league_takeover_handler.test.ts
 */
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert';

const FAKE_ENV: Record<string, string> = {
  SUPABASE_URL: 'http://stub.supabase.test',
  SB_PUBLISHABLE_KEY: 'test-publishable-not-a-secret',
  SB_SECRET_KEY_INTERNAL: 'test-internal-key-not-a-secret',
};
const SAVED_ENV = new Map(Object.keys(FAKE_ENV).map((k) => [k, Deno.env.get(k)]));
for (const [k, v] of Object.entries(FAKE_ENV)) Deno.env.set(k, v);

const JWT_USER = '11111111-1111-4111-8111-111111111111';
const BODY_USER = '99999999-9999-4999-8999-999999999999';
const COMMISH = '22222222-2222-4222-8222-222222222222';
const LEAGUE = '33333333-3333-4333-8333-333333333333';
const JSON_HEADERS = { 'content-type': 'application/json', 'content-range': '*/0' };

const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: JSON_HEADERS });

class Fake {
  rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];
  pushes: Array<Record<string, unknown>> = [];
  rpc: Record<string, () => Response> = {};
  expoOk = true;
  rateOk = true;
  /** buckets whose limiter answers false / errors */
  denyBuckets = new Set<string>();
  errBuckets = new Set<string>();
}

function install(f: Fake): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const req = input instanceof Request ? input : null;
    const url = new URL(req ? req.url : String(input));
    const method = (req?.method ?? init?.method ?? 'GET').toUpperCase();
    const raw = req ? await req.text() : (init?.body as string | undefined);
    const body = raw ? JSON.parse(raw) : undefined;

    if (url.pathname === '/auth/v1/user') return ok({ id: JWT_USER, aud: 'authenticated', email: 'u@example.com' });
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const name = url.pathname.split('/').pop()!;
      f.rpcs.push({ name, args: body ?? {} });
      if (name === 'check_and_bump_rate_limit') {
        const bucket = String(body?.p_bucket);
        if (f.errBuckets.has(bucket)) return new Response(JSON.stringify({ message: 'boom', code: 'XX000' }), { status: 500, headers: JSON_HEADERS });
        return ok(f.rateOk && !f.denyBuckets.has(bucket));
      }
      return (f.rpc[name] ?? (() => ok(null)))();
    }
    if (url.hostname === 'exp.host') {
      f.pushes.push(body);
      return ok({ data: f.expoOk ? { status: 'ok' } : { status: 'error', details: { error: 'DeviceNotRegistered' } } });
    }
    if (url.pathname === '/rest/v1/league_notifications' && method === 'PATCH') return ok([{ id: 'n1' }]);
    if (url.pathname === '/rest/v1/user_profiles') return ok([{ notifications_enabled: true }]);
    if (url.pathname === '/rest/v1/push_tokens') return ok([{ token: 'ExponentPushToken[test]' }]);
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
    await import(new URL('../functions/join-league/index.ts', import.meta.url).href);
  } finally {
    Deno.serve = original;
  }
  assert(captured, 'index.ts did not call Deno.serve');
  handler = captured;
  return handler;
}

async function post(f: Fake, body: unknown, extraHeaders: Record<string, string> = {}): Promise<Response> {
  const h = await load();
  const restore = install(f);
  const o = { log: console.log, error: console.error };
  console.log = console.error = () => {};
  try {
    return await h(new Request('http://localhost/fn', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer test.jwt.token', ...extraHeaders },
      body: JSON.stringify(body),
    }));
  } finally {
    restore();
    Object.assign(console, o);
  }
}

const TAKEN_OVER = {
  status: 'taken_over', notice_id: 'n1', notify_user_id: COMMISH, league_id: LEAGUE, league_name: 'Alpha', new_name: 'Roberto B.',
};
const CODE = 'ABCDE12345';
const takeover = (extra: Record<string, unknown> = {}) => ({ action: 'takeover', code: CODE, ...extra });
const takeOverCalls = (f: Fake) => f.rpcs.filter((r) => r.name === 'take_over_team');

Deno.test('takeover: the user id is the JWT\'s, never the body\'s; success pushes the commissioner AFTER commit', async () => {
  const f = new Fake();
  f.rpc.take_over_team = () => ok(TAKEN_OVER);
  f.rpc.deleted_manager_label = () => ok('Former manager');
  const res = await post(f, takeover({ user_id: BODY_USER, p_user_id: BODY_USER, league_id: BODY_USER }));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, status: 'taken_over', league: { id: LEAGUE, name: 'Alpha' } });
  assertEquals(takeOverCalls(f).length, 1);
  assertEquals(takeOverCalls(f)[0].args, { p_code: CODE, p_user_id: JWT_USER });
  assertEquals(f.pushes.length, 1);
  assertEquals(f.pushes[0].body, "Roberto B. took over Former manager's team.");
  assertEquals((f.pushes[0].data as { league_id: string }).league_id, LEAGUE, 'the push deep-links to the database\'s league');
  assertEquals((f.pushes[0].data as { type: string }).type, 'seat_taken_over');
  const order = f.rpcs.map((r) => r.name);
  assert(order.indexOf('take_over_team') < order.indexOf('deleted_manager_label'), 'push copy is built after the commit');
});

Deno.test("takeover 'taken': a second taker gets a clean refusal and NO push", async () => {
  const f = new Fake();
  // Even if a refusal carried a notice and a recipient, nothing may be pushed for it.
  f.rpc.take_over_team = () => ok({ status: 'refused', reason: 'taken', notice_id: 'n1', notify_user_id: COMMISH });
  const res = await post(f, takeover());
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: false, reason: 'taken' });
  assertEquals(f.pushes.length, 0);
  assertFalse(f.rpcs.some((r) => r.name === 'deleted_manager_label'));
});

Deno.test('takeover: a push failure never fails the takeover that already committed', async () => {
  const f = new Fake();
  f.expoOk = false;
  f.rpc.take_over_team = () => ok(TAKEN_OVER);
  const res = await post(f, takeover());
  assertEquals(res.status, 200);
  assertEquals((await res.json()).ok, true);
});

Deno.test('takeover: an odd value from the database in the push copy can never turn a committed takeover into a 500', async () => {
  const f = new Fake();
  f.rpc.take_over_team = () => ok({ ...TAKEN_OVER, league_name: { not: 'a string' }, new_name: 42 });
  const res = await post(f, takeover());
  assertEquals(res.status, 200);
  assertEquals((await res.json()).ok, true);
});

Deno.test('takeover: the seat_label the SQL returned is used (no second rpc); without it the label rpc is the fallback', async () => {
  const f = new Fake();
  f.rpc.take_over_team = () => ok({ ...TAKEN_OVER, seat_label: 'Former manager' });
  f.rpc.deleted_manager_label = () => ok('SHOULD NOT BE USED');
  await post(f, takeover());
  assertEquals(f.pushes[0].body, "Roberto B. took over Former manager's team.");
  assertFalse(f.rpcs.some((r) => r.name === 'deleted_manager_label'));
});

Deno.test('takeover: a non-uuid league id from the database is never put in the push or the response', async () => {
  const f = new Fake();
  f.rpc.take_over_team = () => ok({ ...TAKEN_OVER, league_id: '<script>' });
  const j = await (await post(f, takeover())).json();
  assertEquals(j.league.id, null);
  assertEquals((f.pushes[0].data as { league_id: unknown }).league_id, null);
});

Deno.test('takeover: a very long league name is bounded in the response and the push', async () => {
  const f = new Fake();
  f.rpc.take_over_team = () => ok({ ...TAKEN_OVER, league_name: 'L'.repeat(5000), new_name: 'N'.repeat(5000) });
  const j = await (await post(f, takeover())).json();
  assertEquals(j.league.name.length, 120);
  assertEquals((f.pushes[0].title as string).length, 120);
  assert((f.pushes[0].body as string).length < 400);
});

Deno.test('a literal JSON null body is a clean 400, never a crash', async () => {
  const f = new Fake();
  const res = await post(f, null);
  assertEquals(res.status, 400);
  assertEquals(f.rpcs.filter((r) => r.name === 'join_league_by_code').length, 0);
});

Deno.test('takeover: the label rpc failing falls back to generic copy, still pushes', async () => {
  const f = new Fake();
  f.rpc.take_over_team = () => ok(TAKEN_OVER);
  f.rpc.deleted_manager_label = () => new Response(JSON.stringify({ message: 'nope', code: '42883' }), { status: 404, headers: JSON_HEADERS });
  await post(f, takeover());
  assertEquals(f.pushes[0].body, 'Roberto B. took over an open team.');
});

Deno.test('takeover: an rpc ERROR is a 500, never a fabricated success, and nothing is pushed', async () => {
  const f = new Fake();
  f.rpc.take_over_team = () => new Response(JSON.stringify({ message: 'deadlock', code: '40P01' }), { status: 409, headers: JSON_HEADERS });
  const res = await post(f, takeover());
  assertEquals(res.status, 500);
  assertEquals((await res.json()).error, 'unhandled');
  assertEquals(f.pushes.length, 0);
});

Deno.test('a malformed or lowercase code is answered invalid_code at the edge, with NO lookup, for both actions', async () => {
  for (const code of ['abcde12345', 'ABCDE1234', 'ABCDE123456', 'ABCDE-2345', 'TKV-123']) {
    for (const body of [takeover({ code }), preview({ code })]) {
      const f = new Fake();
      const res = await post(f, body);
      assertEquals(res.status, 200);
      assertEquals(await res.json(), { ok: false, reason: 'invalid_code' });
      assertEquals(takeOverCalls(f).length + previewCalls(f).length, 0, `no lookup for ${code}`);
      assertEquals(takeoverLimiterCalls(f).length, 2, 'the attempt was still counted by the limiter');
    }
  }
});

Deno.test('takeover: a malformed body is a 400 and never reaches the database', async () => {
  for (const b of [{ action: 'takeover' }, { action: 'takeover', code: '' }, { action: 'takeover', league_id: LEAGUE }]) {
    const f = new Fake();
    assertEquals((await post(f, b)).status, 400);
    assertEquals(takeOverCalls(f).length, 0);
  }
});

Deno.test('legacy join body (just a code) still goes to join_league_by_code, untouched', async () => {
  const f = new Fake();
  f.rpc.join_league_by_code = () => ok({ ok: true, league: { id: LEAGUE, name: 'Alpha' } });
  const res = await post(f, { code: 'abc123' });
  assertEquals(res.status, 200);
  const j = f.rpcs.filter((r) => r.name === 'join_league_by_code');
  assertEquals(j.length, 1);
  assertEquals(j[0].args, { p_code: 'ABC123', p_user_id: JWT_USER });
  assertEquals(takeOverCalls(f).length, 0);
});

const preview = (extra: Record<string, unknown> = {}) => ({ action: 'takeover_preview', code: CODE, ...extra });
const previewCalls = (f: Fake) => f.rpcs.filter((r) => r.name === 'takeover_preview');

Deno.test('preview: the user id is the JWT\'s, the answer is the league and record, and it writes and pushes nothing', async () => {
  const f = new Fake();
  f.rpc.takeover_preview = () => ok({ status: 'ok', league_name: 'Alpha', wins: 3, losses: 2, rank: 4, league_id: LEAGUE });
  const res = await post(f, preview({ user_id: BODY_USER, p_user_id: BODY_USER }));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, league_name: 'Alpha', wins: 3, losses: 2, rank: 4 });
  assertEquals(previewCalls(f).length, 1);
  assertEquals(previewCalls(f)[0].args, { p_code: CODE, p_user_id: JWT_USER });
  assertEquals(takeOverCalls(f).length, 0, 'a preview never takes the seat');
  assertEquals(f.pushes.length, 0);
});

Deno.test('preview: every refusal reason reaches the client as a clean 200 reason', async () => {
  for (const reason of ['gone', 'taken', 'invalid_code', 'not_deleted', 'window', 'already_member', 'not_eligible']) {
    const f = new Fake();
    f.rpc.takeover_preview = () => ok({ status: 'refused', reason });
    const res = await post(f, preview());
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { ok: false, reason });
  }
});

Deno.test('preview: an rpc ERROR is a 500, never a fabricated preview', async () => {
  const f = new Fake();
  f.rpc.takeover_preview = () => new Response(JSON.stringify({ message: 'boom', code: '42883' }), { status: 404, headers: JSON_HEADERS });
  const res = await post(f, preview());
  assertEquals(res.status, 500);
  assertEquals((await res.json()).error, 'unhandled');
});

Deno.test('preview: an "ok" with no league name is not a preview', async () => {
  const f = new Fake();
  f.rpc.takeover_preview = () => ok({ status: 'ok' });
  assertEquals(await (await post(f, preview())).json(), { ok: false, reason: 'unhandled' });
});

Deno.test('preview: the shared rate limit applies BEFORE the lookup (a code-guessing surface)', async () => {
  for (const body of [preview(), takeover()]) {
    const f = new Fake();
    f.rateOk = false;
    const res = await post(f, body);
    assertEquals(res.status, 429);
    assertEquals((await res.json()).error, 'rate_limited');
    assertEquals(previewCalls(f).length + takeOverCalls(f).length, 0, 'no lookup behind a refused limit');
  }
});

Deno.test('preview: a malformed body is a 400 and never reaches the database', async () => {
  for (const b of [{ action: 'takeover_preview' }, { action: 'takeover_preview', code: '' }]) {
    const f = new Fake();
    assertEquals((await post(f, b)).status, 400);
    assertEquals(previewCalls(f).length, 0);
  }
});

const takeoverLimiterCalls = (f: Fake) =>
  f.rpcs.filter((r) => r.name === 'check_and_bump_rate_limit' && r.args.p_bucket === 'join-league-takeover');

Deno.test('takeover limiter: BOTH actions are refused when it says no, with nothing looked up', async () => {
  for (const body of [preview(), takeover()]) {
    const f = new Fake();
    f.denyBuckets.add('join-league-takeover');
    const res = await post(f, body);
    assertEquals(res.status, 429);
    assertEquals((await res.json()).error, 'rate_limited');
    assertEquals(previewCalls(f).length + takeOverCalls(f).length, 0);
  }
});

Deno.test('takeover limiter FAILS CLOSED: an rpc error refuses (503), it does not wave the request through', async () => {
  for (const body of [preview(), takeover()]) {
    const f = new Fake();
    f.errBuckets.add('join-league-takeover');
    f.rpc.takeover_preview = () => ok({ status: 'ok', league_name: 'Alpha' });
    f.rpc.take_over_team = () => ok(TAKEN_OVER);
    const res = await post(f, body);
    assertEquals(res.status, 503);
    assertEquals(previewCalls(f).length + takeOverCalls(f).length, 0, 'a broken limiter must not become an open door');
    assertEquals(f.pushes.length, 0);
  }
});

Deno.test('the legacy join is still refused by its own shared limiter, with no join lookup behind a refusal', async () => {
  const f = new Fake();
  f.denyBuckets.add('join-league');
  f.rpc.join_league_by_code = () => ok({ ok: true, league: { id: LEAGUE, name: 'Alpha' } });
  const res = await post(f, { code: 'abc123' });
  assertEquals(res.status, 429);
  assertEquals(f.rpcs.filter((r) => r.name === 'join_league_by_code').length, 0);
});

Deno.test('the shared limiter still fails OPEN for the legacy join (unchanged behaviour)', async () => {
  const f = new Fake();
  f.errBuckets.add('join-league');
  f.rpc.join_league_by_code = () => ok({ ok: true, league: { id: LEAGUE, name: 'Alpha' } });
  assertEquals((await post(f, { code: 'abc123' })).status, 200);
});

Deno.test('takeover limiter keys the IP on the RIGHT-most forwarded hop, never the client-chosen left-most', async () => {
  const f = new Fake();
  f.rpc.takeover_preview = () => ok({ status: 'refused', reason: 'invalid_code' });
  await post(f, preview(), { 'x-forwarded-for': '6.6.6.6, 198.51.100.7' });
  const subjects = takeoverLimiterCalls(f).map((r) => r.args.p_subject);
  assert(subjects.includes('ip:198.51.100.7'), JSON.stringify(subjects));
  assertFalse(subjects.includes('ip:6.6.6.6'), 'a client must not pick its own bucket');
  assert(subjects.includes(`user:${JWT_USER}`));
});

Deno.test('takeover limiter: no usable address shares ONE strict bucket instead of skipping the check', async () => {
  const f = new Fake();
  f.rpc.takeover_preview = () => ok({ status: 'refused', reason: 'invalid_code' });
  await post(f, preview());
  assert(takeoverLimiterCalls(f).some((r) => r.args.p_subject === 'ip:unknown'));
});

Deno.test('preview is a pure read: the ONLY rpcs are the limiters and takeover_preview, and a taken refusal pushes nothing', async () => {
  const f = new Fake();
  f.rpc.takeover_preview = () => ok({ status: 'refused', reason: 'taken', notice_id: 'n1', notify_user_id: COMMISH });
  await post(f, preview());
  assertEquals(new Set(f.rpcs.map((r) => r.name)), new Set(['check_and_bump_rate_limit', 'takeover_preview']));
  assertEquals(f.pushes.length, 0);
});

Deno.test('preview: a very long league name is bounded', async () => {
  const f = new Fake();
  f.rpc.takeover_preview = () => ok({ status: 'ok', league_name: 'x'.repeat(5000), wins: 1, losses: 0, rank: 1 });
  const j = await (await post(f, preview())).json();
  assertEquals(j.league_name.length, 120);
});

Deno.test("'taken' and 'invalid_code' come back with the SAME HTTP status and headers for both actions", async () => {
  for (const [body, fn] of [[takeover(), 'take_over_team'], [preview(), 'takeover_preview']] as const) {
    const seen: Array<{ status: number; type: string | null }> = [];
    for (const reason of ['taken', 'invalid_code']) {
      const f = new Fake();
      f.rpc[fn] = () => ok({ status: 'refused', reason });
      const res = await post(f, body);
      seen.push({ status: res.status, type: res.headers.get('content-type') });
      await res.text();
    }
    assertEquals(seen[0], seen[1], fn);
    assertEquals(seen[0].status, 200);
  }
});

Deno.test("the SQL's own 'rate_limited' (take and preview) reaches the client as a 429, with no push", async () => {
  for (const [body, fn] of [[takeover(), 'take_over_team'], [preview(), 'takeover_preview']] as const) {
    const f = new Fake();
    f.rpc[fn] = () => ok({ status: 'refused', reason: 'rate_limited', notice_id: 'n1', notify_user_id: COMMISH });
    const res = await post(f, body);
    assertEquals(res.status, 429);
    assertEquals(await res.json(), { ok: false, reason: 'rate_limited' });
    assertEquals(f.pushes.length, 0);
  }
});

Deno.test('restore env', () => {
  for (const [k, v] of SAVED_ENV) {
    if (v === undefined) Deno.env.delete(k);
    else Deno.env.set(k, v);
  }
});
