/**
 * Effect tests (docs/security/*effect-test*.sql) run in the prod SQL editor, but
 * PGlite replicas here give `league_members.role` a default ('member') that prod
 * does NOT have. A fixture that omits `role` passes in PGlite and dies in prod
 * with 23502 before testing anything (2026-10-07, the #133 release). So every
 * league_members insert in an effect test must name `role` explicitly.
 * Run: `deno test --allow-read --allow-env supabase/tests/`
 */
import { assertEquals } from 'jsr:@std/assert';

const dir = new URL('../../docs/security/', import.meta.url);

Deno.test('every effect-test league_members insert names role (prod has no default)', async () => {
  const offenders: string[] = [];
  for await (const e of Deno.readDir(dir)) {
    if (!e.isFile || !/effect-test.*\.sql$/.test(e.name)) continue;
    const sql = await Deno.readTextFile(new URL(e.name, dir));
    for (const m of sql.matchAll(/insert\s+into\s+(?:public\.)?league_members\s*\(([^)]*)\)/gi)) {
      if (!/\brole\b/.test(m[1])) offenders.push(`${e.name}: (${m[1].trim()})`);
    }
  }
  assertEquals(offenders, []);
});
