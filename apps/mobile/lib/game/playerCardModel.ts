/**
 * playerCardModel (W4): the player card's numbers for one stock on one manager's roster,
 * from data the app already has (PRODUCT_RULES "The stock player card": how it was got,
 * with the date and the price per share; the season line; this week's line). Pure, so
 * tests-deno/player-card-model.test.ts pins it.
 *
 *  - How it was got: the event that OPENED the held position — the last BUY, else the
 *    draft pick (the server's userSlotOccupancy rule). A draft reads "Drafted Nth overall";
 *    a buy reads "Bought". trades carry no waiver marker (trades.action is buy/sell only),
 *    so "Claimed off waivers" can't be told apart yet and is never invented.
 *  - The week figure: the server's own accounting (liveWeekScore) over this one stock, so
 *    it is exactly the row's number.
 *  - Since: (price now − entry price) × shares held.
 *  - The season line: closes from the acquisition date to now, from the entry price.
 *  - This week: the share price on the Mon…Fri axis (Mon open = 0, each close = its day's
 *    end), stopping at now.
 */
import { liveWeekScore, type LiveSnapshot, type LiveTrade } from '../home/liveWeekScore';
import type { LedgerActivityRow } from '../money/portfolioLedger';
import type { MarketCalendarSession } from '../time/marketWeek';
import { etWallClockToUtcIso } from '../time/marketWeek';
import { etDateOf } from './matchupRoster';
import type { Acquisition } from '../../components/sp/logic/gameNight';
import { dayOffset, formatAxisDate } from '../../components/sp/logic/chartAxis';
import type { LinePointIn } from '../../components/sp/logic/lineChart';

export interface Opening {
  acquisition: Acquisition;
  /** ET calendar date of the opening event (the season line's start). */
  dateIso: string;
  price: number;
  /** Shares held now (buys − sells, every event for the symbol). */
  quantity: number;
}

/** The opening event of `userId`'s position in `symbol`, from the league's activity. Null
 * when the ledger has no draft or buy for it (never a guessed acquisition). */
export function openingOf(userId: string, symbol: string, activity: readonly LedgerActivityRow[]): Opening | null {
  const sym = symbol.toUpperCase();
  const rows = activity
    .filter((r) => r.user_id === userId && r.symbol.toUpperCase() === sym)
    .sort((a, b) => (a.occurred_at < b.occurred_at ? -1 : a.occurred_at > b.occurred_at ? 1 : 0));
  let quantity = 0;
  for (const r of rows) quantity += r.action === 'sell' ? -r.quantity : r.quantity;
  const lastBuy = [...rows].reverse().find((r) => r.kind === 'trade' && r.action === 'buy');
  const draft = rows.find((r) => r.kind === 'draft');
  const open = lastBuy ?? draft;
  if (!open || open.price == null) return null;
  const dateIso = etDateOf(open.occurred_at);
  if (!dateIso) return null;
  const date = formatAxisDate(dateIso);
  const acquisition: Acquisition = open.kind === 'draft' && open.pick_number != null
    ? { kind: 'drafted', pick: open.pick_number, date, price: open.price }
    : { kind: 'bought', date, price: open.price };
  return { acquisition, dateIso, price: open.price, quantity: Math.max(0, Math.round(quantity * 1e6) / 1e6) };
}

/** This one stock's week: the row's own gain and percent (liveWeekScore over its lots). */
export function stockWeek(symbol: string, snapshots: readonly LiveSnapshot[], trades: readonly LiveTrade[], price: number | null): { gain: number; pct: number } {
  const sym = symbol.toUpperCase();
  const r = liveWeekScore(
    snapshots.filter((s) => s.symbol.toUpperCase() === sym),
    trades.filter((t) => t.symbol.toUpperCase() === sym),
    () => price,
  );
  return { gain: r.bySymbol[sym] ?? 0, pct: r.pct };
}

/** The last close strictly before today (ET): today's percent is measured from it. */
export function prevCloseOf(bars: readonly { date: string; close: number }[], todayEt: string): number | null {
  const before = bars.filter((b) => b.date < todayEt);
  return before.length ? before[before.length - 1].close : null;
}

/** "Since": (price − entry) × shares; percent of the entry price. */
export function sinceFigures(price: number, opening: Opening): { gain: number; pct: number } {
  return {
    gain: (price - opening.price) * opening.quantity,
    pct: opening.price > 0 ? ((price - opening.price) / opening.price) * 100 : 0,
  };
}

/** The season line: the entry price on the acquisition date, then each close after it,
 * then the live price at today. Dated axis from the acquisition date to today. One point
 * for a stock bought today (the dot on its full axis). */
export function seasonLine(input: {
  opening: Opening;
  bars: readonly { date: string; close: number }[];
  todayEt: string;
  price: number | null;
}): { points: LinePointIn[]; base: number; axis: { kind: 'dated'; start: string; end: string } } {
  const { opening, bars, todayEt, price } = input;
  const start = opening.dateIso;
  const byT = new Map<number, number>([[0, opening.price]]);
  for (const b of bars) {
    if (b.date <= start || b.date > todayEt) continue;
    byT.set(dayOffset(start, b.date), b.close);
  }
  if (price != null) byT.set(Math.max(0, dayOffset(start, todayEt)), price);
  const points = [...byT.entries()].sort((a, b) => a[0] - b[0]).map(([t, value]) => ({ t, value }));
  return { points, base: opening.price, axis: { kind: 'dated', start, end: todayEt < start ? start : todayEt } };
}

/** This week's line on the Mon…Fri axis: the week's opening price at t = 0, each closed
 * session's close at its day's end (t = 1…5), and, while a session runs, the live price at
 * the fraction of it elapsed. The days to come stay empty. */
export function weekLine(input: {
  /** The week's trading sessions, ascending (matchupRoster.weekSessions). */
  sessions: readonly MarketCalendarSession[];
  /** The price the week starts from: Monday's open (the snapshot's week-start price), or
   * the last close before the week for a stock entered mid-week. */
  open: number;
  bars: readonly { date: string; close: number }[];
  price: number | null;
  now: Date;
}): { points: LinePointIn[]; base: number } {
  const { sessions, open, bars, price, now } = input;
  const points: LinePointIn[] = [{ t: 0, value: open }];
  const today = etDateOf(now);
  for (const s of sessions) {
    const openIso = etWallClockToUtcIso(s.sessionDate, s.openEt);
    const closeIso = etWallClockToUtcIso(s.sessionDate, s.closeEt);
    if (!openIso || !closeIso) continue;
    // The day's slot on the axis by its weekday (Mon = 0), so a holiday leaves its slot empty.
    const [y, m, d] = s.sessionDate.split('-').map(Number);
    const slot = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
    if (slot > 4) continue;
    const o = new Date(openIso).getTime();
    const c = new Date(closeIso).getTime();
    const t = now.getTime();
    if (t >= c) {
      const bar = bars.find((b) => b.date === s.sessionDate);
      // A closed day's close: its bar, or on the close's own evening the quote (which IS it).
      const v = bar ? bar.close : s.sessionDate === today ? price : null;
      if (v != null) points.push({ t: slot + 1, value: v });
    } else if (t > o && price != null) {
      points.push({ t: slot + (t - o) / (c - o), value: price });
    }
  }
  return { points, base: open };
}

/** Everything the card shows for one stock, or null when the ledger has no opening event
 * for it (then the row isn't pressable: a card without "How you got it" is never shown). */
export interface PlayerCardData {
  ticker: string;
  company: string;
  price: number;
  todayPct: number;
  weekGain: number;
  weekPct: number;
  sinceGain: number;
  sincePct: number;
  acquisition: Acquisition;
  season: { points: LinePointIn[]; base: number; axis: { kind: 'dated'; start: string; end: string } };
  week: { points: LinePointIn[]; base: number };
  /** Shares held now: 0 = sold this week (still on this week's roster). */
  held: number;
}

export function playerCardData(input: {
  symbol: string;
  company: string;
  userId: string;
  activity: readonly LedgerActivityRow[];
  snapshots: readonly LiveSnapshot[];
  trades: readonly LiveTrade[];
  /** The row's own week gain (its whole cents), so the card and the row agree. */
  weekGain: number;
  price: number;
  /** Home's bars for the symbol (the week and the day before it). */
  bars: readonly { date: string; close: number }[];
  /** The season's daily closes, once loaded; null while loading or failed (the line then
   * shows its base and its full axis, never a made-up segment). */
  seasonBars: readonly { date: string; close: number }[] | null;
  sessions: readonly MarketCalendarSession[];
  now: Date;
}): PlayerCardData | null {
  const { symbol, company, userId, activity, snapshots, trades, weekGain, price, bars, seasonBars, sessions, now } = input;
  const opening = openingOf(userId, symbol, activity);
  if (!opening) return null;
  const todayEt = etDateOf(now) ?? '';
  const prev = prevCloseOf(bars, todayEt);
  const week = stockWeek(symbol, snapshots, trades, price);
  const since = sinceFigures(price, opening);
  const sym = symbol.toUpperCase();
  const monday = snapshots.find((s) => s.symbol.toUpperCase() === sym && !s.enteredMidWeek);
  const firstDay = sessions[0]?.sessionDate ?? todayEt;
  const weekOpen = monday ? monday.weekStartPrice : prevCloseOf(bars, firstDay) ?? opening.price;
  const season = seasonBars
    ? seasonLine({ opening, bars: seasonBars, todayEt, price })
    : { points: [], base: opening.price, axis: { kind: 'dated' as const, start: opening.dateIso, end: todayEt < opening.dateIso ? opening.dateIso : todayEt } };
  return {
    ticker: sym,
    company,
    price,
    todayPct: prev ? ((price - prev) / prev) * 100 : 0,
    weekGain,
    weekPct: week.pct,
    sinceGain: since.gain,
    sincePct: since.pct,
    acquisition: opening.acquisition,
    season,
    week: weekLine({ sessions, open: weekOpen, bars, price, now }),
    held: opening.quantity,
  };
}
