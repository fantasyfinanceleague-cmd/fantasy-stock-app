// Stockpile — what LeagueContext's league-list read came back as (gn-sweep). Pure, so
// tests-deno pins it.
//
// The bug this replaces: LeagueContext set `leagues = []` on zero memberships AND on a
// membership read ERROR (and left the list empty when the leagues read failed on a first
// load). Every screen read an empty list as "No leagues yet" + Create / Join, so a
// transient failure told someone WITH leagues that they had none (the same family as
// League's "No leagues yet" flash, #262). "No leagues yet" now needs a SUCCESSFUL read with
// zero membership rows; a failed read is its own state, with Try again.
//
// The partial cases (CLAUDE.md: guards here are blind to partial state; check it first):
// - memberships read fine, the leagues read failed → 'failed' (never 'empty').
// - memberships read fine (N > 0), the leagues read came back with ZERO rows → 'failed':
//   the memberships say you have leagues, so an empty list is not "no leagues".
// - memberships N, leagues M with 0 < M < N → 'ok' with the M real rows, and `missing`
//   says how many didn't come back (the caller logs it). Not 'failed': a membership whose
//   league never comes back (a row the leagues policy hides) would otherwise block every
//   league you DO have, on every retry — an unrecoverable refusal, which is the worse bug.

export type LeagueReadResult<L> =
  | { kind: 'ok'; leagues: L[]; missing: number }
  | { kind: 'empty' }
  | { kind: 'failed'; reason: 'memberships' | 'leagues' | 'no_league_rows' };

export interface LeagueReadInput<L> {
  /** The league_members read: an error, or its rows (null when supabase-js returned none). */
  memberships: { error: unknown; rows: readonly unknown[] | null };
  /** The leagues read, or null when it wasn't made (no memberships to read). */
  leagues: { error: unknown; rows: readonly L[] | null } | null;
}

/** Classifies the two reads. Call it once the memberships are in; pass `leagues: null`
 * only when there were no memberships to read leagues for. */
export function classifyLeagueRead<L>({ memberships, leagues }: LeagueReadInput<L>): LeagueReadResult<L> {
  if (memberships.error || !memberships.rows) return { kind: 'failed', reason: 'memberships' };
  const expected = memberships.rows.length;
  if (expected === 0) return { kind: 'empty' };
  if (!leagues || leagues.error || !leagues.rows) return { kind: 'failed', reason: 'leagues' };
  if (leagues.rows.length === 0) return { kind: 'failed', reason: 'no_league_rows' };
  return { kind: 'ok', leagues: [...leagues.rows], missing: Math.max(0, expected - leagues.rows.length) };
}

/** Whether the classified read needs the leagues read at all (memberships in, at least one). */
export function needsLeaguesRead(memberships: { error: unknown; rows: readonly unknown[] | null }): boolean {
  return !memberships.error && !!memberships.rows && memberships.rows.length > 0;
}
