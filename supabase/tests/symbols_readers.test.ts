/**
 * symbols is signed-in only (20261114000000). This file proves the code side of
 * that lockdown, which must deploy BEFORE the migration:
 *
 *   1. HANDLERS — symbols-search and symbol-name, run as the REAL index.ts files,
 *      send the CALLER's JWT to PostgREST (not the bare publishable key, which
 *      would run as anon and read nothing once anon loses SELECT), and an
 *      anon-JWT caller refused by the table grant gets nothing out: no rows, no
 *      name, and no Alpaca price fetch.
 *   2. SOURCE GUARD — every edge-function reader of `symbols` is classified, as
 *      a COMPLETE set (a new reader fails here until someone decides which
 *      client it uses): caller-scoped readers forward Authorization and never
 *      hold the secret key; service-role readers build their client from
 *      SB_SECRET_KEY_INTERNAL, and the shared helpers are only ever handed that
 *      `admin` client.
 *   3. PRE-SIGN-IN SCREENS — nothing reachable from a signed-out screen (mobile
 *      auth/onboarding routes, web landing/home/login) reads symbols, directly
 *      or through the two functions, so the lockdown changes nothing there.
 *
 * Run: deno test --allow-read --allow-env supabase/tests/symbols_readers.test.ts
 * (part of `deno test --allow-read --allow-env supabase/tests/`).
 */
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert';

const ROOT = new URL('../../', import.meta.url);
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, ROOT));

// ---------------------------------------------------------------------------
// 1. Handlers
// ---------------------------------------------------------------------------

const PUBLISHABLE = 'sb_publishable_test-not-a-secret';
const CALLER_JWT = 'header.caller-user-jwt.sig';
const ANON_JWT = 'header.anon-role-jwt.sig';
const FAKE_ENV: Record<string, string> = {
  SUPABASE_URL: 'http://stub.supabase.test',
  SB_PUBLISHABLE_KEY: PUBLISHABLE,
  ALPACA_API_KEY: 'test-alpaca-id',
  ALPACA_API_SECRET: 'test-alpaca-secret',
};
const SAVED_ENV = new Map(Object.keys(FAKE_ENV).map((k) => [k, Deno.env.get(k)]));

type Handler = (req: Request) => Promise<Response>;
interface Seen { url: URL; authorization: string | null; apikey: string | null }

/** Fake upstreams: PostgREST answers /rest/v1/symbols as the role the bearer
 * maps to (the caller sees one row; anon is refused 42501, which is what the
 * migration's REVOKE ALL ... FROM anon produces); Alpaca is recorded. */
function install(): { seen: Seen[]; alpaca: string[]; restore: () => void } {
  const seen: Seen[] = [];
  const alpaca: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(req.url);
    if (url.hostname === 'data.alpaca.markets') {
      alpaca.push(url.toString());
      return new Response(JSON.stringify({ trades: { AAPL: { p: 200 } } }), { status: 200 });
    }
    if (url.pathname === '/rest/v1/symbols') {
      const authorization = req.headers.get('Authorization');
      seen.push({ url, authorization, apikey: req.headers.get('apikey') });
      if (authorization !== `Bearer ${CALLER_JWT}`) {
        return new Response(
          JSON.stringify({ code: '42501', message: 'permission denied for table symbols' }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        );
      }
      const single = (req.headers.get('accept') ?? '').includes('vnd.pgrst.object');
      const row = { symbol: 'AAPL', name: 'Apple Inc.', is_draftable: true };
      return new Response(JSON.stringify(single ? row : [row]), {
        status: 200, headers: { 'content-type': 'application/json', 'content-range': '0-0/*' },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  return { seen, alpaca, restore: () => { globalThis.fetch = original; } };
}

async function load(fn: string): Promise<Handler> {
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
  return captured;
}

const post = (h: Handler, jwt: string, body: unknown) =>
  h(new Request('http://localhost/fn', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, apikey: PUBLISHABLE, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));

Deno.test({
  name: 'symbols readers: the two edge functions query symbols AS THE CALLER',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    for (const [k, v] of Object.entries(FAKE_ENV)) Deno.env.set(k, v);
    const search = await load('symbols-search');
    const name = await load('symbol-name');
    try {
      await t.step('symbols-search: signed-in caller → every symbols read carries the caller JWT', async () => {
        const f = install();
        try {
          const res = await post(search, CALLER_JWT, { q: 'AAPL' });
          const body = await res.json();
          assertEquals(res.status, 200);
          assertEquals(body.items[0].symbol, 'AAPL');
          assertEquals(body.items[0].price, 200);
          assert(f.seen.length > 0, 'no symbols read reached PostgREST');
          for (const s of f.seen) {
            assertEquals(s.authorization, `Bearer ${CALLER_JWT}`);
            assertEquals(s.apikey, PUBLISHABLE); // least privilege: never the secret key
          }
        } finally { f.restore(); }
      });

      await t.step('symbols-search: anon-JWT caller → no rows, and no Alpaca price fetch', async () => {
        const f = install();
        try {
          const res = await post(search, ANON_JWT, { q: 'AAPL' });
          assertEquals((await res.json()).items, []);
          assert(f.seen.length > 0);
          for (const s of f.seen) assertEquals(s.authorization, `Bearer ${ANON_JWT}`);
          assertEquals(f.alpaca, [], 'an anon caller must not be able to use search as a price proxy');
        } finally { f.restore(); }
      });

      await t.step('symbol-name: signed-in caller → name, read with the caller JWT', async () => {
        const f = install();
        try {
          const res = await post(name, CALLER_JWT, { symbol: 'aapl' });
          assertEquals(await res.json(), { ok: true, symbol: 'AAPL', name: 'Apple Inc.' });
          assertEquals(f.seen.length, 1);
          assertEquals(f.seen[0].authorization, `Bearer ${CALLER_JWT}`);
          assertEquals(f.seen[0].apikey, PUBLISHABLE);
        } finally { f.restore(); }
      });

      await t.step('symbol-name: anon-JWT caller → refused, no name leaks', async () => {
        const f = install();
        try {
          const res = await post(name, ANON_JWT, { symbol: 'AAPL' });
          const body = await res.json();
          assertFalse(res.ok);
          assertFalse('name' in body && body.name);
          assertEquals(f.seen[0].authorization, `Bearer ${ANON_JWT}`);
        } finally { f.restore(); }
      });
    } finally {
      for (const [k, v] of SAVED_ENV) v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
    }
  },
});

// ---------------------------------------------------------------------------
// 2. Source guard: every edge-function reader of symbols, classified
// ---------------------------------------------------------------------------

/** caller = publishable key + forwarded Authorization (RLS applies as the user).
 *  service = SB_SECRET_KEY_INTERNAL client, deliberately: cron jobs with no
 *  caller (enrich/refresh), and server-side gates in record-trade /
 *  validate-and-record-pick whose reads must not depend on the caller's RLS.
 *  helper = a _shared module that reads with whatever client it is handed;
 *  section 2b proves every caller hands it `admin`. */
const READERS: Record<string, 'caller' | 'service' | 'helper'> = {
  'supabase/functions/symbols-search/index.ts': 'caller',
  'supabase/functions/symbol-name/index.ts': 'caller',
  'supabase/functions/enrich-symbols/index.ts': 'service',
  'supabase/functions/refresh-symbols/index.ts': 'service',
  'supabase/functions/record-trade/index.ts': 'service',
  'supabase/functions/validate-and-record-pick/index.ts': 'service',
  'supabase/functions/_shared/category-eligibility.ts': 'helper',
  'supabase/functions/_shared/draft-write.ts': 'helper',
};

function walk(dir: URL, out: string[] = []): string[] {
  for (const e of Deno.readDirSync(dir)) {
    const u = new URL(e.name + (e.isDirectory ? '/' : ''), dir);
    if (e.isDirectory) walk(u, out);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) out.push(u.href.slice(ROOT.href.length));
  }
  return out;
}

const READS_SYMBOLS = /\.from\(\s*['"]symbols['"]\s*\)/;
const FUNCTION_FILES = walk(new URL('supabase/functions/', ROOT));

Deno.test('symbols readers: the classified set is EXACTLY the set of files that read symbols', () => {
  const actual = FUNCTION_FILES.filter((f) => READS_SYMBOLS.test(read(f))).sort();
  assertEquals(actual, Object.keys(READERS).sort(),
    'a symbols reader was added or removed: classify it in READERS (caller-scoped or a deliberate service-role read)');
});

Deno.test('symbols readers: caller-scoped readers forward Authorization and never hold the secret key', () => {
  for (const [f, kind] of Object.entries(READERS)) {
    if (kind !== 'caller') continue;
    const src = read(f);
    assert(
      /createClient\([^;]*SB_PUBLISHABLE_KEY[^;]*global:\s*\{\s*headers:\s*\{\s*Authorization:\s*req\.headers\.get\('Authorization'\)/s.test(src),
      `${f}: the symbols client must be publishable key + the caller's Authorization`,
    );
    assertFalse(/SB_SECRET_KEY/.test(src), `${f}: a caller-scoped reader must not touch the secret key`);
  }
});

Deno.test('symbols readers: service-role readers read symbols only through the secret-key client', () => {
  for (const [f, kind] of Object.entries(READERS)) {
    if (kind !== 'service') continue;
    const src = read(f);
    assert(/SB_SECRET_KEY_INTERNAL/.test(src), `${f}: expected a SB_SECRET_KEY_INTERNAL client`);
    // The receiver of every .from('symbols') is the secret-key client.
    const receivers = [...src.matchAll(/(\w+)\s*\.from\(\s*['"]symbols['"]/g)].map((m) => m[1]);
    assert(receivers.length > 0);
    for (const r of receivers) {
      const decl = new RegExp(`const ${r} = createClient\\(([^;]*)\\);`).exec(src);
      assert(decl, `${f}: cannot find the declaration of ${r}`);
      assert(/SECRET_KEY|SB_SECRET_KEY_INTERNAL/.test(decl[1]) && !/PUBLISHABLE/.test(decl[1]),
        `${f}: ${r} must be the secret-key client`);
    }
  }
});

Deno.test('symbols readers: the shared helpers are only ever handed the admin (secret-key) client', () => {
  const helpers = Object.entries(READERS).filter(([, k]) => k === 'helper').map(([f]) => f);
  for (const f of FUNCTION_FILES) {
    const src = read(f);
    if (!helpers.some((h) => src.includes(`/${h.split('/').pop()}'`))) continue;
    if (helpers.includes(f)) continue;
    // No call passes the caller-scoped client into anything.
    assertFalse(/\(\s*authed\s*[,)]/.test(src), `${f}: passes the caller-scoped client into a call`);
    if (/const admin = createClient\(/.test(src)) {
      assert(/const admin = createClient\(SUPABASE_URL, SECRET_KEY\)/.test(src) &&
        /const SECRET_KEY = Deno\.env\.get\('SB_SECRET_KEY_INTERNAL'\)/.test(src),
        `${f}: admin must be the SB_SECRET_KEY_INTERNAL client`);
    }
  }
});

// ---------------------------------------------------------------------------
// 3. Pre-sign-in screens never read symbols
// ---------------------------------------------------------------------------

const SYMBOLS_TOUCH = /\.from\(\s*['"]symbols['"]|['"]symbols-search['"]|['"]symbol-name['"]/;

/** Local imports only (relative, or mobile's '@/'), followed transitively. */
function reach(entry: string, alias: string | null): Map<string, string> {
  const seen = new Map<string, string>();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    let src: string;
    try { src = read(f); } catch { continue; }
    seen.set(f, src);
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      let spec = m[1];
      if (alias && spec.startsWith('@/')) spec = alias + spec.slice(2);
      else if (spec.startsWith('.')) spec = new URL(spec, new URL(f, ROOT)).href.slice(ROOT.href.length);
      else continue;
      for (const ext of ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js']) {
        try { Deno.statSync(new URL(spec + ext, ROOT)).isFile && stack.push(spec + ext); break; } catch { /* next */ }
      }
    }
  }
  return seen;
}

Deno.test('symbols readers: no pre-sign-in screen (mobile or web) reaches a symbols read', () => {
  const entries: Array<[string, string | null]> = [
    ...['login', 'create-account', 'forgot-password', 'reset-password', 'get-started', 'onboarding',
      'pick-username', 'username'].map((s): [string, string | null] => [`apps/mobile/app/${s}.tsx`, 'apps/mobile/']),
    ...['LandingPage', 'Home', 'Login'].map((s): [string, string | null] => [`apps/web/src/pages/${s}.jsx`, null]),
  ];
  for (const [entry, alias] of entries) {
    const files = reach(entry, alias);
    assert(files.has(entry), `${entry} missing — update this list if the screen moved`);
    for (const [f, src] of files) {
      assertFalse(SYMBOLS_TOUCH.test(src), `${entry} reaches ${f}, which reads symbols`);
    }
  }
});
