/**
 * Replica-drift guard for the PGlite suites. Most suites hand-declare a minimal
 * `leagues` table. If a replica's column DEFAULT differs from prod's, a fixture
 * that omits the column silently tests a different branch than prod runs.
 *
 * That happened on 2026-10-06. The leave-league replica declared league_type
 * default 'matchup'; prod's default is 'duration' (20251230000000). So the
 * effect test's S4 fixture, which omitted league_type, passed in PGlite and
 * FAILED in prod.
 *
 * Usage, in a step after the schema exists:
 *   await assertReplicaDefaultMatchesProd(q, 'leagues', 'league_type');
 *
 * "Prod" is approximated by the migrations: every supabase/migrations/*.sql in
 * apply order (deferred/ is never applied), where the LAST statement that sets
 * the column's default wins. Two forms are recognised:
 *   `<column> <type> ... default '<x>'` (CREATE TABLE / ADD COLUMN), and
 *   `alter column <column> set default '<x>'`.
 * The match does not cross a ',' or ';', so a neighbouring column's default
 * can't be mistaken for this one's.
 */
import { assert, assertEquals } from 'jsr:@std/assert';

const MIGRATIONS = new URL('../migrations/', import.meta.url);

/** The column's default as the latest migration leaves it (quoted literal only). */
export async function latestMigrationDefault(column: string): Promise<string | null> {
  const files: string[] = [];
  for await (const e of Deno.readDir(MIGRATIONS)) if (e.isFile && e.name.endsWith('.sql')) files.push(e.name);
  files.sort();
  const c = column.replace(/[^a-z0-9_]/gi, '');
  const re = new RegExp(
    `\\b${c}\\s+\\w+[^;,]*?\\bdefault\\s+'([^']*)'|alter\\s+column\\s+${c}\\s+set\\s+default\\s+'([^']*)'`,
    'gi',
  );
  let latest: string | null = null;
  for (const f of files) {
    const sql = await Deno.readTextFile(new URL(f, MIGRATIONS));
    for (const m of sql.matchAll(re)) latest = m[1] ?? m[2];
  }
  return latest;
}

// deno-lint-ignore no-explicit-any
type Query = (sql: string, params?: unknown[]) => Promise<any[]>;

/** Fails if the replica's `table.column` default drifted from the migrations'. */
export async function assertReplicaDefaultMatchesProd(q: Query, table: string, column: string): Promise<void> {
  const latest = await latestMigrationDefault(column);
  assert(latest !== null, `no migration sets a ${column} default`);
  const [col] = await q(
    `select column_default d from information_schema.columns where table_name = $1 and column_name = $2`,
    [table, column],
  );
  assert(col, `the replica has no ${table}.${column}`);
  assertEquals(col.d, `'${latest}'::text`, `the replica's ${table}.${column} default drifted from prod`);
}
