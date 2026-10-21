/**
 * The push token's two database operations (hygiene pre-1.3; F8, migration 20261017000000).
 *  (a) The token lives in push_tokens ONLY: user_profiles.expo_push_token was DROPPED by the migration, so the old fallback
 *      write (and the second clear at sign-out) wrote to a column that no longer exists.
 *  (b) supabase-js RESOLVES a failed write to { error }, it does not throw: a try/catch alone read a failed delete at
 *      sign-out as success. Both operations check the resolved error, and log a constant line with the error CODE only
 *      (a message or details can echo the row; the token is a bearer for the device's pushes).
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { deletePushToken, upsertPushToken, type PushTokenClient } from '../lib/pushTokenStore.ts';
import { SOURCES } from './sourceManifest.generated.ts';

type Call = { table: string; op: string; args: unknown[] };
const TOKEN = 'ExponentPushToken[secret-device-bearer]';

/** A client that records every call; `answer` is what the write resolves to, or 'throw'. */
function fakeClient(answer: { error: { code?: string; message?: string; details?: string } | null } | 'throw') {
  const calls: Call[] = [];
  const settle = () => (answer === 'throw' ? Promise.reject(new Error(`boom ${TOKEN}`)) : Promise.resolve(answer));
  const client = {
    from(table: string) {
      return {
        upsert: (...args: unknown[]) => { calls.push({ table, op: 'upsert', args }); return settle(); },
        delete: () => ({ eq: (...args: unknown[]) => { calls.push({ table, op: 'delete.eq', args }); return settle(); } }),
      };
    },
  };
  return { client: client as unknown as PushTokenClient, calls };
}

/** Run `fn` with console.error / console.warn captured. */
async function logged<T>(fn: () => Promise<T>): Promise<{ result: T; lines: unknown[][] }> {
  const lines: unknown[][] = [];
  const keep = { e: console.error, w: console.warn };
  console.error = (...a: unknown[]) => { lines.push(a); };
  console.warn = (...a: unknown[]) => { lines.push(a); };
  try {
    return { result: await fn(), lines };
  } finally {
    console.error = keep.e;
    console.warn = keep.w;
  }
}

Deno.test('save: one upsert on push_tokens (onConflict user_id) and nothing else; true', async () => {
  const { client, calls } = fakeClient({ error: null });
  const { result, lines } = await logged(() => upsertPushToken(client, 'u1', TOKEN));
  assertEquals(result, true);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].table, 'push_tokens');
  assertEquals(calls[0].op, 'upsert');
  const [row, options] = calls[0].args as [Record<string, unknown>, Record<string, unknown>];
  assertEquals([row.user_id, row.token], ['u1', TOKEN]);
  assertEquals(options, { onConflict: 'user_id' });
  assertEquals(lines, []);
});

Deno.test('save: a RESOLVED error is a failure (false, one constant line with the code), and there is no second store to fall back to', async () => {
  const { client, calls } = fakeClient({ error: { code: '42501', message: `permission denied for ${TOKEN}`, details: TOKEN } });
  const { result, lines } = await logged(() => upsertPushToken(client, 'u1', TOKEN));
  assertEquals(result, false);
  assertEquals(calls.map((c) => c.table), ['push_tokens'], 'no user_profiles write after a failed upsert');
  assertEquals(lines, [['[push] saving the push token failed:', '42501']]);
});

Deno.test('save: a throw is a failure too (false, constant line)', async () => {
  const { client } = fakeClient('throw');
  const { result, lines } = await logged(() => upsertPushToken(client, 'u1', TOKEN));
  assertEquals(result, false);
  assertEquals(lines, [['[push] saving the push token failed: threw']]);
});

Deno.test('remove: one delete on push_tokens for this user, and NO write to user_profiles', async () => {
  const { client, calls } = fakeClient({ error: null });
  const { result, lines } = await logged(() => deletePushToken(client, 'u1'));
  assertEquals(result, true);
  assertEquals(calls, [{ table: 'push_tokens', op: 'delete.eq', args: ['user_id', 'u1'] }]);
  assertEquals(lines, []);
});

Deno.test('remove: a RESOLVED error is no longer read as success: false, and one constant line with the code only', async () => {
  const { client } = fakeClient({ error: { code: 'PGRST301', message: `JWT expired ${TOKEN}`, details: 'row u1' } });
  const { result, lines } = await logged(() => deletePushToken(client, 'u1'));
  assertEquals(result, false);
  assertEquals(lines, [['[push] removing the push token failed:', 'PGRST301']]);
  assert(!JSON.stringify(lines).includes('JWT'), 'the message is not logged');
  assert(!JSON.stringify(lines).includes(TOKEN), 'the token is not logged');
});

Deno.test('remove: an error with no code logs "unknown"; a throw is caught: sign-out proceeds either way (it never rejects)', async () => {
  const noCode = await logged(() => deletePushToken(fakeClient({ error: {} }).client, 'u1'));
  assertEquals([noCode.result, noCode.lines], [false, [['[push] removing the push token failed:', 'unknown']]]);
  const threw = await logged(() => deletePushToken(fakeClient('throw').client, 'u1'));
  assertEquals([threw.result, threw.lines], [false, [['[push] removing the push token failed: threw']]]);
});

/** A source file's code, comments stripped, so a comment that names the old column is not a use of it. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

Deno.test('the real token path is the only one: no code in notifications.ts or the store touches user_profiles or expo_push_token', () => {
  for (const f of ['lib/notifications.ts', 'lib/pushTokenStore.ts']) {
    const c = code(SOURCES[f]);
    assert(!c.includes('expo_push_token'), `${f} still names the dropped column`);
    assert(!c.includes("'user_profiles'"), `${f} still writes user_profiles`);
  }
  // notifications.ts goes through the store, with the real client, and swallows nothing itself
  const n = code(SOURCES['lib/notifications.ts']);
  assert(n.includes('return upsertPushToken(supabase, userId, token);'));
  assert(n.includes('await deletePushToken(supabase, userId);'));
  assert(!/catch\s*\{\s*\}/.test(n), 'no empty catch left in notifications.ts');
});

Deno.test('the store checks the resolved error and logs the code only (never the message)', () => {
  const c = code(SOURCES['lib/pushTokenStore.ts']);
  assertEquals((c.match(/if \(error\) \{/g) ?? []).length, 2, 'both operations check { error }');
  assertEquals((c.match(/codeOf\(error\)/g) ?? []).length, 2);
  assert(!/error\.message|error\.details|\$\{error/.test(c), 'no error text in a log line');
});
