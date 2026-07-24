/**
 * Pure grouping logic for process-week-results.
 *
 * Extracted from the Deno.serve handler so it can be unit-tested with no DB and
 * no Deno runtime APIs. See grouping.test.ts for the regression coverage.
 *
 * THE BUG THIS ENCODES AGAINST: the handler used to group pending matchups by
 * league_id ALONE and take weekNumber / weekStart / weekEnd from matchups[0].
 * A league with unscored matchups spanning several weeks then scored EVERY
 * pending week against week[0]'s snapshots, mid-week trade window, and stale
 * guard. Snapshots and both windows are per-week, so the batch key must be too.
 */

/** The matchup fields this module reads. Extra columns pass through untouched. */
export interface MatchupRow {
  league_id: string;
  week_number: number;
  week_start: string | null;
  week_end: string | null;
  // Rows carry many more columns (team ids, gains, the leagues!inner join, ...);
  // grouping neither reads nor mutates them, so keep them opaque.
  [key: string]: unknown;
}

/**
 * One scoring batch: exactly one (league_id, week_number) pair. weekStart and
 * weekEnd are hoisted OFF matchups[0] and onto the batch itself — every matchup
 * in the batch shares them by construction, so the batch is the honest owner of
 * the week window, and tests can assert on it without reaching into matchups[0].
 */
export interface MatchupBatch {
  leagueId: string;
  weekNumber: number;
  weekStart: string | null;
  weekEnd: string | null;
  matchups: MatchupRow[];
}

/**
 * Group pending matchups into one batch per (league_id, week_number).
 *
 * Ordering is LOAD-BEARING, not cosmetic: the handler's week-advancement block
 * re-reads current_week from the DB per batch and only advances when the batch's
 * week === current_week. A league with weeks N and N+1 pending advances one step
 * per batch — but ONLY if N is processed before N+1. So batches are returned
 * sorted by (leagueId, weekNumber ASC). Reordering this reintroduces a
 * permanently-stuck current_week, which is why it lives behind a tested contract.
 */
export function groupMatchupsByLeagueWeek(matchups: MatchupRow[]): MatchupBatch[] {
  const batches = new Map<string, MatchupBatch>();

  for (const m of matchups) {
    const key = `${m.league_id}::${m.week_number}`;
    let batch = batches.get(key);
    if (!batch) {
      batch = {
        leagueId: m.league_id,
        weekNumber: m.week_number,
        weekStart: m.week_start,
        weekEnd: m.week_end,
        matchups: [],
      };
      batches.set(key, batch);
    }
    batch.matchups.push(m);
  }

  return [...batches.values()].sort(
    (a, b) => a.leagueId.localeCompare(b.leagueId) || a.weekNumber - b.weekNumber
  );
}
