// Stockpile — "latest read wins" for LeagueContext's league-list read (gn-sweep, security
// review LOW). Pure, so tests-deno pins it.
//
// fetchLeagues awaits several reads; without a guard, a read started for user A that resolves
// after a switch to user B (or after a newer refresh) would write A's (or the older) data over
// the current state. Each read takes a token from begin(); after every await it checks
// isCurrent(token) and drops its results if a newer read began, or invalidate() ran (sign-out).

export interface ReadSequence {
  /** Starts a read; returns its token. Any read begun earlier is now stale. */
  begin(): number;
  /** Whether the read holding `token` is still the latest (nothing newer began, no invalidate). */
  isCurrent(token: number): boolean;
  /** Makes every read in flight stale (e.g. the user signed out). */
  invalidate(): void;
}

export function createReadSequence(): ReadSequence {
  let latest = 0;
  return {
    begin: () => ++latest,
    isCurrent: (token) => token === latest,
    invalidate: () => {
      latest += 1;
    },
  };
}

/** What a log line may carry from a Supabase/PostgREST error: its message and code, nothing
 * else (the whole object can carry details and hints we don't want in device logs). */
export function errorSummary(err: unknown): { message: string | null; code: string | null } | null {
  if (err === null || err === undefined) return null;
  if (typeof err !== 'object') return { message: String(err), code: null };
  const e = err as { message?: unknown; code?: unknown };
  return {
    message: typeof e.message === 'string' ? e.message : null,
    code: typeof e.code === 'string' ? e.code : null,
  };
}
