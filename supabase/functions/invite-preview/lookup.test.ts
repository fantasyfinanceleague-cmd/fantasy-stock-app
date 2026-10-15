// Hermetic tests for invite-preview's bounded, once-retried lookup (see ./lookup.ts). No DB, no secrets.
//   deno test --allow-read supabase/functions/invite-preview/lookup.test.ts
import { assert, assertEquals, assertFalse, assertRejects } from 'jsr:@std/assert';
import { LOOKUP_TIMEOUT_MS, lookupWithTimeout, LookupTimeout, runLookup, type RpcResult } from './lookup.ts';

const FOUND = { status: 'found', name: 'Stock Scudetto', inviter: 'Roberto', season_status: 'active', draft_status: 'not_started', draft_date: null, current_members: 3, num_participants: 8 };
const ok = (data: unknown): Promise<RpcResult> => Promise.resolve({ data, error: null });
const instant = { sleep: () => Promise.resolve(), jitterMs: () => 0 };

Deno.test('the call\'s bound is 2 s, and it is the edge function\'s abort', () => {
  assertEquals(LOOKUP_TIMEOUT_MS, 2000);
});

Deno.test('a normal answer passes through, and nothing is left running (no leaked timer)', async () => {
  assertEquals(await lookupWithTimeout(() => ok({ x: 1 }), 50), { data: { x: 1 }, error: null });
});

Deno.test('a HUNG call (never resolves, ignores the signal) rejects with LookupTimeout instead of hanging', async () => {
  let signal: AbortSignal | undefined;
  const started = Date.now();
  await assertRejects(() => lookupWithTimeout((s) => { signal = s; return new Promise<RpcResult>(() => {}); }, 25), LookupTimeout);
  assert(Date.now() - started < 1000, 'it gave up quickly');
  assert(signal?.aborted, 'and the abort signal was fired for supabase-js to act on');
});

Deno.test('the signal is passed to the call, and a call that HONOURS it also ends (supabase-js turns an abort into an error result)', async () => {
  const res = await lookupWithTimeout(
    (signal) => new Promise<RpcResult>((resolve) => signal.addEventListener('abort', () => resolve({ data: null, error: { code: '' } }))),
    25,
  ).catch((e) => e);
  // either the race rejected first or the honoured abort resolved first; both end the wait
  assert(res instanceof LookupTimeout || res.error !== undefined);
});

Deno.test('LookupTimeout is named, so the function log says what happened', () => {
  const e = new LookupTimeout();
  assertEquals([e.name, e instanceof Error], ['LookupTimeout', true]);
});

Deno.test('runLookup: a found league is shaped; an rpc error is an error CODE only; nothing retries', async () => {
  let calls = 0;
  const found = await runLookup(() => { calls++; return ok(FOUND); }, { ...instant, timeoutMs: 50 });
  assertEquals(found.kind, 'shaped');
  assertEquals((found as { shaped: { status: number; body: unknown } }).shaped.body, { found: true, name: 'Stock Scudetto', inviter: 'Roberto', reason: null });
  assertEquals(calls, 1);
  calls = 0;
  const err = await runLookup(() => { calls++; return Promise.resolve({ data: null, error: { code: '42501' } }); }, { ...instant, timeoutMs: 50 });
  assertEquals(err, { kind: 'rpc_error', code: '42501' });
  assertEquals(calls, 1);
});

Deno.test('runLookup: ONE retry on contention (a jittered pause), and a second answer is final', async () => {
  const slept: number[] = [];
  let calls = 0;
  const deps = { sleep: (ms: number) => { slept.push(ms); return Promise.resolve(); }, jitterMs: () => 37, timeoutMs: 50 };
  // busy once, then found: the retry wins
  const r1 = await runLookup(() => { calls++; return ok(calls === 1 ? { status: 'rate_limited', limit: 'contention' } : FOUND); }, deps);
  assertEquals([calls, slept, r1.kind, (r1 as { shaped: { status: number } }).shaped.status], [2, [37], 'shaped', 200]);
  // busy twice: the 429 stands, and it is the SECOND answer (no third call)
  calls = 0; slept.length = 0;
  const r2 = await runLookup(() => { calls++; return ok({ status: 'rate_limited', limit: 'contention' }); }, deps);
  assertEquals([calls, slept.length, (r2 as { shaped: { status: number; limit: string } }).shaped.status, (r2 as { shaped: { limit: string } }).shaped.limit], [2, 1, 429, 'contention']);
  assertEquals((r2 as { shaped: { body: unknown } }).shaped.body, { error: 'rate_limited' });
});

Deno.test('runLookup: only CONTENTION retries (a real limit, the salt, a miss, a rpc error are final at once)', async () => {
  for (const limit of ['ip', 'miss-ip', 'miss-all', 'req-all', 'salt']) {
    let calls = 0;
    const r = await runLookup(() => { calls++; return ok({ status: 'rate_limited', limit }); }, { ...instant, timeoutMs: 50 });
    assertEquals([calls, (r as { shaped: { limit: string } }).shaped.limit], [1, limit], limit);
  }
  let calls = 0;
  await runLookup(() => { calls++; return ok({ status: 'not_found' }); }, { ...instant, timeoutMs: 50 });
  assertEquals(calls, 1);
});

Deno.test('runLookup: a hung lookup throws LookupTimeout and is NOT retried', async () => {
  let calls = 0;
  await assertRejects(() => runLookup(() => { calls++; return new Promise<RpcResult>(() => {}); }, { ...instant, timeoutMs: 25 }), LookupTimeout);
  assertEquals(calls, 1);
  // a timeout on the RETRY also surfaces (no swallowed hang)
  calls = 0;
  await assertRejects(
    () => runLookup(() => { calls++; return calls === 1 ? ok({ status: 'rate_limited', limit: 'contention' }) : new Promise<RpcResult>(() => {}); }, { ...instant, timeoutMs: 25 }),
    LookupTimeout,
  );
  assertEquals(calls, 2);
});

Deno.test('the real jitter stays small (the retry must stay inside the response floor in the ordinary case)', () => {
  const src = Deno.readTextFileSync(new URL('./lookup.ts', import.meta.url)).replace(/\/\/.*$/gm, '');
  assert(src.includes('const defaultJitter = () => 20 + Math.floor(Math.random() * 60);'));
});

Deno.test('index.ts binds the abort: ONE rpc, through runLookup, with .abortSignal(signal); the abort is not optional', () => {
  const src = Deno.readTextFileSync(new URL('./index.ts', import.meta.url)).replace(/\/\/.*$/gm, '');
  assertEquals((src.match(/\.rpc\(/g) ?? []).length, 1);
  assert(src.includes("admin.rpc('invite_preview_lookup', { p_code: code, p_ip: clientIp(req.headers) }).abortSignal(signal)"));
  assert(src.includes('await runLookup((signal) =>'));
  assertFalse(/toResponse\(/.test(src), 'the shaping lives in lookup.ts now');
  assert(src.includes("console.error('invite-preview: lookup rpc failed', outcome.code);"));
  // a timeout lands in the existing catch, which logs its NAME and answers the generic 500
  assert(src.includes("console.error('invite-preview: unhandled', e instanceof Error ? e.name : typeof e);"));
});
