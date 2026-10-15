// @vitest-environment node
/**
 * Loads one of the APP's pure modules (apps/mobile/<rel>) for a parity test.
 *
 * Through esbuild with an empty tsconfig rather than a plain import: a plain
 * import makes Vite read apps/mobile/tsconfig.json, which extends
 * expo/tsconfig.base, and the web workspace doesn't install Expo. Only modules
 * that are pure (no React Native, no supabase) are loadable this way, which is
 * exactly the rule the app keeps for anything its Deno tests import.
 */
import { resolve } from 'node:path';
import { buildSync } from 'esbuild';

export function mobilePath(rel: string): string {
  return resolve(process.cwd(), '../mobile', rel);
}

export function loadMobile<T>(rel: string): T {
  const out = buildSync({ entryPoints: [mobilePath(rel)], bundle: true, write: false, format: 'cjs', platform: 'neutral', tsconfigRaw: {} });
  const module = { exports: {} as T };
  new Function('module', 'exports', out.outputFiles[0].text)(module, module.exports);
  return module.exports;
}
