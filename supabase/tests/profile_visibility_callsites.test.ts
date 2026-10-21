/**
 * Audit #8 (Giorgio, 2026-10-08, ruling A): clients never read another player's
 * user_profiles row directly. Every other-player name/avatar comes through
 * get_visible_profiles (20261118000000); user_profiles becomes self-only
 * (20261118000001). This guard walks the web and mobile sources so a
 * new direct read of someone else's row fails here, BEFORE the policy flip
 * would silently blank it in the app:
 *   1. every .from('user_profiles') is in a known file and is an OWN-ROW access
 *      (filtered .eq('id', ...) to the caller, or an upsert of the caller's id);
 *   2. every Realtime subscription on user_profiles is filtered to one id;
 *   3. the call sites moved off direct reads use get_visible_profiles.
 */
import { assert, assertEquals } from 'jsr:@std/assert';

const ROOT = new URL('../../', import.meta.url);
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, ROOT));

function walk(rel: string, out: string[] = []): string[] {
  for (const e of Deno.readDirSync(new URL(rel, ROOT))) {
    if (e.name === 'node_modules' || e.name.startsWith('.') || e.name === 'tests-deno') continue;
    const p = `${rel}${e.name}`;
    if (e.isDirectory) walk(`${p}/`, out);
    else if (/\.(jsx?|tsx?)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}
const SOURCES = [
  ...walk('apps/web/src/'),
  ...walk('apps/mobile/app/'), ...walk('apps/mobile/components/'), ...walk('apps/mobile/lib/'),
];

/** The only files allowed to touch user_profiles directly, all own-row. */
const SELF_ROW_FILES = new Set([
  'apps/mobile/lib/SessionProvider.tsx', // the caller's username; the signup upsert
  'apps/web/src/pages/Profile.jsx', // the caller's own profile screen
  'apps/web/src/pages/Login.jsx', // the signup upsert
]);

Deno.test('no client reads another player\'s user_profiles row directly', () => {
  const found: string[] = [];
  for (const f of SOURCES) {
    const src = read(f);
    for (const m of src.matchAll(/\.from\(\s*['"]user_profiles['"]\s*\)/g)) {
      found.push(f);
      assert(SELF_ROW_FILES.has(f), `${f} reads user_profiles directly: use get_visible_profiles (audit #8)`);
      const chain = src.slice(m.index!, m.index! + 400);
      // The id must be one of the CALLER's identifiers in these files (the
      // session's userId / user.id, or the just-signed-up data.user.id).
      const ownRow = /\.eq\(\s*['"]id['"]\s*,\s*(userId|user\.id|data\.user\.id)\s*\)/.test(chain.split(';')[0]) ||
        /\.upsert\(\s*\{\s*id:\s*(data\.user\.id|user\.id)\b/.test(chain);
      assert(ownRow, `${f}: a user_profiles access that is not provably the caller's own row:\n${chain.split(';')[0]}`);
    }
  }
  // Five today (Profile.jsx x3, Login.jsx, SessionProvider.tsx). notifications.ts had two more (the legacy expo_push_token writes) until
  // F8's column was dropped and they were removed: it is no longer allowlisted, so a user_profiles access there fails above.
  assert(found.length >= 5, 'guard found fewer self-row accesses than exist -- has the scan broken?');
});

Deno.test('every Realtime subscription on user_profiles is filtered to one id', () => {
  for (const f of SOURCES) {
    const src = read(f);
    for (const m of src.matchAll(/table:\s*['"]user_profiles['"]/g)) {
      // The subscription's options object: from its opening brace to the end of
      // its line (the filter is a template literal, so a '}' search stops early).
      const start = src.lastIndexOf('{', m.index!);
      const obj = src.slice(start, src.indexOf('\n', m.index!));
      assert(/filter:\s*`id=eq\.\$\{selfId\}`/.test(obj), `${f}: user_profiles subscription not filtered to the caller: ${obj}`);
    }
  }
});

// apps/mobile/components/LeagueCarousel.tsx was the other moved call site; it was
// deleted as dead code (W8: zero importers, never mounted). The walk above still
// covers every mobile source, so a new user_profiles read anywhere is still caught.
Deno.test('the moved call sites read other players through get_visible_profiles', () => {
  for (const f of [
    'apps/web/src/context/UserProfilesContext.jsx',
  ]) {
    const src = read(f);
    assertEquals(/\.rpc\(\s*['"]get_visible_profiles['"]\s*,\s*\{\s*p_user_ids:/.test(src), true, f);
    assertEquals(/\.from\(\s*['"]user_profiles['"]/.test(src), false, f);
  }
});

// The legacy draft screen (one of the original moved call sites) was retired on main
// (UX final sweep S-2) and is now only a redirect to the League tab. It must stay a
// redirect that reads no profiles at all; if it ever grows data access again, it has
// to come back into the list above.
Deno.test('the retired legacy draft route reads no profiles', () => {
  const src = read('apps/mobile/app/(tabs)/draft.tsx');
  assertEquals(/<Redirect\b/.test(src), true, 'draft.tsx is a redirect');
  assertEquals(/user_profiles|supabase/.test(src), false, 'draft.tsx touches no data');
});
