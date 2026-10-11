/**
 * Guard: no APPLIED migration is renamed, removed or duplicated.
 *
 * `supabase db push` fails for everyone when prod's schema_migrations has a
 * version with no local file ("remote migration versions not found in local
 * migrations directory"). A rename is exactly that: the old version disappears.
 * CLAUDE.md: never rewrite an applied migration.
 *
 * supabase/migrations/APPLIED.txt lists every version confirmed applied in prod.
 * This test asserts each listed version has EXACTLY ONE file in migrations/.
 * Extend the list only when a migration is confirmed applied (never to hide a
 * change). Hermetic and read-only: run with --allow-read.
 *
 *   deno test --allow-read supabase/tests/applied_migrations.test.ts
 */
import { assert, assertEquals } from 'jsr:@std/assert';

const MIGRATIONS = new URL('../migrations/', import.meta.url);

Deno.test('every APPLIED migration version has exactly one file in migrations/', async () => {
  const manifest = await Deno.readTextFile(new URL('APPLIED.txt', MIGRATIONS));
  const versions = manifest.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  assert(versions.length > 100, `the manifest should list the applied history, found ${versions.length}`);

  const files: string[] = [];
  for await (const e of Deno.readDir(MIGRATIONS)) {
    if (e.isFile && e.name.endsWith('.sql')) files.push(e.name);
  }

  const missing: string[] = [];
  const duplicated: string[] = [];
  for (const v of versions) {
    const n = files.filter((f) => f.startsWith(`${v}_`)).length;
    if (n === 0) missing.push(v);
    if (n > 1) duplicated.push(v);
  }
  assertEquals(missing, [], 'applied versions with NO file (renamed or removed?)');
  assertEquals(duplicated, [], 'applied versions with more than one file');
});

Deno.test('the phase-0 lock keeps its applied name (20261023000000)', async () => {
  const files: string[] = [];
  for await (const e of Deno.readDir(MIGRATIONS)) if (e.isFile) files.push(e.name);
  assertEquals(files.filter((f) => f.startsWith('20261023000000_')), ['20261023000000_lock_start_new_league_season.sql']);
});
