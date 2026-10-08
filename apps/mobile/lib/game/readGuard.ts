/**
 * readGuard (3c): PostgREST returns at most 1000 rows per read, so a league
 * larger than that comes back partial with no error. A league-wide read asks
 * for an EXACT count; rows that do not match it mean the screen must fail
 * visibly. A partial game is never rendered as if it were whole.
 */
export type RowsCheck =
  | { ok: true }
  | { ok: false; received: number; expected: number | null };

export function checkRowsComplete(received: number, expected: number | null): RowsCheck {
  if (expected === null) return { ok: false, received, expected: null };
  if (received === expected) return { ok: true };
  return { ok: false, received, expected };
}
