/**
 * Which leagues the snapshot jobs (snapshot-week-start / snapshot-week-end)
 * may act on.
 *
 * THE DEFECT (observed in prod 2026-10-05, the first Monday after PR #87):
 * both jobs selected EVERY `league_type='matchup'` league with a non-NULL
 * current_week — no season_status / draft_status filter. Before the single-cut
 * window (PR #87) that was harmless: a finished league's last week was already
 * fully snapshotted and end-priced, so the coverage skips no-opped it. PR #87
 * put the window REFUSE ahead of those skips, and market_calendar only covers
 * ~97 days back, so a finished league's old (January 2026) current_week refused
 * 'no_coverage' on every attempt. The refusal set anyIncomplete, retries
 * exhausted, and the job reported 'failed' / HTTP 500 on every run, even though
 * the real leagues snapshotted correctly. A false failure every run trains
 * everyone to ignore the alert (CLAUDE.md success-signals family).
 *
 * THE FIX IS SCOPE, NOT A SKIP. A league is snapshotted only while its season
 * is live AND its draft has completed. A finished league is never read past the
 * query. A league that IS in scope but whose week cannot be windowed stays a
 * loud refusal (anyIncomplete -> retry -> failed): that is a stalled or
 * mis-calendared in-season league, and it must not read as a clean success.
 * (An earlier draft skipped pre-calendar weeks that looked complete. Review
 * found that would hide exactly that stall, so it was removed.)
 *
 * Values are the real CHECK constraints:
 *   leagues.season_status: ('active','playoffs','completed')  — nullable
 *   leagues.draft_status:  ('not_started','in_progress','completed') — NOT NULL
 * A NULL season_status is NOT in season (fail closed).
 *
 * Scope note: process-week-results uses a DIFFERENT scope for its own jobs —
 * its transition heal filters season_status='active' AND draft_status='completed',
 * its playoff heal season_status='playoffs', and its scoring query is keyed on
 * matchups only. This module governs only the two snapshot jobs.
 *
 * Pure: no DB, no network, no Deno runtime APIs. See
 * snapshot-league-scope.test.ts.
 */

/** season_status values during which a league's weeks are snapshotted. */
export const IN_SEASON_STATUSES = ['active', 'playoffs'] as const;
/** draft_status a league must have reached before any week is snapshotted. */
export const SNAPSHOT_DRAFT_STATUS = 'completed';

export interface LeagueScopeRow {
  season_status: string | null;
  draft_status: string | null;
  current_week: number | null;
}

/**
 * Is this league in season (and therefore snapshottable)? The DB query applies
 * the same filter; this in-code re-check means a query edit that drops a
 * filter cannot silently widen the scope back to finished leagues.
 */
export function isInSeasonLeague(league: LeagueScopeRow): boolean {
  return (
    league.current_week != null &&
    (IN_SEASON_STATUSES as readonly string[]).includes(league.season_status ?? '') &&
    league.draft_status === SNAPSHOT_DRAFT_STATUS
  );
}
