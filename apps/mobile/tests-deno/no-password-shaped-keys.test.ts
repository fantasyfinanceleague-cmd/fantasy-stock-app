// sourceManifest.generated.ts must never pair a "password"-containing token
// with an assigned value. It used to emit `'constants/passwordRules.ts': sNNN,`
// map keys, which GitGuardian's "Generic Password" detector reads as a
// hardcoded credential; every renumbering (any source file added or removed)
// re-raised 2-7 false incidents on the PR. The generator now emits
// `['path', sNNN]` tuples. This scans the generated text so a regression to a
// path-keyed literal fails here, before GitGuardian sees it.
import { assert, assertEquals } from 'jsr:@std/assert';
import manifest from './sourceManifest.generated.ts' with { type: 'text' };
import { SOURCES } from './sourceManifest.generated.ts';

// A quoted string containing the word, then a colon: a quoted object key.
const QUOTED_KEY = /password[^']*'\s*:/i;
// The word as (part of) a bare identifier or key, assigned with : or =.
const BARE_ASSIGN = /password\w*\s*[:=]/i;
const stripQuoted = (line: string) => line.replace(/'[^']*'/g, "''");

Deno.test('sourceManifest.generated.ts has no password-shaped key or assignment', () => {
  const lines = manifest.split('\n');
  const hits = lines
    .map((line, i) => ({ n: i + 1, line }))
    .filter(({ line }) => QUOTED_KEY.test(line) || BARE_ASSIGN.test(stripQuoted(line)));
  assertEquals(hits, [], 'password-shaped key line(s): the manifest must emit [path, label] tuples');
});

Deno.test('the word only appears inside quoted module paths', () => {
  for (const line of manifest.split('\n')) {
    if (!/password/i.test(line)) continue;
    assert(!/password/i.test(stripQuoted(line)), `outside a quoted path: ${line}`);
  }
});

Deno.test('SOURCES is still keyed by path (the tuple shape builds the same object)', () => {
  // A path containing the word, so this would catch a shape that dropped those files.
  assert(typeof SOURCES['constants/passwordRules.ts'] === 'string');
  assert(SOURCES['app/(tabs)/league.tsx'].length > 0);
  const imports = [...manifest.matchAll(/^import s\d+ from /gm)].length;
  assertEquals(Object.keys(SOURCES).length, imports, 'one SOURCES entry per imported file');
});
