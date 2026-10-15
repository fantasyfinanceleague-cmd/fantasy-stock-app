// Onboarding W5 (docs/plans/2026-10-14-onboarding.md): universal links for the
// invite link (/join/<code>) and the email-confirmation return (/auth/confirm).
//
// ONE config file, apps/web/universal-links.config.json, holds every value a
// rename or an Apple account change touches (domain, Team ID, bundle id, App
// Store URL, the AASA components). This plugin turns it into:
//
//   1. dist/.well-known/apple-app-site-association: a static file, so it is
//      served whatever APP_PAUSED says (the pause is client-side routing only)
//      and Vercel serves it before its SPA rewrite. vercel.json gives it
//      Content-Type: application/json; no extension, no redirect (Apple's rules).
//   2. The same JSON in `vite dev` / `vite preview`, so it can be curl'd locally.
//   3. A build that REFUSES to finish while any placeholder is still in the
//      output. Values not yet relayed are spelled `__PLACEHOLDER__<what>` (in
//      the config or in a copy constant), and generateBundle scans every
//      emitted chunk and asset for that marker. So a placeholder cannot reach
//      prod unnoticed: the Vercel build fails instead. Never reference the
//      marker string from app source (it would trip the scan on purpose).
//
// LOCAL_ALLOW_PLACEHOLDERS=1 downgrades (3) to a warning, for verifying a
// local build only. It is ignored when VERCEL is set, so it cannot ship.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

export interface UniversalLinksConfig {
  domain: string;
  appleTeamId: string;
  iosBundleId: string;
  appScheme: string;
  appStoreUrl: string;
  /** The AASA `components`, verbatim (W3's contract): `/join/*` and the EXACT `/auth/confirm`. */
  components: { '/': string; comment?: string }[];
}

export const AASA_PATH = '/.well-known/apple-app-site-association';
export const PLACEHOLDER_MARKER = '__PLACEHOLDER__';

/** The apple-app-site-association body (the iOS 13+ `details`/`components` form). */
export function buildAasa(config: UniversalLinksConfig) {
  return {
    applinks: {
      details: [
        {
          appIDs: [`${config.appleTeamId}.${config.iosBundleId}`],
          components: config.components,
        },
      ],
    },
  };
}

export function aasaBody(config: UniversalLinksConfig): string {
  return JSON.stringify(buildAasa(config), null, 2) + '\n';
}

/** What is wrong with the config for a production build (empty = fine). */
export function configProblems(config: UniversalLinksConfig): string[] {
  const problems: string[] = [];
  if (!/^[A-Z0-9]{10}$/.test(config.appleTeamId)) {
    problems.push(`appleTeamId "${config.appleTeamId}" is not a 10-character Apple Team ID`);
  }
  if (!/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(config.iosBundleId)) {
    problems.push(`iosBundleId "${config.iosBundleId}" is not a bundle identifier`);
  }
  if (!/^https:\/\/(apps|testflight)\.apple\.com\//.test(config.appStoreUrl)) {
    problems.push(`appStoreUrl "${config.appStoreUrl}" is not an https apps.apple.com / testflight.apple.com URL`);
  }
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(config.domain)) {
    problems.push(`domain "${config.domain}" is not a bare host name`);
  }
  if (!/^[a-z][a-z0-9+.-]*$/.test(config.appScheme)) {
    problems.push(`appScheme "${config.appScheme}" is not a URL scheme`);
  }
  if (config.components.length === 0 || config.components.some((c) => !c['/']?.startsWith('/'))) {
    problems.push('components must be a non-empty list of { "/": <absolute path> }');
  }
  return problems;
}

/** File names in a Rollup bundle whose content carries the placeholder marker. */
export function filesWithPlaceholders(bundle: Record<string, { type: string; code?: string; source?: string | Uint8Array }>): string[] {
  return Object.entries(bundle)
    .filter(([, out]) => {
      const text = out.type === 'chunk' ? out.code ?? '' : typeof out.source === 'string' ? out.source : new TextDecoder().decode(out.source);
      return text.includes(PLACEHOLDER_MARKER);
    })
    .map(([name]) => name)
    .sort();
}

/** The CSP-allowed form of an inline script: `'sha256-<base64 of the sha256 of its exact text>'`. */
export function cspScriptHash(scriptText: string): string {
  return `'sha256-${createHash('sha256').update(scriptText).digest('base64')}'`;
}

/** The bare classic inline <script> blocks of a page (what the browser hashes), comments ignored. */
export function inlineScripts(html: string): string[] {
  return [...html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

/** The ONE bare inline script (the URL scrub), or null when there are none or more than one. */
export function soleInlineScript(html: string): string | null {
  const scripts = inlineScripts(html);
  return scripts.length === 1 ? scripts[0] : null;
}

/**
 * The CSP on /join and /auth (vercel.json) only allows inline script by hash,
 * so an edit to the inline scrub in index.html that doesn't update the hash
 * would have the browser BLOCK the scrub in production, and the auth code would
 * reach the supabase client. Always an error (the local placeholder escape hatch
 * does not apply): returns what is wrong, empty when every guarded path carries
 * the hash.
 */
export function cspHashProblems(html: string, vercelJson: { headers?: { source: string; headers: { key: string; value: string }[] }[] }): string[] {
  // Fail CLOSED: the scrub and the CSP are a pair. A page with no bare inline <script> (the scrub was
  // removed, or gained an attribute such as a nonce so this stops matching) would ship with the
  // code-stripping silently gone; and with TWO, the one hash the CSP carries could be the wrong one,
  // blocking the scrub. The scrub must be the only bare inline script.
  const count = inlineScripts(html).length;
  if (count === 0) return ['index.html has no bare inline <script>: the URL scrub (and the hash its CSP allows) is gone'];
  if (count > 1) return [`index.html has ${count} bare inline <script> blocks: only the URL scrub may be one (each would need its own CSP hash)`];
  const script = soleInlineScript(html) as string;
  const hash = cspScriptHash(script);
  const problems: string[] = [];
  for (const source of ['/join/:path*', '/auth/:path*']) {
    const csp = vercelJson.headers?.find((h) => h.source === source)?.headers.find((h) => h.key === 'Content-Security-Policy')?.value;
    if (!csp) problems.push(`${source} has no Content-Security-Policy header`);
    else if (!csp.includes(hash)) problems.push(`${source}'s Content-Security-Policy does not allow the inline script in index.html (expected script-src ${hash})`);
  }
  return problems;
}

export function placeholdersAllowed(env: Record<string, string | undefined>): boolean {
  return env.LOCAL_ALLOW_PLACEHOLDERS === '1' && !env.VERCEL;
}

export function universalLinks(
  config: UniversalLinksConfig,
  env: Record<string, string | undefined>,
  vercelJsonPath: string,
): Plugin {
  const serveAasa = (req: { url?: string }, res: { setHeader(k: string, v: string): void; end(body: string): void; statusCode: number }, next: () => void) => {
    // Mounted at AASA_PATH, so the remaining url is "/" (optionally a query).
    if (req.url && req.url !== '/' && !req.url.startsWith('/?')) return next();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(aasaBody(config));
  };
  const allowed = placeholdersAllowed(env);
  return {
    name: 'stockpile-universal-links',
    // After Vite's own build plugins, so index.html and every chunk are in the
    // bundle when generateBundle scans it.
    enforce: 'post',
    configureServer(server) {
      server.middlewares.use(AASA_PATH, serveAasa);
    },
    configurePreviewServer(server) {
      server.middlewares.use(AASA_PATH, serveAasa);
    },
    buildStart() {
      const problems = configProblems(config);
      if (problems.length === 0) return;
      const msg = `universal-links.config.json is not ready for a production build:\n  - ${problems.join('\n  - ')}`;
      if (allowed) this.warn(`${msg}\n(LOCAL_ALLOW_PLACEHOLDERS=1: continuing for a LOCAL build only)`);
      else this.error(msg);
    },
    generateBundle(_options, bundle) {
      this.emitFile({ type: 'asset', fileName: AASA_PATH.slice(1), source: aasaBody(config) });
      const page = bundle['index.html'] as { type: string; source?: string | Uint8Array } | undefined;
      if (!page) this.error('index.html is not in the bundle: cannot verify the CSP hash of the URL scrub');
      const html = typeof page.source === 'string' ? page.source : new TextDecoder().decode(page.source);
      const problems = cspHashProblems(html, JSON.parse(readFileSync(vercelJsonPath, 'utf-8')));
      if (problems.length) this.error(`vercel.json CSP is out of step with index.html:\n  - ${problems.join('\n  - ')}`);
      const leaks = filesWithPlaceholders(bundle as Parameters<typeof filesWithPlaceholders>[0]);
      if (leaks.length === 0) return;
      const msg = `placeholder value(s) (${PLACEHOLDER_MARKER}…) would reach production in: ${leaks.join(', ')}. Relay the real values first.`;
      if (allowed) this.warn(`${msg}\n(LOCAL_ALLOW_PLACEHOLDERS=1: continuing for a LOCAL build only)`);
      else this.error(msg);
    },
  };
}
