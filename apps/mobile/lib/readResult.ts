/**
 * readResult: supabase-js resolves a failed read to `{ data, error }` (or `{ count, error }`); it does NOT
 * throw. A caller that destructures only `count` / `data` therefore treats a failed read as "zero" or "empty",
 * and the `catch` that was meant to show "couldn't check" is dead code. These two helpers turn a resolved
 * error into the throw that catch expects. Pure: no client import, so Deno tests it.
 * (W8 tap-through F2: Check availability read a failed symbols read as "stock data is still loading".)
 */
export interface CountResult {
  count: number | null;
  error: { message?: string } | null;
}
export interface RowsResult<T> {
  data: T[] | null;
  error: { message?: string } | null;
}

/** The count, or a throw when the read failed; a successful read with no count is 0. */
export function countOrThrow(res: CountResult, what: string): number {
  if (res.error) throw new Error(`${what}: ${res.error.message ?? 'read failed'}`);
  return res.count ?? 0;
}

/** The rows, or a throw when the read failed; a successful read with no rows is []. */
export function rowsOrThrow<T>(res: RowsResult<T>, what: string): T[] {
  if (res.error) throw new Error(`${what}: ${res.error.message ?? 'read failed'}`);
  return res.data ?? [];
}
