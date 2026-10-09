/**
 * league_notifications_kind_check can't be ALTERed, only dropped and re-created,
 * so every migration that adds a kind must RE-LIST every existing kind. Twice
 * (2026-10-07 #133 prep, 2026-10-08 #94 prep) a branch written before a newer
 * feature re-created the CHECK from its own older list, which would have dropped
 * live kinds (commissioner_transferred; then member_left + the six auto-start
 * kinds) and made those notices fail 23514 in prod.
 *
 * This walks supabase/migrations/ in version order and requires each
 * re-definition to be a SUPERSET of the one before it. Retiring a kind on
 * purpose needs an explicit marker in that migration:
 *   -- kind-check-retire: <kind>
 * Run: `deno test --allow-read --allow-env supabase/tests/`
 */
import { assertEquals } from 'jsr:@std/assert';

const dir = new URL('../migrations/', import.meta.url);
const CHECK = /league_notifications_kind_check[\s\S]*?check\s*\(\s*kind\s+(?:=\s*any\s*\(\s*array\s*\[|in\s*\()([\s\S]*?)\)\s*\)/gi;

Deno.test('every re-created league_notifications_kind_check keeps all earlier kinds', async () => {
  const files: string[] = [];
  for await (const e of Deno.readDir(dir)) if (e.isFile && /^\d{14}_.*\.sql$/.test(e.name)) files.push(e.name);
  files.sort();
  let prev: Set<string> | null = null;
  let prevFile = '';
  const problems: string[] = [];
  let definitions = 0;
  for (const f of files) {
    const sql = await Deno.readTextFile(new URL(f, dir));
    const retired = new Set([...sql.matchAll(/--\s*kind-check-retire:\s*(\w+)/g)].map((m) => m[1]));
    for (const m of sql.matchAll(CHECK)) {
      const kinds = new Set([...m[1].matchAll(/'(\w+)'/g)].map((k) => k[1]));
      if (kinds.size === 0) continue;
      definitions++;
      if (prev) {
        const dropped = [...prev].filter((k) => !kinds.has(k) && !retired.has(k));
        if (dropped.length) problems.push(`${f} drops ${dropped.join(', ')} (defined up to ${prevFile})`);
      }
      prev = kinds;
      prevFile = f;
    }
  }
  assertEquals(definitions > 0, true, 'found no kind CHECK definitions: the pattern needs updating');
  assertEquals(problems, []);
});
