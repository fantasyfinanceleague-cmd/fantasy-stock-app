// @vitest-environment node
//
// Pure fs/string logic — no DOM needed, and jsdom's import.meta.url shim
// isn't a real file:// URL, which breaks fileURLToPath below.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Fast, static first line of defense for the branch's hardest requirement:
// merging to main deploys the web app to Vercel, and the landing must ship
// byte-identical. The real proof is a `dist/` diff against origin/main (see
// the worker's DONE report) — this test just catches an accidental import
// early, at `npm test` speed, before anyone reaches for a full build.

const entryFiles = ['../main.jsx', '../App.jsx'].map((rel) =>
  fileURLToPath(new URL(rel, import.meta.url))
);

const forbiddenPatterns = [
  /from ['"].*\/design(\/index)?['"]/,
  /from ['"].*styles\/tokens\.css['"]/,
  /from ['"].*design\/fonts\.css['"]/,
];

describe('the production entry points never import the design system', () => {
  it.each(entryFiles)('%s has no import of src/design or its CSS', (file) => {
    const text = readFileSync(file, 'utf-8');
    for (const pattern of forbiddenPatterns) {
      expect(text).not.toMatch(pattern);
    }
  });
});

// Onboarding W5: while APP_PAUSED, the landing plus the two public onboarding
// pages are the whole reachable app. Pinned here so a new route can't slip
// into the paused tree unnoticed.
describe('the paused route table (onboarding W5)', () => {
  const app = readFileSync(fileURLToPath(new URL('../App.jsx', import.meta.url)), 'utf-8');
  const pausedStart = app.indexOf('if (APP_PAUSED) {');
  const pausedBlock = app.slice(pausedStart, app.indexOf('</Routes>', pausedStart));
  const routeConsts = Object.fromEntries(
    [...app.matchAll(/const (\w+) = <Route path="([^"]+)"/g)].map((m) => [m[1], m[2]]),
  );

  it('is exactly /, /join/:code, /auth/confirm, /auth/web-callback and the catch-all back to /', () => {
    expect(pausedStart).toBeGreaterThan(0);
    const literal = [...pausedBlock.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]);
    const referenced = [...pausedBlock.matchAll(/\{(\w+Route)\}/g)].map((m) => routeConsts[m[1]]);
    expect([...literal, ...referenced].sort()).toEqual(['*', '/', '/auth/confirm', '/auth/web-callback', '/join/:code']);
    expect(pausedBlock).toMatch(/<Route path="\*" element=\{<Navigate to="\/" replace \/>\} \/>/);
  });

  it('loads the onboarding pages lazily (never in the landing chunk), public (no Protected/Layout)', () => {
    expect(app).toMatch(/const JoinPage = lazy\(\(\) => import\("\.\/join\/JoinPage"\)\);/);
    expect(app).toMatch(/const ConfirmPage = lazy\(\(\) => import\("\.\/join\/ConfirmPage"\)\);/);
    expect(app).toMatch(/const WebCallbackPage = lazy\(\(\) => import\("\.\/join\/WebCallbackPage"\)\);/);
    expect(app).not.toMatch(/^import .* from ['"]\.\/join\//m);
    for (const name of ['joinRoute', 'confirmRoute', 'webCallbackRoute']) {
      const line = app.split('\n').find((l) => l.startsWith(`const ${name} =`)) ?? '';
      expect(line).not.toMatch(/Protected|Layout/);
    }
  });

  // Only the sign-in flow and the web callback may reach Supabase, and only through
  // onboardingAuth (the one file that imports supabase-js). /auth/confirm, the invite
  // preview and every pure module never do: the app's email link must never exchange
  // a code or create a session.
  it('only the web sign-in flow reaches supabase, and only through onboardingAuth', () => {
    const dir = fileURLToPath(new URL('../join/', import.meta.url));
    const files = readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f));
    expect(files.length).toBeGreaterThan(8);
    const mayUseAuth = new Set(['JoinFlow.tsx', 'WebCallbackPage.tsx']);
    const importsSupabase = /(from|import\()\s*['"][^'"]*supabase/i;
    const importsAuth = /(from|import\()\s*['"]\.\/onboardingAuth['"]/;
    for (const f of files) {
      const text = readFileSync(dir + f, 'utf-8');
      if (f === 'onboardingAuth.ts') {
        expect(text).toMatch(/from '@supabase\/supabase-js'/);
        continue;
      }
      expect({ file: f, supabase: importsSupabase.test(text) }).toEqual({ file: f, supabase: false });
      expect({ file: f, auth: importsAuth.test(text) && !mayUseAuth.has(f) }).toEqual({ file: f, auth: false });
    }
  });

  it('the app\'s /auth/confirm page imports nothing that can create a session', () => {
    const raw = readFileSync(fileURLToPath(new URL('../join/ConfirmPage.tsx', import.meta.url)), 'utf-8');
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // prose may name them; code may not
    const specifiers = [...code.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(3);
    expect(specifiers.filter((x) => /supabase|onboardingAuth|JoinFlow/.test(x))).toEqual([]);
    expect(code).not.toMatch(/exchangeCode|exchangeCodeForSession|signIn|signUp/);
  });
});
