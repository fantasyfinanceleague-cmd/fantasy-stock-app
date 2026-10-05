/**
 * Pure week selection and instant comparison for the snapshot jobs
 * (snapshot-week-start / snapshot-week-end).
 *
 * S8 — THE DEFECT: both jobs keyed their work on leagues.current_week. current_week
 * advances only when EVERY matchup in the week is scored (process-week-results).
 * So one refused matchup in week N meant the next Monday snapshotted week N again
 * (already end-priced, skipped), and week N+1 never got a baseline. The fix:
 * choose the week from the matchups' own windows and the calendar, independent of
 * current_week. A week is a target when its window has opened (week-start) or
 * closed (week-end) — the window functions decide; this module only filters and
 * orders. A refused or unscored week N no longer blocks week N+1.
 *
 * Placeholder rows (playoff rounds whose team slots are not yet filled) carry a
 * NULL team1_user_id and are never a target. A round whose window has not opened
 * is 'not_due' and is excluded.
 *
 * Also here: instant comparisons. created_at arrives from PostgREST as a
 * timestamptz string whose text form varies ('+00:00' vs 'Z', trailing-zero-trimmed
 * fractions). Comparing those as strings against toISOString() is only correct when
 * the formats happen to line up, so these compare parsed epoch milliseconds, and
 * an unparseable instant THROWS (fail closed) rather than being silently excluded.
 *
 * Pure: no DB, no network. See week-select.test.ts.
 */

export interface WeekMatchupRow {
  league_id?: string;
  week_number: number;
  team1_user_id: string | null;
  week_start: string;
  week_end: string;
  created_at: string;
}

export type WindowPlanAction = 'not_due' | 'refuse' | 'proceed';

/**
 * Parse an instant or throw. Used for every created_at / window comparison so an
 * unreadable value fails the run instead of silently changing which trades count.
 */
export function instantMs(iso: string): number {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new Error(`unparseable instant: ${JSON.stringify(iso)}`);
  return ms;
}

/** created_at is strictly before the cut instant (epoch ms). */
export function instantBefore(iso: string, cutMs: number): boolean {
  return instantMs(iso) < cutMs;
}

/** created_at is at or before the cut instant (epoch ms). */
export function instantAtOrBefore(iso: string, cutMs: number): boolean {
  return instantMs(iso) <= cutMs;
}

/**
 * The week numbers to process for ONE league, ascending. `plan` is the job's own
 * window decision (planWeekWindow for week-start, planCloseWindow for week-end),
 * called once per week with that week's anchor, floor and stored window. Weeks
 * the window says are not yet due are dropped; 'proceed' and 'refuse' are kept,
 * so a refusal is still visible in the run's results rather than hidden.
 */
export function selectTargetWeeks(
  rows: ReadonlyArray<WeekMatchupRow>,
  plan: (anchor: Date, floor: Date | null, storedStart: string, storedEnd: string) => { action: WindowPlanAction },
): number[] {
  const byWeek = new Map<number, WeekMatchupRow[]>();
  for (const r of rows) {
    if (!r.team1_user_id) continue; // placeholder: round not yet populated
    const list = byWeek.get(r.week_number) ?? [];
    list.push(r);
    byWeek.set(r.week_number, list);
  }
  const targets: number[] = [];
  for (const week of [...byWeek.keys()].sort((a, b) => a - b)) {
    const weekRows = byWeek.get(week)!;
    const first = weekRows[0];
    const floorMs = Math.min(...weekRows.map((r) => instantMs(r.created_at)));
    const result = plan(
      new Date(instantMs(first.week_start)),
      Number.isFinite(floorMs) ? new Date(floorMs) : null,
      first.week_start,
      first.week_end,
    );
    if (result.action !== 'not_due') targets.push(week);
  }
  return targets;
}
