/**
 * prevClose: the last session's close before today, from a symbol's daily bars
 * (historical-bars). Pure. Bars are the daily closes, ascending by date. A bar
 * dated today is never the previous close, and no earlier bar means null, never
 * a guessed price.
 */
export interface DailyBar {
  /** YYYY-MM-DD, the bar's ET trading date. */
  date: string;
  close: number;
}

export function prevCloseFromBars(bars: DailyBar[], todayEt: string): number | null {
  let prev: DailyBar | null = null;
  for (const b of bars) {
    if (!(b.close > 0)) continue;
    if (b.date < todayEt) prev = b;
  }
  return prev ? prev.close : null;
}
