/**
 * portfolioSeam (W4, capture only): what Portfolio reads under the game capture seam
 * (EXPO_PUBLIC_GAME_SEAM=1), from the Matchup fixture's league — the same stocks, prices and
 * daily paths the player card already draws, so Portfolio, its cards and the stock sheet all
 * agree. Pure (no `__DEV__`, no env): devSeam.ts reads the flags and passes them in, so
 * tests-deno can pin it. Production never reaches it (usePortfolioData gates on SEAM_ON).
 */
import { fixtureSeasonBars, matchupWeekExtras, MSFT_BUY, seamSheetQuote, type MatchupFixtureVariant } from '../game/matchupFixture';
import { fixtureQty, GIANLUIGI_HOLDINGS, ROBERTO_HOLDINGS, XL_MILLION_ROBERTO_HOLDINGS, XL_ROBERTO_HOLDINGS } from '../home/homeFixtureData';
import { fixtureLedger } from '../game/matchupFixture';
import type { PortfolioLedger } from './portfolioLedger';
import { seamSearchPrice } from '../game/seamFixtures';

export type SeamStake = 'fixed_notional' | 'budget_cap' | 'budget_null' | 'price_tiers';

/** Capture only: "your draft happened today" — Thu Sep 24, 6:00 PM ET (after the close). */
export const SEAM_DRAFT_TODAY_AT = '2026-09-24T22:00:00.000Z';

/** The budget a budget-cap capture league leaves after its draft: enough for a cheap stock,
 * not for a $300 one, so the sheet's "costs more than your budget left" is reachable. */
export const SEAM_BUDGET_HEADROOM = 250;

/** The league Portfolio plays under the seam: the Matchup fixture's own (fixed_notional,
 * $2,000 × 6), or the same roster read as a budget cap / price tiers. */
export function seamPortfolioLeague(stake: SeamStake, variant: MatchupFixtureVariant): {
  stake_mode: 'fixed_notional' | 'budget_cap' | 'price_tiers';
  notional_per_slot: number | null;
  budget_amount: number | null;
  num_rounds: number;
} {
  const rows = variant === 'stress' ? XL_MILLION_ROBERTO_HOLDINGS : ROBERTO_HOLDINGS;
  const qtyScale = matchupWeekExtras(variant).qtyScale;
  // A budget cap whose budget_amount is NULL: the server's $0 cap (defect (d)).
  if (stake === 'budget_null') return { stake_mode: 'budget_cap', notional_per_slot: null, budget_amount: null, num_rounds: rows.length };
  if (stake === 'budget_cap') {
    const draftCost = rows.reduce((a, h) => a + h.draft * fixtureQty(h) * qtyScale, 0);
    return { stake_mode: 'budget_cap', notional_per_slot: null, budget_amount: Math.round((draftCost + SEAM_BUDGET_HEADROOM) * 100) / 100, num_rounds: rows.length };
  }
  if (stake === 'price_tiers') return { stake_mode: 'price_tiers', notional_per_slot: null, budget_amount: null, num_rounds: rows.length };
  // Each slot's notional is what the fixture drafted into it ($2,000; the stress league's own).
  const perSlot = rows.reduce((a, h) => a + h.draft * fixtureQty(h) * qtyScale, 0) / rows.length;
  return { stake_mode: 'fixed_notional', notional_per_slot: perSlot, budget_amount: null, num_rounds: rows.length };
}

/** A seam stock's live price and previous close: the stock sheet's own seam quote, or the
 * stress league's (Thursday live, Wednesday's close). */
export interface SeamClock {
  /** EXPO_PUBLIC_HOME_FIXTURE: on a Monday fixture (before the first close) the price is the
   * Monday open and the previous close Friday's, never Thursday's. */
  homeFixture?: string | null;
  /** The loss stress: every price mirrored below its draft price. */
  loss?: boolean;
}

const MONDAY_FIXTURES = new Set(['monday_preclose', 'week1_monday']);

/** The loss stress: a price mirrored below the stock's draft price (draft − (price − draft)),
 * so a gain of X becomes a loss of X; never under a cent. */
function mirror(v: number, draft: number): number {
  return Math.max(0.01, Math.round((2 * draft - v) * 100) / 100);
}

function draftOf(symbol: string, variant: MatchupFixtureVariant): number | null {
  const rows = variant === 'stress' ? XL_MILLION_ROBERTO_HOLDINGS : [...ROBERTO_HOLDINGS, ...XL_ROBERTO_HOLDINGS];
  return rows.find((r) => r.symbol === symbol.toUpperCase())?.draft ?? null;
}

function seamQuoteRaw(symbol: string, variant: MatchupFixtureVariant, clock: SeamClock): { price: number; prevClose: number } | null {
  if (clock.homeFixture && MONDAY_FIXTURES.has(clock.homeFixture)) {
    const h = [...ROBERTO_HOLDINGS, ...GIANLUIGI_HOLDINGS].find((r) => r.symbol === symbol.toUpperCase());
    const before = fixtureSeasonBars(symbol.toUpperCase(), variant).filter((b) => b.date < '2026-09-21');
    if (h && before.length) return { price: h.mon, prevClose: before[before.length - 1].close };
  }
  if (variant === 'stress') {
    const h = XL_MILLION_ROBERTO_HOLDINGS.find((r) => r.symbol === symbol.toUpperCase());
    if (h) return { price: h.thu, prevClose: h.prev };
  }
  const held = seamSheetQuote(symbol);
  if (held) return held;
  // A search sample nobody holds (the search → buy capture): its price, and a close 1.2% under.
  const p = seamSearchPrice(symbol);
  return p == null ? null : { price: p, prevClose: Math.round((p / 1.012) * 100) / 100 };
}

export function seamQuote(symbol: string, variant: MatchupFixtureVariant, clock: SeamClock = {}): { price: number; prevClose: number } | null {
  const q = seamQuoteRaw(symbol, variant, clock);
  const draft = draftOf(symbol, variant);
  if (!q || !clock.loss || draft == null) return q;
  return { price: mirror(q.price, draft), prevClose: mirror(q.prevClose, draft) };
}


/** A search sample's daily closes: a seeded walk over the year before the fixture week, ending
 * at its previous close (a real-looking line for the search → buy capture). */
function sampleBars(symbol: string, endClose: number): { date: string; close: number }[] {
  let h = 2166136261;
  for (const ch of symbol) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let a = h >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const days: string[] = [];
  for (let t = Date.UTC(2025, 8, 24); t <= Date.UTC(2026, 8, 23); t += 86_400_000) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) days.push(new Date(t).toISOString().slice(0, 10));
  }
  const walk = [0];
  for (let i = 1; i < days.length; i++) walk.push(walk[i - 1] + (rand() + rand() + rand() - 1.5) * 0.02);
  const last = walk[walk.length - 1];
  return days.map((date, i) => ({ date, close: Math.round(endClose * Math.exp(walk[i] - last) * 100) / 100 }));
}

function seamBarsRaw(symbol: string, variant: MatchupFixtureVariant): { date: string; close: number }[] {
  const sym = symbol.toUpperCase();
  if (sym === 'MSFT') return matchupWeekExtras('bought').bars.MSFT ?? [{ date: '2026-09-23', close: MSFT_BUY.prevClose }];
  const held = fixtureSeasonBars(sym, variant);
  if (held.length) return held;
  const q = seamQuoteRaw(sym, variant, {});
  return q ? sampleBars(sym, q.prevClose) : [];
}

/** A seam stock's daily closes since the draft (the player card's own seeded path). */
export function seamBars(symbol: string, variant: MatchupFixtureVariant, clock: SeamClock = {}): { date: string; close: number }[] {
  const bars = seamBarsRaw(symbol, variant);
  const draft = draftOf(symbol, variant);
  return clock.loss && draft != null ? bars.map((b) => ({ date: b.date, close: mirror(b.close, draft) })) : bars;
}



/** fixed_notional's open sale proceeds: each sale not followed by a buy (the seam has at most
 * one sale), as record-trade's preview would list them. */
export function seamOpenSales(ledger: PortfolioLedger, userId: string): { symbol: string; amount: number }[] {
  const mine = ledger.activity.filter((a) => a.user_id === userId && a.kind === 'trade');
  return mine
    .filter((s) => s.action === 'sell' && !mine.some((b) => b.action === 'buy' && b.occurred_at > s.occurred_at))
    .map((s) => ({ symbol: s.symbol, amount: Math.round(s.quantity * (s.price ?? 0) * 100) / 100 }));
}

/** The ledger Portfolio, its sheet and search read under the seam: the Matchup fixture's
 * league ledger with YOUR rows scoped to the roster the Home fixture actually holds (the
 * shared fixture also carries the XL leagues' extra stocks, which would read as a 7th and 8th
 * holding in a 6-slot league). Everyone else's rows are kept (owners in search). */
export function seamPortfolioLedger(variant: MatchupFixtureVariant, homeFixture: string | null, me: string, opp: string, draftAt: string | null = null): PortfolioLedger {
  const base = fixtureLedger(variant, me, opp);
  // Capture only: your draft happened at `draftAt` (the one-point Season line on draft day).
  const ledger = draftAt ? { ...base, activity: base.activity.map((a) => (a.user_id === me && a.kind === 'draft' ? { ...a, occurred_at: draftAt } : a)) } : base;
  const roster = variant === 'stress'
    ? XL_MILLION_ROBERTO_HOLDINGS
    : homeFixture && homeFixture.startsWith('xl') ? XL_ROBERTO_HOLDINGS : ROBERTO_HOLDINGS;
  const keep = new Set([...roster.map((h) => h.symbol), 'MSFT']);
  return { ...ledger, activity: ledger.activity.filter((a) => a.user_id !== me || keep.has(a.symbol.toUpperCase())) };
}
