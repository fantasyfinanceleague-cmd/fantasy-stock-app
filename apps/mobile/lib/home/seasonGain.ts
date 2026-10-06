/**
 * seasonGain: the hero's "+$X · +Y% season gain" segment (D1, Concept A).
 * gain = the sum of every scored weekly matchup gain + the current week's
 * live gain (liveWeekScore); pct = gain / stake (teamValue's stake).
 * The SAME formula buildSeasonGainSeries uses for its chart endpoint —
 * called with the same inputs, they agree by construction.
 */

function cents(v: number): number {
  return Math.round(v * 100) / 100;
}

export interface SeasonGainResult {
  gain: number;
  pct: number;
}

export function seasonGain(
  scoredWeeklyGains: number[],
  liveGain: number | null,
  stake: number,
): SeasonGainResult {
  const scored = scoredWeeklyGains.reduce((sum, g) => cents(sum + g), 0);
  const gain = cents(scored + (liveGain ?? 0));
  const pct = stake > 0 ? (gain / stake) * 100 : 0;
  return { gain, pct };
}
