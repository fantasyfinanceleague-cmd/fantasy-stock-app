// @vitest-environment node
//
// The apple-app-site-association contract (onboarding W5): the right JSON, at
// the right path, as application/json, never behind a redirect or the SPA
// rewrite, and a production build that refuses to ship a placeholder.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import shipped from '../universal-links.config.json';
import {
  AASA_PATH,
  aasaBody,
  cspHashProblems,
  cspScriptHash,
  firstInlineScript,
  buildAasa,
  configProblems,
  filesWithPlaceholders,
  placeholdersAllowed,
  universalLinks,
  type UniversalLinksConfig,
} from './universalLinks';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8');

const ready: UniversalLinksConfig = {
  domain: 'fantasy-stock-app.vercel.app',
  appleTeamId: 'ABCDE12345',
  iosBundleId: 'com.stockpile.fantasystock',
  appScheme: 'fantasystockapp',
  appStoreUrl: 'https://apps.apple.com/app/id1234567890',
  components: [
    { '/': '/join/*', comment: 'invite links; the app validates the code' },
    { '/': '/auth/confirm', comment: 'email-confirmation return (PKCE code in the query)' },
  ],
};

// W3's contract, verbatim (relayed by the Orchestrator, 2026-10-14), with the real Team ID.
const RELAYED_AASA = {
  applinks: {
    details: [
      {
        appIDs: ['688SPM7BS6.com.stockpile.fantasystock'],
        components: [
          { '/': '/join/*', comment: 'invite links; the app validates the code' },
          { '/': '/auth/confirm', comment: 'email-confirmation return (PKCE code in the query)' },
        ],
      },
    ],
  },
};

describe('the AASA body', () => {
  it('is applinks for /join/* and the EXACT /auth/confirm, for TeamID.bundleId', () => {
    expect(buildAasa(ready).applinks.details[0].appIDs).toEqual(['ABCDE12345.com.stockpile.fantasystock']);
    expect(buildAasa(ready).applinks.details[0].components.map((c) => c['/'])).toEqual(['/join/*', '/auth/confirm']);
  });

  it("the shipped config produces W3's relayed JSON exactly", () => {
    expect(buildAasa(shipped as UniversalLinksConfig)).toEqual(RELAYED_AASA);
  });

  it('never hands a web-only auth path to the app (no wildcard on /auth/confirm)', () => {
    const paths = buildAasa(shipped as UniversalLinksConfig).applinks.details[0].components.map((c) => c['/']);
    expect(paths.filter((p) => p.startsWith('/auth/'))).toEqual(['/auth/confirm']);
    expect(paths.some((p) => p.includes('*') && p.startsWith('/auth'))).toBe(false);
  });

  it('is valid JSON', () => {
    expect(JSON.parse(aasaBody(ready))).toEqual(buildAasa(ready));
  });

  it('is served at the extension-less well-known path', () => {
    expect(AASA_PATH).toBe('/.well-known/apple-app-site-association');
  });
});

describe('the shipped config', () => {
  const appJson = JSON.parse(read('../../mobile/app.json')).expo;

  it('carries the real Team ID', () => {
    expect(shipped.appleTeamId).toBe('688SPM7BS6');
  });

  it("names the app's own bundle id and scheme (apps/mobile/app.json)", () => {
    expect(shipped.iosBundleId).toBe(appJson.ios.bundleIdentifier);
    expect(shipped.appScheme).toBe(appJson.scheme);
  });

  it('keeps the domain as one bare host', () => {
    expect(shipped.domain).toBe('fantasy-stock-app.vercel.app');
  });
});

describe('configProblems', () => {
  it('passes a ready config', () => {
    expect(configProblems(ready)).toEqual([]);
  });

  it('the shipped config is ready except the App Store URL (still a placeholder)', () => {
    expect(configProblems(shipped as UniversalLinksConfig).map((p) => p.split(' ')[0])).toEqual(['appStoreUrl']);
  });

  it('refuses the placeholder Team ID and App Store URL', () => {
    const problems = configProblems({ ...ready, appleTeamId: '__PLACEHOLDER__APPLE_TEAM_ID', appStoreUrl: '__PLACEHOLDER__APP_STORE_URL' });
    expect(problems).toHaveLength(2);
    expect(problems.join('\n')).toMatch(/appleTeamId/);
    expect(problems.join('\n')).toMatch(/appStoreUrl/);
  });

  it('refuses a non-Apple store URL, a lowercase Team ID, a URL as the domain', () => {
    expect(configProblems({ ...ready, appStoreUrl: 'https://evil.example/app' })).toHaveLength(1);
    expect(configProblems({ ...ready, appleTeamId: 'abcde12345' })).toHaveLength(1);
    expect(configProblems({ ...ready, domain: 'https://fantasy-stock-app.vercel.app' })).toHaveLength(1);
  });

  it('accepts a TestFlight link', () => {
    expect(configProblems({ ...ready, appStoreUrl: 'https://testflight.apple.com/join/AbCdEf12' })).toEqual([]);
  });
});

describe('the placeholder scan', () => {
  it('names every chunk or asset carrying the marker', () => {
    const bundle = {
      'assets/index.js': { type: 'chunk', code: 'console.log("landing")' },
      'assets/JoinPage.js': { type: 'chunk', code: 'const a="__PLACEHOLDER__ Open in the app"' },
      '.well-known/apple-app-site-association': { type: 'asset', source: '{"appIDs":["__PLACEHOLDER__APPLE_TEAM_ID.x"]}' },
      'logo.png': { type: 'asset', source: new Uint8Array([1, 2, 3]) },
    };
    expect(filesWithPlaceholders(bundle)).toEqual(['.well-known/apple-app-site-association', 'assets/JoinPage.js']);
  });

  it('only lets a LOCAL build through, never on Vercel', () => {
    expect(placeholdersAllowed({})).toBe(false);
    expect(placeholdersAllowed({ LOCAL_ALLOW_PLACEHOLDERS: '1' })).toBe(true);
    expect(placeholdersAllowed({ LOCAL_ALLOW_PLACEHOLDERS: '1', VERCEL: '1' })).toBe(false);
  });

  it('fails the build on a placeholder config', () => {
    const plugin = universalLinks({ ...ready, appleTeamId: '__PLACEHOLDER__APPLE_TEAM_ID' }, {});
    const ctx = { error: (m: string) => { throw new Error(m); }, warn: () => {} };
    expect(() => (plugin.buildStart as unknown as (this: typeof ctx) => void).call(ctx)).toThrow(/appleTeamId/);
  });

  it('fails the build when a placeholder reaches the bundle, and emits the AASA', () => {
    const emitted: { fileName: string; source: string }[] = [];
    const ctx = {
      error: (m: string) => { throw new Error(m); },
      warn: () => {},
      emitFile: (f: { fileName: string; source: string }) => { emitted.push(f); return 'id'; },
    };
    const plugin = universalLinks(ready, {});
    const gen = plugin.generateBundle as unknown as (this: typeof ctx, o: unknown, b: unknown) => void;
    expect(() => gen.call(ctx, {}, { 'a.js': { type: 'chunk', code: 'x' } })).not.toThrow();
    expect(emitted).toEqual([{ type: 'asset', fileName: '.well-known/apple-app-site-association', source: aasaBody(ready) }]);
    expect(() => gen.call(ctx, {}, { 'a.js': { type: 'chunk', code: '"__PLACEHOLDER__ x"' } })).toThrow(/a\.js/);
  });
});

describe('the dev / preview server', () => {
  it('serves the AASA as application/json, 200, no redirect', () => {
    let handler: ((req: { url?: string }, res: unknown, next: () => void) => void) | undefined;
    const server = { middlewares: { use: (path: string, fn: typeof handler) => { expect(path).toBe(AASA_PATH); handler = fn; } } };
    (universalLinks(ready, {}).configureServer as unknown as (s: typeof server) => void)(server);
    const headers: Record<string, string> = {};
    const res = { statusCode: 0, body: '', setHeader: (k: string, v: string) => { headers[k] = v; }, end(b: string) { this.body = b; } };
    handler!({ url: '/' }, res, () => { throw new Error('should not fall through'); });
    expect(res.statusCode).toBe(200);
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers.Location).toBeUndefined();
    expect(JSON.parse(res.body)).toEqual(buildAasa(ready));
  });
});

describe('vercel.json', () => {
  const vercel = JSON.parse(read('../vercel.json'));
  // Vercel's `source` is path-to-regexp; these sources are plain regex groups.
  const sourceRe = (source: string) => new RegExp(`^${source}$`);

  it('serves the AASA as application/json', () => {
    const rule = vercel.headers.find((h: { source: string }) => h.source === AASA_PATH);
    expect(rule.headers).toContainEqual({ key: 'Content-Type', value: 'application/json' });
  });

  it('has no redirect at all (Apple refuses a redirected AASA)', () => {
    expect(vercel.redirects ?? []).toEqual([]);
    expect(vercel.cleanUrls ?? false).toBe(false);
    expect(vercel.trailingSlash).toBeUndefined();
  });

  it('never rewrites /.well-known/* to the SPA, but still rewrites app paths', () => {
    expect(vercel.rewrites).toHaveLength(1);
    const re = sourceRe(vercel.rewrites[0].source);
    expect(re.test(AASA_PATH)).toBe(false);
    for (const p of ['/', '/join/ABCDE23456', '/auth/confirm', '/dashboard']) expect(re.test(p)).toBe(true);
  });

  it('sends no Referer, no framing, no sniffing, and asks not to be indexed on /join and /auth', () => {
    for (const source of ['/join/:path*', '/auth/:path*']) {
      const rule = vercel.headers.find((h: { source: string }) => h.source === source);
      expect(rule.headers).toContainEqual({ key: 'Referrer-Policy', value: 'no-referrer' });
      expect(rule.headers).toContainEqual({ key: 'X-Robots-Tag', value: 'noindex, nofollow' });
      expect(rule.headers).toContainEqual({ key: 'X-Frame-Options', value: 'DENY' });
      expect(rule.headers).toContainEqual({ key: 'X-Content-Type-Options', value: 'nosniff' });
    }
    const aasa = vercel.headers.find((h: { source: string }) => h.source === AASA_PATH);
    expect(aasa.headers).toContainEqual({ key: 'X-Content-Type-Options', value: 'nosniff' });
  });

  it('puts the landing and every other path under NO header rule of ours', () => {
    expect(vercel.headers.map((h: { source: string }) => h.source).sort()).toEqual(['/.well-known/apple-app-site-association', '/auth/:path*', '/join/:path*']);
  });

  describe('the Content-Security-Policy on /join and /auth', () => {
    const csp = (source: string) =>
      vercel.headers.find((h: { source: string }) => h.source === source).headers.find((h: { key: string }) => h.key === 'Content-Security-Policy').value as string;
    const directives = (value: string) => Object.fromEntries(value.split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));

    it.each(['/join/:path*', '/auth/:path*'])('%s allows only itself, the project API, and the one inline script by hash', (source) => {
      const d = directives(csp(source));
      expect(d['default-src']).toEqual(["'self'"]);
      expect(d['script-src'].filter((v) => !v.startsWith("'sha256-"))).toEqual(["'self'"]);
      expect(d['script-src'].filter((v) => v.startsWith("'sha256-"))).toHaveLength(1);
      expect(d['connect-src']).toEqual(["'self'", 'https://haiaaifjcclsvmkfqgmd.supabase.co']);
      expect(d['style-src']).toEqual(["'self'"]);
      expect(d['font-src']).toEqual(["'self'"]);
      expect(d['frame-ancestors']).toEqual(["'none'"]);
      expect(d['base-uri']).toEqual(["'none'"]);
      expect(JSON.stringify(d)).not.toMatch(/unsafe-|\*|http:/);
    });

    it("carries the SHA-256 of index.html's inline script", () => {
      const script = firstInlineScript(read('../index.html'))!;
      for (const source of ['/join/:path*', '/auth/:path*']) expect(csp(source)).toContain(cspScriptHash(script));
    });
  });
});

describe('the CSP / inline-script guard (a stale hash would block the scrub in production)', () => {
  const html = (body: string) => `<head><script>${body}</script><script type="module" src="/a.js"></script></head>`;
  const vercelFor = (hash: string) => ({
    headers: ['/join/:path*', '/auth/:path*'].map((source) => ({ source, headers: [{ key: 'Content-Security-Policy', value: `script-src 'self' ${hash}` }] })),
  });

  it('only looks at a classic inline script, never the module tag', () => {
    expect(firstInlineScript(html('var a=1;'))).toBe('var a=1;');
    expect(firstInlineScript('<script type="module" src="/a.js"></script>')).toBeNull();
  });

  it('passes when both paths carry the current hash', () => {
    expect(cspHashProblems(html('var a=1;'), vercelFor(cspScriptHash('var a=1;')))).toEqual([]);
  });

  it('fails, per path, when the script changed and the hash did not (even by one space)', () => {
    const problems = cspHashProblems(html('var a=1; '), vercelFor(cspScriptHash('var a=1;')));
    expect(problems).toHaveLength(2);
    expect(problems.join('\n')).toMatch(/does not allow the inline script/);
  });

  it('fails when a guarded path has no CSP at all', () => {
    expect(cspHashProblems(html('x'), { headers: [] })).toHaveLength(2);
  });

  it('is a hard error in the build, whatever LOCAL_ALLOW_PLACEHOLDERS says', () => {
    const plugin = universalLinks(ready, { LOCAL_ALLOW_PLACEHOLDERS: '1' }, fileURLToPath(new URL('../vercel.json', import.meta.url)));
    const ctx = { error: (m: string) => { throw new Error(m); }, warn: () => {}, emitFile: () => 'id' };
    const gen = plugin.generateBundle as unknown as (this: typeof ctx, o: unknown, b: unknown) => void;
    expect(() => gen.call(ctx, {}, { 'index.html': { type: 'asset', source: html('var tampered=1;') } })).toThrow(/CSP is out of step/);
    const real = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf-8');
    expect(() => gen.call(ctx, {}, { 'index.html': { type: 'asset', source: real } })).not.toThrow();
  });
});
