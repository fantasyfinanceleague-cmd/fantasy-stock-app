// @vitest-environment node
//
// Pure fs/string logic — no DOM needed, and jsdom's import.meta.url shim
// isn't a real file:// URL, which breaks fileURLToPath below.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Phase 3a (docs/design/prompts/phase3a-landing.md, "Isolation"): the
// public landing loads NONE of the legacy app CSS and runs NONE of the app
// providers' side effects. Structurally: main.jsx and App.jsx statically
// import only the router, the crash guard and the landing; everything else
// lives in AppShell.jsx, which App.jsx reaches only through a lazy import()
// folded away while APP_PAUSED. This is the fast static check; the real
// proof is the built dist/ (grep for a layout.css selector, the landing's
// network log) in the worker's DONE report.
//
// (Phase 2's version of this file asserted the opposite premise — that the
// production entry never touched src/design at all — because the landing
// wasn't on the design system yet.)

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8');

const entryFiles = { 'main.jsx': read('../main.jsx'), 'App.jsx': read('../App.jsx') };

const staticImports = (text: string) =>
  [...text.matchAll(/^\s*import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm)].map((m) => m[1]);

const LEGACY = [
  /(^|\/)layout\.css$/,
  /(^|\/)index\.css$/,
  /(^|\/)App\.css$/,
  /stockpile-tokens\.css$/,
  /\/context\//,
  /supabase/,
  /components\/(Toast|SessionMonitor|HelpWalkthrough|Protected)/,
  /^\.\/pages\/(?!landing\/)/,
  /^\.\/(Layout|Header|Footer|AppShell|AppRoutes)$/,
];

describe('the production entry points import only what the landing needs', () => {
  it.each(Object.keys(entryFiles))('%s statically imports no legacy CSS, provider, Supabase or app page', (name) => {
    const imports = staticImports(entryFiles[name as keyof typeof entryFiles]);
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) {
      for (const pattern of LEGACY) expect(spec).not.toMatch(pattern);
    }
  });

  it.each(Object.keys(entryFiles))('%s never pulls design/fonts.css (a render-blocking @import) or the barrel', (name) => {
    const imports = staticImports(entryFiles[name as keyof typeof entryFiles]);
    for (const spec of imports) {
      expect(spec).not.toMatch(/design\/fonts\.css$/);
      expect(spec).not.toMatch(/\/design(\/index)?$/);
    }
  });

  it('App.jsx reaches the app shell only through a lazy import folded on APP_PAUSED', () => {
    const app = entryFiles['App.jsx'];
    expect(app).toMatch(/const AppShell = APP_PAUSED \? null : lazy\(\(\) => import\("\.\/AppShell"\)\);/);
  });
});

describe('the app shell carries what the entry no longer does', () => {
  const shell = read('../AppShell.jsx');
  const imports = staticImports(shell);

  it('imports the legacy CSS and every app-wide provider', () => {
    expect(imports).toEqual(
      expect.arrayContaining([
        './layout.css',
        './index.css',
        './context/PriceContext',
        './context/UserProfilesContext',
        './components/Toast',
        './context/HelpContext',
        './components/HelpWalkthrough',
        './components/SessionMonitor',
        './AppRoutes',
      ])
    );
  });
});
