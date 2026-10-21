/**
 * Hermetic tests for apple-revoke.ts. The signing key is GENERATED HERE, per run,
 * and never leaves the process: no real .p8 is read or embedded. Apple is a fake
 * fetch that records each request.
 *
 *   deno test supabase/functions/_shared/apple-revoke.test.ts
 */
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert';
import {
  APPLE_ISSUER,
  type AppleConfig,
  appleConfigFromEnv,
  exchangeAppleCode,
  makeAppleClientSecret,
  pemToPkcs8,
  revokeAppleToken,
} from './apple-revoke.ts';

function toPem(der: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(der)) s += String.fromCharCode(b);
  const b64 = btoa(s).match(/.{1,64}/g)!.join('\n');
  return `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`;
}

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const TEST_PEM = toPem(await crypto.subtle.exportKey('pkcs8', pair.privateKey));

const CFG: AppleConfig = {
  teamId: 'TEAMID1234',
  keyId: 'KEYID56789',
  privateKey: TEST_PEM,
  clientId: 'com.example.stockpile',
};
const NOW = new Date('2026-10-21T12:00:00Z');

function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const decodeJson = (s: string) => JSON.parse(new TextDecoder().decode(b64urlDecode(s)));

interface Seen { url: string; form: URLSearchParams; contentType: string | null }
function fakeApple(respond: (url: string) => Response | Error) {
  const seen: Seen[] = [];
  const fetchFn = (url: string, init: RequestInit) => {
    seen.push({
      url,
      form: new URLSearchParams(String(init.body)),
      contentType: new Headers(init.headers).get('content-type'),
    });
    const r = respond(url);
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  };
  return { fetchFn, seen };
}
const jsonRes = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// ---- client secret --------------------------------------------------------------

Deno.test('client secret: ES256 header with the key id, Apple claims, 5-minute life', async () => {
  const jwt = await makeAppleClientSecret(CFG, NOW);
  const [h, p, s] = jwt.split('.');
  assertEquals(decodeJson(h), { alg: 'ES256', kid: 'KEYID56789' });
  const iat = Math.floor(NOW.getTime() / 1000);
  assertEquals(decodeJson(p), {
    iss: 'TEAMID1234',
    iat,
    exp: iat + 300,
    aud: APPLE_ISSUER,
    sub: 'com.example.stockpile',
  });
  // JWS ES256 = raw r||s, 64 bytes (not DER).
  assertEquals(b64urlDecode(s).length, 64);
});

Deno.test('client secret: the signature verifies with the matching public key', async () => {
  const jwt = await makeAppleClientSecret(CFG, NOW);
  const [h, p, s] = jwt.split('.');
  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    pair.publicKey,
    b64urlDecode(s),
    new TextEncoder().encode(`${h}.${p}`),
  );
  assert(ok);
  // ...and not with another key: the test would pass on garbage otherwise.
  const other = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  assertFalse(await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    other.publicKey,
    b64urlDecode(s),
    new TextEncoder().encode(`${h}.${p}`),
  ));
});

Deno.test('client secret: a PEM pasted with literal \\n sequences signs the same way', async () => {
  const oneLine = TEST_PEM.trim().replace(/\n/g, '\\n');
  assertEquals(pemToPkcs8(oneLine), pemToPkcs8(TEST_PEM));
  const jwt = await makeAppleClientSecret({ ...CFG, privateKey: oneLine }, NOW);
  assertEquals(jwt.split('.').length, 3);
});

Deno.test('config: any missing or blank secret → null (the caller fails closed)', () => {
  const full: Record<string, string> = {
    APPLE_TEAM_ID: 'T', APPLE_KEY_ID: 'K', APPLE_PRIVATE_KEY: 'P', APPLE_BUNDLE_ID: 'B',
  };
  assertEquals(appleConfigFromEnv((k) => full[k]), { teamId: 'T', keyId: 'K', privateKey: 'P', clientId: 'B' });
  for (const k of Object.keys(full)) {
    assertEquals(appleConfigFromEnv((x) => (x === k ? undefined : full[x])), null, `${k} missing`);
    assertEquals(appleConfigFromEnv((x) => (x === k ? '  ' : full[x])), null, `${k} blank`);
  }
});

// ---- token exchange -------------------------------------------------------------

Deno.test('exchange: 200 with a refresh token → ok; the form carries the code and a fresh secret', async () => {
  const enc = (v: unknown) => btoa(JSON.stringify(v)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const idToken = `${enc({ alg: 'RS256' })}.${enc({ sub: 'apple-sub-1' })}.sig`;
  const apple = fakeApple(() => jsonRes(200, { access_token: 'a', refresh_token: 'rt-1', id_token: idToken }));
  const r = await exchangeAppleCode(CFG, 'code-1', apple.fetchFn, NOW);
  assertEquals(r, { kind: 'ok', refreshToken: 'rt-1', sub: 'apple-sub-1' });
  assertEquals(apple.seen.length, 1);
  const { url, form, contentType } = apple.seen[0];
  assertEquals(url, 'https://appleid.apple.com/auth/token');
  assertEquals(contentType, 'application/x-www-form-urlencoded');
  assertEquals(form.get('client_id'), 'com.example.stockpile');
  assertEquals(form.get('code'), 'code-1');
  assertEquals(form.get('grant_type'), 'authorization_code');
  assertEquals(decodeJson(form.get('client_secret')!.split('.')[0]).alg, 'ES256');
});

Deno.test('exchange: 400 invalid_grant (used or expired code) → rejected', async () => {
  const apple = fakeApple(() => jsonRes(400, { error: 'invalid_grant' }));
  assertEquals(await exchangeAppleCode(CFG, 'c', apple.fetchFn, NOW), { kind: 'rejected', status: 400, error: 'invalid_grant' });
});

Deno.test('exchange: 400 invalid_client (our secret is wrong) → config, never a user error', async () => {
  const apple = fakeApple(() => jsonRes(400, { error: 'invalid_client' }));
  assertEquals(await exchangeAppleCode(CFG, 'c', apple.fetchFn, NOW), { kind: 'config', status: 400 });
});

Deno.test('exchange: 5xx, 429 and a network error → unavailable', async () => {
  for (const status of [500, 503, 429]) {
    const apple = fakeApple(() => jsonRes(status, {}));
    assertEquals(await exchangeAppleCode(CFG, 'c', apple.fetchFn, NOW), { kind: 'unavailable', status });
  }
  const down = fakeApple(() => new TypeError('connection refused'));
  assertEquals(await exchangeAppleCode(CFG, 'c', down.fetchFn, NOW), { kind: 'unavailable', status: null });
});

Deno.test('exchange: no id_token in the response → sub null (the caller refuses to bind)', async () => {
  const apple = fakeApple(() => jsonRes(200, { refresh_token: 'rt-1' }));
  assertEquals(await exchangeAppleCode(CFG, 'c', apple.fetchFn, NOW), { kind: 'ok', refreshToken: 'rt-1', sub: null });
});

Deno.test('exchange: 200 without a refresh_token is not success', async () => {
  const apple = fakeApple(() => jsonRes(200, { access_token: 'a' }));
  assertEquals((await exchangeAppleCode(CFG, 'c', apple.fetchFn, NOW)).kind, 'unavailable');
});

// ---- revoke -----------------------------------------------------------------------

Deno.test('revoke: 200 → ok; the form names the token as a refresh token', async () => {
  const apple = fakeApple(() => new Response('', { status: 200 }));
  assertEquals(await revokeAppleToken(CFG, 'rt-1', apple.fetchFn, NOW), { kind: 'ok' });
  const { url, form } = apple.seen[0];
  assertEquals(url, 'https://appleid.apple.com/auth/revoke');
  assertEquals(form.get('token'), 'rt-1');
  assertEquals(form.get('token_type_hint'), 'refresh_token');
  assertEquals(form.get('client_id'), 'com.example.stockpile');
});

Deno.test('revoke: 4xx → rejected, 5xx and network → unavailable', async () => {
  assertEquals(
    await revokeAppleToken(CFG, 'rt', fakeApple(() => jsonRes(400, { error: 'unsupported_token_type' })).fetchFn, NOW),
    { kind: 'rejected', status: 400, error: 'unsupported_token_type' },
  );
  assertEquals(await revokeAppleToken(CFG, 'rt', fakeApple(() => jsonRes(502, {})).fetchFn, NOW), {
    kind: 'unavailable',
    status: 502,
  });
  assertEquals(await revokeAppleToken(CFG, 'rt', fakeApple(() => new TypeError('x')).fetchFn, NOW), {
    kind: 'unavailable',
    status: null,
  });
});

Deno.test('nothing secret is logged: no token, code, key or secret reaches console', async () => {
  const lines: string[] = [];
  const o = { log: console.log, error: console.error, warn: console.warn };
  console.log = console.error = console.warn = (...a: unknown[]) => lines.push(a.map(String).join(' '));
  try {
    const reflect = (url: string) => jsonRes(url.endsWith('token') ? 400 : 503, { error: 'invalid_grant', echo: 'rt-SECRET' });
    await exchangeAppleCode(CFG, 'code-SECRET', fakeApple(reflect).fetchFn, NOW);
    await revokeAppleToken(CFG, 'rt-SECRET', fakeApple(reflect).fetchFn, NOW);
  } finally {
    Object.assign(console, o);
  }
  assert(lines.length > 0, 'expected the failures to be logged');
  const all = lines.join('\n');
  for (const needle of ['SECRET', 'BEGIN PRIVATE', 'eyJ']) assertFalse(all.includes(needle), `${needle} leaked: ${all}`);
});

Deno.test('an Apple error body that echoes a token never reaches a log line or a returned value', async () => {
  const lines: string[] = [];
  const o = { error: console.error, log: console.log };
  console.error = (...a: unknown[]) => lines.push(a.map(String).join(' '));
  console.log = () => {};
  let r;
  try {
    r = await exchangeAppleCode(CFG, 'c', fakeApple(() => jsonRes(400, { error: 'rt.SECRET.refresh-token user@example.com' })).fetchFn, NOW);
  } finally { Object.assign(console, o); }
  assertEquals(r, { kind: 'rejected', status: 400, error: 'error' });
  assert(lines.length > 0);
  assertFalse(lines.join('\n').includes('SECRET') || lines.join('\n').includes('@'));
});
