/**
 * bestScoredWeek: the season's best week, from FINAL (scored) gains only.
 * Mirrors get_season_result's own rule (20261014000000): the highest gain
 * among regular-season matchups, ties to the earlier week. A live,
 * unscored week never reaches this function -- callers pass scored rows.
 */
export interface ScoredWeek {
  week: number;
  gain: number;
}

export function bestScoredWeek(weeks: ScoredWeek[]): ScoredWeek | null {
  let best: ScoredWeek | null = null;
  for (const w of weeks) {
    if (best === null || w.gain > best.gain || (w.gain === best.gain && w.week < best.week)) best = w;
  }
  return best;
}
