// @vitest-environment node
//
// The web refusals are the app's approved lines, verbatim: this loads the
// app's own module (pure TS, no React Native) and compares output for output.
//
// Loaded through esbuild with an empty tsconfig rather than a plain import:
// a plain import makes Vite read apps/mobile/tsconfig.json, which extends
// expo/tsconfig.base, and the web workspace doesn't install Expo.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSync } from 'esbuild';
import type * as AppModule from '../../../mobile/lib/join/joinPreview';
import * as web from './joinCopy';

const appEntry = resolve(process.cwd(), '../mobile/lib/join/joinPreview.ts');
const app: typeof AppModule = (() => {
  const out = buildSync({ entryPoints: [appEntry], bundle: true, write: false, format: 'cjs', platform: 'neutral', tsconfigRaw: {} });
  const module = { exports: {} as typeof AppModule };
  new Function('module', 'exports', out.outputFiles[0].text)(module, module.exports);
  return module.exports;
})();

const league = { name: 'Stock Scudetto', max: 6 };

describe('refusal copy parity with apps/mobile/lib/join/joinPreview.ts', () => {
  it.each(web.JOIN_BLOCKS.map((b) => [b]))('%s', (block) => {
    expect(web.blockMessage(block, league)).toBe(app.blockMessage(block, league));
  });

  it('the shared JOIN_COPY lines are identical', () => {
    for (const [key, line] of Object.entries(web.JOIN_COPY)) {
      expect(line).toBe(app.JOIN_COPY[key as keyof typeof app.JOIN_COPY]);
    }
  });

  it('the pre-sign-in refusals: the season-over line is the app\'s, the rest is the app\'s "can\'t join right now" line', () => {
    expect(web.preSignInBlockMessage('season_completed', 'Stock Scudetto')).toBe(app.blockMessage('season_completed', league));
    for (const b of ['league_full', 'draft_started', 'draft_in_progress', 'already_member', 'invite_expired', 'unknown'] as const) {
      expect(web.preSignInBlockMessage(b, 'Stock Scudetto')).toBe(app.JOIN_COPY.unknownBlock);
    }
  });

  it('errorMessage', () => {
    for (const kind of ['unreachable', 'rate_limited'] as const) expect(web.errorMessage(kind)).toBe(app.errorMessage(kind));
  });

  it('coerceBlock and refineBlock agree on every reason, and on junk', () => {
    const reasons = [...web.JOIN_BLOCKS, 'invalid_code', 'not_a_reason', '', null, undefined, 42, {}];
    for (const r of reasons) expect(web.coerceBlock(r)).toBe(app.coerceBlock(r));
    for (const b of web.JOIN_BLOCKS) {
      for (const s of ['not_started', 'in_progress', 'completed', null, undefined]) {
        expect(web.refineBlock(b, s)).toBe(app.refineBlock(b, s));
      }
    }
  });

  it("the web knows every block the app's blockMessage handles (a new one fails here)", () => {
    const src = readFileSync(appEntry, 'utf-8');
    const body = src.slice(src.indexOf('export function blockMessage'), src.indexOf('export type PreviewAction'));
    const appCases = [...body.matchAll(/case '([a-z_]+)':/g)].map((m) => m[1]).sort();
    expect(appCases.length).toBeGreaterThan(0);
    expect(web.JOIN_BLOCKS.filter((b) => b !== 'unknown').slice().sort()).toEqual(appCases);
  });
});
