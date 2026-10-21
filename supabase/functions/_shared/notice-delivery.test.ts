/**
 * The Expo push sits between a deletion's scrub and its auth delete, so a hung Expo must not hold the
 * request open or strand a notice at 'sending'. Hermetic: fetch is faked, the admin client is a recorder.
 *   deno test supabase/functions/_shared/notice-delivery.test.ts
 */
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert';
import { deliverNotice, PUSH_TIMEOUT_MS } from './notice-delivery.ts';
import { deliverDeletionNotices } from './deletion-notices.ts';
import { sendExpoPush } from './push.ts';

const MSG = { title: 'T', body: 'B', data: { type: 'x' } };

/** A fetch that never answers on its own: it only ends when its AbortSignal fires (like a hung server). */
function hungFetch(): { fetch: typeof fetch; calls: number } {
  const state = { calls: 0 };
  const f = ((_i: unknown, init?: RequestInit) => {
    state.calls++;
    return new Promise<Response>((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'TimeoutError')));
    });
  }) as typeof fetch;
  return { fetch: f, get calls() { return state.calls; } } as { fetch: typeof fetch; calls: number };
}

function install(fake: typeof fetch): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = fake;
  return () => { globalThis.fetch = original; };
}

/** league_notifications updates are recorded; the token lookups answer from fixed rows. */
function recorderAdmin() {
  const updates: Array<Record<string, unknown>> = [];
  // deno-lint-ignore no-explicit-any
  const admin: any = {
    from: (table: string) => {
      let payload: Record<string, unknown> | null = null;
      const q = {
        update(p: Record<string, unknown>) { payload = p; return q; },
        select() { return q; },
        eq() { return q; },
        maybeSingle() {
          if (table === 'league_notifications') { if (payload) updates.push(payload); return Promise.resolve({ data: { id: 'n1' }, error: null }); }
          if (table === 'user_profiles') return Promise.resolve({ data: { notifications_enabled: true }, error: null });
          if (table === 'push_tokens') return Promise.resolve({ data: { token: 'ExponentPushToken[test]' }, error: null });
          return Promise.resolve({ data: null, error: null });
        },
      };
      return q;
    },
  };
  return { admin, updates };
}

async function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const o = { log: console.log, error: console.error };
  console.log = console.error = () => {};
  try { return await fn(); } finally { Object.assign(console, o); }
}

Deno.test('a HUNG Expo is cut off: the notice settles failed (never stranded at sending), and fast', async () => {
  const hung = hungFetch();
  const restore = install(hung.fetch);
  const { admin, updates } = recorderAdmin();
  try {
    const t0 = Date.now();
    const status = await quiet(() => deliverNotice(admin, 'member_left', 'n1', 'u1', MSG, { pushTimeoutMs: 40 }));
    assert(Date.now() - t0 < 1500, `took ${Date.now() - t0} ms`);
    assertEquals(status, 'failed');
    assertEquals(hung.calls, 1);
    const claim = updates[0], settle = updates[1];
    assertEquals(claim.push_status, 'sending');
    assertEquals(settle.push_status, 'failed');
    assertEquals(settle.push_error, 'expo_error');
  } finally { restore(); }
});

Deno.test('the default bound is a few seconds, not unbounded', () => {
  assert(PUSH_TIMEOUT_MS > 0 && PUSH_TIMEOUT_MS <= 10_000, String(PUSH_TIMEOUT_MS));
});

Deno.test('sendExpoPush WITH a timeout reports expo_error instead of throwing; WITHOUT one it behaves exactly as before (throws)', async () => {
  const boom = (() => Promise.reject(new TypeError('connection refused'))) as typeof fetch;
  const restore = install(boom);
  try {
    assertEquals(await quiet(() => sendExpoPush('tok', MSG, { timeoutMs: 50 })), { sent: false, reason: 'expo_error' });
    await assertRejects(() => sendExpoPush('tok', MSG), TypeError, 'connection refused');
    await assertRejects(() => sendExpoPush('tok', MSG, {}), TypeError);
    await assertRejects(() => sendExpoPush('tok', MSG, { timeoutMs: 0 }), TypeError);
  } finally { restore(); }
});

Deno.test('sendExpoPush: the timeout is passed as a signal ONLY when asked for, and a normal answer is unchanged', async () => {
  const seen: Array<AbortSignal | null | undefined> = [];
  const ok = ((_i: unknown, init?: RequestInit) => {
    seen.push(init?.signal);
    return Promise.resolve(new Response(JSON.stringify({ data: { status: 'ok' } }), { status: 200 }));
  }) as typeof fetch;
  const restore = install(ok);
  try {
    assertEquals(await sendExpoPush('tok', MSG), { sent: true });
    assertEquals(await sendExpoPush('tok', MSG, { timeoutMs: 1000 }), { sent: true });
    assertEquals(seen[0], undefined, 'no signal for the callers that predate the option');
    assert(seen[1] instanceof AbortSignal);
  } finally { restore(); }
});

Deno.test('a batch of deletion notices stops at its budget; the rest stay pending, none is lost to a hang', async () => {
  const hung = hungFetch();
  const restore = install(hung.fetch);
  const { admin } = recorderAdmin();
  const notices = Array.from({ length: 5 }, (_, i) => ({
    id: `n${i}`, kind: 'commissioner_transferred' as const, recipient: 'u1', league_id: null, league_name: 'L',
  }));
  try {
    const t0 = Date.now();
    // each push is bounded by the default (4 s) in production; the BATCH is bounded by the budget
    await quiet(() => deliverDeletionNotices(admin, notices, 0));
    assert(Date.now() - t0 < 500, 'a spent budget skips every remaining notice immediately');
    assertEquals(hung.calls, 0);
  } finally { restore(); }
});

Deno.test('a hang while READING the response body is cut off too (the abort covers the body, not just the connect)', async () => {
  const stalledBody = ((_i: unknown, init?: RequestInit) => Promise.resolve(new Response(new ReadableStream({
    start(c) { init?.signal?.addEventListener('abort', () => c.error(new DOMException('aborted', 'TimeoutError'))); },
  }), { status: 200 }))) as typeof fetch;
  const restore = install(stalledBody);
  try {
    const t0 = Date.now();
    const r = await quiet(() => sendExpoPush('tok', MSG, { timeoutMs: 40 }));
    assert(Date.now() - t0 < 1500, `took ${Date.now() - t0} ms`);
    assertEquals(r.sent, false, 'never reported sent without a readable ok ticket');
  } finally { restore(); }
});

Deno.test('the abort path logs the error NAME only, never a message that could carry the token', async () => {
  const boom = (() => Promise.reject(new TypeError('sending to ExponentPushToken[SECRET-TOKEN] failed'))) as typeof fetch;
  const restore = install(boom);
  const lines: string[] = [];
  const o = { error: console.error, log: console.log };
  console.error = (...a: unknown[]) => lines.push(a.map(String).join(' '));
  console.log = () => {};
  try {
    await sendExpoPush('ExponentPushToken[SECRET-TOKEN]', MSG, { timeoutMs: 50 });
  } finally { Object.assign(console, o); restore(); }
  assert(lines.length > 0);
  assertEquals(lines.join('\n').includes('SECRET-TOKEN'), false);
});
