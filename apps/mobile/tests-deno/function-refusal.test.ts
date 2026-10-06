/**
 * readFunctionRefusal (shared): every shape supabase-js gives back from an
 * edge function. Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { functionOk, readFunctionRefusal } from '../lib/functionRefusal.ts';

/** A FunctionsHttpError-shaped error: `context` is the Response. */
const httpError = (status: number, body: string) => ({ name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context: new Response(body, { status }) });

Deno.test('a 2xx success: no reason, the body kept', async () => {
  const r = await readFunctionRefusal({ ok: true, added: ['bot-1'] }, null);
  assertEquals(r, { transport: false, status: null, reason: null, body: { ok: true, added: ['bot-1'] } });
  assertEquals(functionOk(r), true);
});

Deno.test('a 2xx game-flow refusal ({ ok: false, reason })', async () => {
  const r = await readFunctionRefusal({ ok: false, reason: 'draft_postponed' }, null);
  assertEquals(r, { transport: false, status: null, reason: 'draft_postponed', body: { ok: false, reason: 'draft_postponed' } });
  assertEquals(functionOk(r), false);
});

Deno.test('a 2xx { ok: false } with no reason is "unhandled", never a success', async () => {
  const r = await readFunctionRefusal({ ok: false }, null);
  assertEquals(r.transport === false && r.reason, 'unhandled');
});

Deno.test('a 2xx with no body is a success with an empty body', async () => {
  assertEquals(await readFunctionRefusal(null, null), { transport: false, status: null, reason: null, body: {} });
});

Deno.test('a non-2xx with a JSON body: the body is read from error.context (429 rate_limited)', async () => {
  const r = await readFunctionRefusal(null, httpError(429, JSON.stringify({ ok: false, reason: 'rate_limited' })));
  assertEquals(r, { transport: false, status: 429, reason: 'rate_limited', body: { ok: false, reason: 'rate_limited' } });
});

Deno.test('other non-2xx refusals keep their status and reason (403 not_a_member, 503 calendar_unavailable)', async () => {
  const a = await readFunctionRefusal(null, httpError(403, JSON.stringify({ ok: false, reason: 'not_a_member' })));
  assertEquals(a.transport === false && [a.status, a.reason], [403, 'not_a_member']);
  const b = await readFunctionRefusal(null, httpError(503, JSON.stringify({ ok: false, reason: 'calendar_unavailable', next_open_at: null })));
  assertEquals(b.transport === false && [b.status, b.reason, b.body.next_open_at], [503, 'calendar_unavailable', null]);
});

Deno.test('a non-2xx with a non-JSON body is transport (unknown), not a refusal', async () => {
  assertEquals(await readFunctionRefusal(null, httpError(502, '<html>Bad gateway</html>')), { transport: true });
  assertEquals(await readFunctionRefusal(null, httpError(500, '')), { transport: true });
});

Deno.test('a non-2xx JSON body with no reason is transport', async () => {
  assertEquals(await readFunctionRefusal(null, httpError(500, JSON.stringify({ message: 'boom' }))), { transport: true });
});

Deno.test('a network error (no Response in context) is transport', async () => {
  assertEquals(await readFunctionRefusal(null, { name: 'FunctionsFetchError', message: 'Failed to send a request', context: new TypeError('Network request failed') }), { transport: true });
  assertEquals(await readFunctionRefusal(null, { message: 'x' }), { transport: true });
  assertEquals(await readFunctionRefusal(undefined, new Error('offline')), { transport: true });
});
