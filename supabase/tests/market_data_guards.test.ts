/**
 * The market-data functions spend the shared server-side Alpaca key, so each is
 * guarded (ruling 2026-10-08: nothing scrapable). Run against the REAL index.ts
 * files: Deno.serve is captured, and fetch is a fake GoTrue (/auth/v1/user), a
 * fake limiter (rpc/check_and_bump_rate_limit) and a fake Alpaca that records
 * every request. Each function is proven on BOTH sides -- the real player still
 * gets data (the negative control), and the refused caller gets nothing AND
 * spends nothing (zero Alpaca requests).
 *
 * Run: deno test --allow-read --allow-env supabase/tests/market_data_guards.test.ts
 */
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert';

const URL_ = 'http://stub.supabase.test';
const USER_JWT = 'header.real-user.sig';
const ANON_JWT = 'header.anon-role.sig';
const USER_ID = '00000000-0000-4000-8000-0000000000aa';
const VENDOR_TEXT = 'ALPACA-INTERNAL-ERROR-TEXT-do-not-echo';

const FAKE_ENV: Record<string, string> = {
  SUPABASE_URL: URL_,
  SB_PUBLISHABLE_KEY: 'sb_publishable_test-not-a-secret',
  SB_SECRET_KEY_INTERNAL: 'test-internal-key-not-a-secret',
  ALPACA_API_KEY: 'test-alpaca-id',
  ALPACA_API_SECRET: 'test-alpaca-secret',
};
const SAVED_ENV = new Map(Object.keys(FAKE_ENV).map((k) => [k, Deno.env.get(k)]));

type Handler = (req: Request) => Promise<Response>;
type LimiterMode = 'ok' | 'limited' | 'error' | 'null' | 'throw';

class Fake {
  limiter: LimiterMode = 'ok';
  alpacaFails = false;
  alpaca: string[] = [];
  limits: Array<{ bucket: string; subject: string; limit: number }> = [];
  userLookups = 0;
}

function install(f: Fake): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(req.url);
    const ok = (b: unknown, status = 200) =>
      new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (url.hostname === 'data.alpaca.markets') {
      f.alpaca.push(url.pathname + url.search);
      if (f.alpacaFails) return new Response(VENDOR_TEXT, { status: 500 });
      if (url.pathname.endsWith('/trades/latest')) return ok({ trade: { p: 200 } });
      if (url.pathname.endsWith('/snapshot')) return ok({ prevDailyBar: { c: 190 }, dailyBar: { o: 195 } });
      if (url.pathname === '/v2/stocks/bars') {
        const syms = (url.searchParams.get('symbols') ?? '').split(',');
        const bars: Record<string, unknown[]> = {};
        for (const s of syms) bars[s] = [{ t: '2026-10-01T04:00:00Z', o: 1, h: 1, l: 1, c: 1, v: 1 }];
        return ok({ bars, next_page_token: null });
      }
      return ok({});
    }
    if (url.pathname === '/auth/v1/user') {
      f.userLookups++;
      return req.headers.get('Authorization') === `Bearer ${USER_JWT}`
        ? ok({ id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'p@example.test' })
        : ok({ code: 403, error_code: 'bad_jwt', msg: 'invalid claim: missing sub claim' }, 403);
    }
    if (url.pathname === '/rest/v1/rpc/check_and_bump_rate_limit') {
      const b = await req.json();
      f.limits.push({ bucket: b.p_bucket, subject: b.p_subject, limit: b.p_limit });
      if (f.limiter === 'throw') throw new TypeError('network down');
      if (f.limiter === 'error') return ok({ code: 'XX000', message: 'limiter down' }, 500);
      return ok(f.limiter === 'ok' ? true : f.limiter === 'limited' ? false : null);
    }
    throw new Error(`unexpected fetch ${req.method} ${url}`);
  }) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

const handlers = new Map<string, Handler>();
async function load(fn: string): Promise<Handler> {
  const cached = handlers.get(fn);
  if (cached) return cached;
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
  handlers.set(fn, captured);
  return captured;
}

function post(h: Handler, body: unknown, opts: { jwt?: string | null; ip?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.jwt !== null) headers.Authorization = `Bearer ${opts.jwt ?? USER_JWT}`;
  if (opts.ip) headers['x-forwarded-for'] = `${opts.ip}, 10.0.0.1`;
  return h(new Request('http://localhost/fn', { method: 'POST', headers, body: JSON.stringify(body) }));
}

/** Runs `fn` with env set and a fresh fake installed. */
async function withFake<T>(fn: (f: Fake) => Promise<T>, setup?: (f: Fake) => void): Promise<T> {
  for (const [k, v] of Object.entries(FAKE_ENV)) Deno.env.set(k, v);
  const f = new Fake();
  setup?.(f);
  const restore = install(f);
  try { return await fn(f); } finally { restore(); }
}

Deno.test({
  name: 'market data guards: quote',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const quote = await load('quote');

    await t.step('control: a signed-in player gets a price; one per-user limiter bump', () => withFake(async (f) => {
      const res = await post(quote, { symbol: 'AAPL' });
      assertEquals(res.status, 200);
      assertEquals((await res.json()).price, 200);
      assertEquals(f.limits, [{ bucket: 'quote', subject: `user:${USER_ID}`, limit: 120 }]);
      assert(f.alpaca.length > 0);
    }));

    for (const [label, jwt] of [['the bare anon JWT', ANON_JWT], ['no Authorization at all', null]] as const) {
      await t.step(`${label} → 401, no limiter bump, no Alpaca, not even a cached price`, () => withFake(async (f) => {
        // AAPL is in the module cache from the control step: the guard runs first.
        const res = await post(quote, { symbol: 'AAPL' }, { jwt });
        assertEquals(res.status, 401);
        assertEquals((await res.json()).error, 'not_authenticated');
        assertEquals(f.limits, []);
        assertEquals(f.alpaca, []);
      }));
    }

    for (const mode of ['limited', 'error', 'null', 'throw'] as const) {
      await t.step(`limiter ${mode} → refused (fail closed), no Alpaca`, () => withFake(async (f) => {
        const res = await post(quote, { symbol: 'MSFT' });
        assertEquals(res.status, mode === 'limited' ? 429 : 503);
        assertEquals(f.alpaca, []);
      }, (f) => { f.limiter = mode; }));
    }

    await t.step('batch: deduped, capped at 250, overflow REPORTED; a full 16x12 league fits', () => withFake(async (f) => {
      const league = Array.from({ length: 192 }, (_, i) => `L${i}`);
      const r1 = await post(quote, { symbols: [...league, ...league.map((s) => s.toLowerCase())] });
      const b1 = await r1.json();
      assertEquals(Object.keys(b1.prices).length, 192);
      assertEquals(b1.truncatedSymbols, undefined);

      f.alpaca = [];
      const big = Array.from({ length: 260 }, (_, i) => `B${i}`);
      const b2 = await (await post(quote, { symbols: big })).json();
      assertEquals(Object.keys(b2.prices).length, 250);
      assertEquals(b2.truncatedSymbols, big.slice(250));
      assertFalse(f.alpaca.some((u) => u.includes('/B259/')), 'a truncated symbol reached Alpaca');
    }));

    await t.step('a vendor failure never echoes vendor text', () => withFake(async () => {
      const res = await post(quote, { symbol: 'ZZZQ' });
      assertEquals(res.status, 404);
      assertFalse((await res.text()).includes(VENDOR_TEXT));
    }, (f) => { f.alpacaFails = true; }));
  },
});

Deno.test({
  name: 'market data guards: historical-bars',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const bars = await load('historical-bars');
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

    await t.step('control: the stock sheet\'s real 1Y request (today - 400 d) is served unclamped', () => withFake(async (f) => {
      const res = await post(bars, { symbols: ['AAPL'], start: daysAgo(400) });
      assertEquals(res.status, 200);
      const b = await res.json();
      assertEquals(b.bars.AAPL.length, 1);
      assertEquals(b.startClamped, false);
      assertEquals(b.complete, true);
      assertEquals(f.limits, [{ bucket: 'historical-bars', subject: `user:${USER_ID}`, limit: 60 }]);
      assert(f.alpaca[0].includes(`start=${daysAgo(400)}`));
    }));

    for (const [label, jwt] of [['the bare anon JWT', ANON_JWT], ['no Authorization at all', null]] as const) {
      await t.step(`${label} → 401, no limiter bump, no Alpaca`, () => withFake(async (f) => {
        const res = await post(bars, { symbols: ['AAPL'], start: daysAgo(5) }, { jwt });
        assertEquals(res.status, 401);
        assertEquals(f.limits, []);
        assertEquals(f.alpaca, []);
      }));
    }

    for (const mode of ['limited', 'error', 'null'] as const) {
      await t.step(`limiter ${mode} → refused (fail closed), no Alpaca`, () => withFake(async (f) => {
        const res = await post(bars, { symbols: ['AAPL'], start: daysAgo(5) });
        assertEquals(res.status, mode === 'limited' ? 429 : 503);
        assertEquals(f.alpaca, []);
      }, (f) => { f.limiter = mode; }));
    }

    await t.step('a bulk-history start is clamped to 407 days and REPORTED (complete:false)', () => withFake(async (f) => {
      const b = await (await post(bars, { symbols: ['AAPL'], start: '1990-01-01' })).json();
      assertEquals(b.startClamped, true);
      assertEquals(b.complete, false);
      assertFalse(f.alpaca.some((u) => u.includes('start=1990')), 'the unclamped start reached Alpaca');
      assert(f.alpaca[0].includes(`start=${daysAgo(407)}`));
    }));

    await t.step('a vendor failure returns the status only, never vendor text', () => withFake(async () => {
      const res = await post(bars, { symbols: ['AAPL'], start: daysAgo(5) });
      assertEquals(res.status, 500);
      assertFalse((await res.text()).includes(VENDOR_TEXT));
    }, (f) => { f.alpacaFails = true; }));
  },
});

Deno.test({
  name: 'market data guards: ticker-quotes (verify_jwt=false, the handler is the boundary)',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const tq = await load('ticker-quotes');

    await t.step('control: a signed-in user quotes ANY symbol under a per-user limit', () => withFake(async (f) => {
      const res = await post(tq, { symbol: 'ZZZQ' });
      assertEquals(res.status, 200);
      assertEquals((await res.json()).price, 200);
      assertEquals(f.limits, [{ bucket: 'ticker-quotes', subject: `user:${USER_ID}`, limit: 120 }]);
    }));

    await t.step('control: an anonymous visitor gets the ticker tape (AAPL), limited per IP', () => withFake(async (f) => {
      const res = await post(tq, { symbol: 'aapl' }, { jwt: null, ip: '203.0.113.5' });
      assertEquals(res.status, 200);
      assertEquals(f.limits, [{ bucket: 'ticker-quotes-anon', subject: 'ip:203.0.113.5', limit: 60 }]);
    }));

    for (const [label, jwt] of [['no Authorization', null], ['the bare anon JWT', ANON_JWT]] as const) {
      await t.step(`${label} + a symbol OFF the tape → 401, no limiter bump, no Alpaca`, () => withFake(async (f) => {
        const res = await post(tq, { symbol: 'ZZZQ' }, { jwt, ip: '203.0.113.5' });
        assertEquals(res.status, 401);
        assertEquals(f.limits, []);
        assertEquals(f.alpaca, []);
      }));
    }

    for (const mode of ['limited', 'error', 'null'] as const) {
      await t.step(`anonymous tape symbol, limiter ${mode} → refused (fail closed), no Alpaca`, () => withFake(async (f) => {
        const res = await post(tq, { symbol: 'MSFT' }, { jwt: null, ip: '203.0.113.9' });
        assertEquals(res.status, mode === 'limited' ? 429 : 503);
        assertEquals(f.alpaca, []);
      }, (f) => { f.limiter = mode; }));
    }

    await t.step('signed-in, limiter limited → 429 (the user path is limited too)', () => withFake(async (f) => {
      assertEquals((await post(tq, { symbol: 'ZZZR' })).status, 429);
      assertEquals(f.alpaca, []);
    }, (f) => { f.limiter = 'limited'; }));

    await t.step('no client IP → one shared ip:unknown bucket, not a free pass', () => withFake(async (f) => {
      await post(tq, { symbol: 'KO' }, { jwt: null });
      assertEquals(f.limits.map((l) => l.subject), ['ip:unknown']);
    }));

    await t.step('a vendor failure never echoes vendor text', () => withFake(async () => {
      const res = await post(tq, { symbol: 'ZZZS' });
      assertEquals(res.status, 404);
      assertFalse((await res.text()).includes(VENDOR_TEXT));
    }, (f) => { f.alpacaFails = true; }));
  },
});

Deno.test('ticker-quotes: the anonymous allowlist is EXACTLY the web ticker tape\'s SYMBOLS', () => {
  const arr = (src: string, name: string) => {
    const m = new RegExp(`${name}[^=]*=\\s*\\[([^\\]]*)\\]`).exec(src);
    assert(m, `${name} not found`);
    return [...m[1].matchAll(/['"]([A-Z.]+)['"]/g)].map((x) => x[1]).sort();
  };
  const read = (rel: string) => Deno.readTextFileSync(new URL(`../../${rel}`, import.meta.url));
  const server = arr(read('supabase/functions/ticker-quotes/index.ts'), 'TICKER_SYMBOLS');
  const web = arr(read('apps/web/src/Ticker.jsx'), 'const SYMBOLS');
  assertEquals(server.length, 21);
  assertEquals(server, web);
});

// Put the developer's env back after every test in this file has run.
globalThis.addEventListener('unload', () => {
  for (const [k, v] of SAVED_ENV) v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
});


Deno.test('finnhub-quote is gone: no function, no config block, no client invoke', () => {
  const root = new URL('../../', import.meta.url);
  let exists = true;
  try { Deno.statSync(new URL('supabase/functions/finnhub-quote/index.ts', root)); } catch { exists = false; }
  assertFalse(exists, 'finnhub-quote was re-added; it needs the market-data guard (or stays deleted)');
  assertFalse(Deno.readTextFileSync(new URL('supabase/config.toml', root)).includes('[functions.finnhub-quote]'));
  const walk = (dir: URL): string[] => [...Deno.readDirSync(dir)].flatMap((e) =>
    e.name === 'node_modules' || e.name.startsWith('.') ? []
      : e.isDirectory ? walk(new URL(`${e.name}/`, dir))
      : /\.(jsx?|tsx?)$/.test(e.name) ? [new URL(e.name, dir).href] : []);
  for (const app of ['apps/web/src/', 'apps/mobile/app/', 'apps/mobile/lib/', 'apps/mobile/components/']) {
    for (const f of walk(new URL(app, root))) {
      assertFalse(/invoke\(\s*['"]finnhub-quote['"]/.test(Deno.readTextFileSync(new URL(f))), `${f} invokes finnhub-quote`);
    }
  }
});
