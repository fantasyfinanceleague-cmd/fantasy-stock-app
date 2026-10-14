/**
 * The Matchup roster's capture fixture (W4): the board's Roberto vs Gianluigi B. week
 * (homeFixtureData.ts) plus what Matchup reads beyond Home — the league ledger (how each
 * stock was got, the company names) and, per variant, the league's slots. Pure data, no
 * `__DEV__`, so tests-deno can import it; the app reads it only through the capture seam
 * (SEAM_ON, useRosterData.ts). Production never sees it.
 *
 * Variants (EXPO_PUBLIC_MATCHUP_FIXTURE, capture only):
 *  - unset      an unslotted league (one list, best first).
 *  - 'category' category slots: Tech · Retail ×2 · Finance · Flex ×3 — one slot open on each side.
 *  - 'tiers'    price tiers by entry price: $200 or more ×5 · $100–$200 ×2 · up to $100 ×2.
 *  - 'bought'   unslotted, a realistic week of trades (a manager can't add to a stock the
 *               league owns — draft-validation's symbol_owned — so a buy is always a NEW
 *               stock): Roberto sold V on Tuesday and bought MSFT on Thursday morning (a
 *               1-point season line; its week line starts at the buy). Gianluigi's NKE was
 *               bought Sep 8.
 *  - 'sold'     unslotted, Roberto sold V on Tuesday and has NOT bought yet: the sale's cash
 *               waits (W4 Portfolio's "cash from a sale" state).
 *  - 'stress'   unslotted, the longest company names in the universe's style (§9B's stress
 *               fixture; pair with EXPO_PUBLIC_HOME_FIXTURE=xl_million for ≥ $1,000,000).
 */
import {
  ROBERTO_HOLDINGS, GIANLUIGI_HOLDINGS, XL_ROBERTO_HOLDINGS, XL_GIANLUIGI_HOLDINGS, XL_MILLION_ROBERTO_HOLDINGS,
  XL_MILLION_GIANLUIGI_HOLDINGS, fixtureQty, type HoldingRow,
} from '../home/homeFixtureData';
import type { LedgerActivityRow, PortfolioLedger } from '../money/portfolioLedger';
import type { Category } from '../../components/sp/logic/gameNight';
import type { SlotRow } from './matchupRoster';

export type MatchupFixtureVariant = 'unslotted' | 'category' | 'tiers' | 'bought' | 'sold' | 'stress';

export function parseMatchupFixture(raw: string | undefined): MatchupFixtureVariant {
  return raw === 'category' || raw === 'tiers' || raw === 'bought' || raw === 'sold' || raw === 'stress' ? raw : 'unslotted';
}

const NAMES: Record<string, string> = {
  NVDA: 'NVIDIA', AAPL: 'Apple', CRM: 'Salesforce', TSLA: 'Tesla', COST: 'Costco Wholesale', V: 'Visa',
  AMZN: 'Amazon.com', JPM: 'JPMorgan Chase & Co.', DIS: 'Walt Disney', NKE: 'Nike', KO: 'Coca-Cola', BA: 'Boeing',
  // The XL leagues' own extra holdings (homeFixtureData.ts).
  PLTR: 'Palantir', XOM: 'Exxon Mobil',
};

/** §9B stress: real listed names at their full, longest form. */
const STRESS_NAMES: Record<string, string> = {
  NVDA: 'NVIDIA Corporation Common Stock', AAPL: 'Apple Inc. Common Stock', CRM: 'Salesforce, Inc. Common Stock',
  TSLA: 'Tesla, Inc. Common Stock', COST: 'Costco Wholesale Corporation Common Stock', V: 'Visa Inc. Class A Common Stock',
  AMZN: 'Amazon.com, Inc. Common Stock', JPM: 'JPMorgan Chase & Co. Common Stock', DIS: 'The Walt Disney Company Common Stock',
  NKE: 'Nike, Inc. Class B Common Stock', KO: 'The Coca-Cola Company Common Stock', BA: 'The Boeing Company Common Stock',
  PLTR: 'Palantir Technologies Inc. Class A Common Stock', XOM: 'Exxon Mobil Corporation Common Stock',
};

const CATEGORY: Record<string, Category> = {
  NVDA: 'tech', AAPL: 'tech', CRM: 'tech', TSLA: 'transport', COST: 'retail', V: 'finance',
  AMZN: 'retail', JPM: 'finance', DIS: 'media', NKE: 'retail', KO: 'food', BA: 'industrials',
};

/** A 6-team snake: Roberto picks 2nd, Gianluigi 5th. */
const PICKS: Record<string, number> = {
  NVDA: 2, AAPL: 11, CRM: 14, TSLA: 23, COST: 26, V: 35,
  AMZN: 5, JPM: 8, DIS: 17, NKE: 20, KO: 29, BA: 32,
  PLTR: 38, XOM: 41,
};

const DRAFTED_AT = '2026-09-01T00:30:00.000Z'; // Mon Aug 31, 8:30 PM ET
const NKE_BUY_AT = '2026-09-08T15:00:00.000Z';

/** §9B stress: the XL million league's share counts ×15 — your week tops $1,000,000 and the
 * card's figures (week, since the draft) move with the same shares. */
export const STRESS_QTY_SCALE = 15;

const V_ROW = ROBERTO_HOLDINGS.find((h) => h.symbol === 'V')!;
/** Tuesday 11:10 AM ET: V sold at $286.10 (it had run up from Monday's $284.20). */
const V_SELL = { at: '2026-09-22T15:10:00.000Z', price: 286.1 };
/** Thursday 10:05 AM ET: MSFT bought with the proceeds at $412.30; live $418.92 at 1:37 PM. */
export const MSFT_BUY = { at: '2026-09-24T14:05:00.000Z', price: 412.3, live: 418.92, prevClose: 409.64 };

/** The 'bought' week's trades (sell V, buy MSFT), as get_home_league returns my_trades ('sold'
 * keeps the sale only). */
export function boughtWeekTrades(): { symbol: string; action: 'buy' | 'sell'; quantity: number; price: number; created_at: string }[] {
  const vQty = fixtureQty(V_ROW);
  const msftQty = Math.round(((vQty * V_SELL.price) / MSFT_BUY.price) * 1e4) / 1e4;
  return [
    { symbol: 'V', action: 'sell', quantity: vQty, price: V_SELL.price, created_at: V_SELL.at },
    { symbol: 'MSFT', action: 'buy', quantity: msftQty, price: MSFT_BUY.price, created_at: MSFT_BUY.at },
  ];
}

export function fixtureLedger(variant: MatchupFixtureVariant, me: string, opp: string): PortfolioLedger {
  const rows: LedgerActivityRow[] = [];
  const add = (userId: string, h: HoldingRow) => {
    const bought = variant === 'bought' && h.symbol === 'NKE';
    const q = fixtureQty(h) * (variant === 'stress' ? STRESS_QTY_SCALE : 1);
    rows.push(bought
      ? { kind: 'trade', user_id: userId, symbol: h.symbol, action: 'buy', quantity: q, round: null, pick_number: null,
        occurred_at: NKE_BUY_AT, total_value: null, price: h.draft }
      : { kind: 'draft', user_id: userId, symbol: h.symbol, action: 'buy', quantity: q, round: Math.ceil(PICKS[h.symbol] / 6), pick_number: PICKS[h.symbol],
        occurred_at: DRAFTED_AT, total_value: null, price: h.draft });
  };
  // The XL leagues (EXPO_PUBLIC_HOME_FIXTURE=xl_large_numbers / xl_million) hold the same
  // symbols plus PLTR and XOM: every symbol either league can hold has its pick.
  const withXl = (base: HoldingRow[], xl: HoldingRow[]) => [...base, ...xl.filter((x) => !base.some((b) => b.symbol === x.symbol))];
  // The stress fixture plays the XL million league: its own share counts and draft prices,
  // so the card's "Since the draft" and the row's week agree.
  const mine = variant === 'stress' ? XL_MILLION_ROBERTO_HOLDINGS : withXl(ROBERTO_HOLDINGS, XL_ROBERTO_HOLDINGS);
  const theirs = variant === 'stress' ? XL_MILLION_GIANLUIGI_HOLDINGS : withXl(GIANLUIGI_HOLDINGS, XL_GIANLUIGI_HOLDINGS);
  for (const h of mine) add(me, h);
  for (const h of theirs) add(opp, h);
  if (variant === 'bought' || variant === 'sold') {
    for (const t of boughtWeekTrades().filter((x) => variant === 'bought' || x.action === 'sell')) {
      rows.push({ kind: 'trade', user_id: me, symbol: t.symbol, action: t.action, quantity: t.quantity, round: null, pick_number: null, occurred_at: t.created_at, total_value: null, price: t.price });
    }
  }
  return { activity: rows, symbol_names: { ...(variant === 'stress' ? STRESS_NAMES : NAMES), MSFT: 'Microsoft' },
    // The two managers, so the stock sheet names an owner (it skips a pick without a round,
    // and names owners from members).
    members: [{ user_id: me, display_name: 'Roberto B.', is_bot: false }, { user_id: opp, display_name: 'Gianluigi B.', is_bot: false }] };
}

function bySide(me: string, opp: string, slotOf: (sym: string) => string): Record<string, Record<string, string | null>> {
  const of = (rows: HoldingRow[]) => Object.fromEntries(rows.map((h) => [h.symbol, slotOf(h.symbol)]));
  return { [me]: of(ROBERTO_HOLDINGS), [opp]: of(GIANLUIGI_HOLDINGS) };
}

/** The variant's slots and each side's recorded slot per symbol (the server's record). */
export function fixtureSlots(variant: MatchupFixtureVariant, me: string, opp: string): { slots: SlotRow[]; bySide: Record<string, Record<string, string | null>> } | null {
  if (variant === 'category') {
    // Both rosters fill it, each leaving ONE slot open: Roberto's second Retail, Gianluigi's Tech.
    const slots: SlotRow[] = [
      { id: 'tech', slot_index: 0, slot_count: 1, price_min: null, price_max: null, category: 'tech' },
      { id: 'retail', slot_index: 1, slot_count: 2, price_min: null, price_max: null, category: 'retail' },
      { id: 'finance', slot_index: 2, slot_count: 1, price_min: null, price_max: null, category: 'finance' },
      { id: 'flex', slot_index: 3, slot_count: 3, price_min: null, price_max: null, category: null },
    ];
    const slotOf = (sym: string) => (sym === 'NVDA' ? 'tech' : CATEGORY[sym] === 'retail' ? 'retail' : CATEGORY[sym] === 'finance' ? 'finance' : 'flex');
    return { slots, bySide: bySide(me, opp, slotOf) };
  }
  if (variant === 'tiers') {
    const slots: SlotRow[] = [
      { id: 'hi', slot_index: 0, slot_count: 5, price_min: 200, price_max: null, category: null },
      { id: 'mid', slot_index: 1, slot_count: 2, price_min: 100, price_max: 200, category: null },
      { id: 'lo', slot_index: 2, slot_count: 2, price_min: null, price_max: 100, category: null },
    ];
    const draftOf = (sym: string) => [...ROBERTO_HOLDINGS, ...GIANLUIGI_HOLDINGS].find((h) => h.symbol === sym)!.draft;
    const slotOf = (sym: string) => (draftOf(sym) >= 200 ? 'hi' : draftOf(sym) >= 100 ? 'mid' : 'lo');
    return { slots, bySide: bySide(me, opp, slotOf) };
  }
  return null;
}


/** A deterministic PRNG per symbol (mulberry32 over a string hash): every stock its own
 * path, the same path on every run. */
function rng(seed: string): () => number {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r2 = (v: number) => Math.round(v * 100) / 100;


/** The holding a symbol is in this variant (the stress fixture plays the XL million league). */
function holdingFor(symbol: string, variant: MatchupFixtureVariant): HoldingRow | undefined {
  const rows = variant === 'stress'
    ? [...XL_MILLION_ROBERTO_HOLDINGS, ...XL_MILLION_GIANLUIGI_HOLDINGS]
    : [...ROBERTO_HOLDINGS, ...GIANLUIGI_HOLDINGS, ...XL_ROBERTO_HOLDINGS, ...XL_GIANLUIGI_HOLDINGS];
  return rows.find((r) => r.symbol === symbol);
}

/** The fixture week's daily closes: Monday and Tuesday move on their own (no flat days, no
 * single Thursday pop — Giorgio rejected that shape), Wednesday's close IS the fixture's
 * `prev` (the close the roster is ordered by), Thursday is live. */
export function fixtureWeekBars(symbol: string, variant: MatchupFixtureVariant = 'unslotted'): { date: string; close: number }[] {
  const h = holdingFor(symbol, variant);
  if (!h) return [];
  const rand = rng(`${symbol}-week`);
  const move = h.prev - h.mon;
  const noise = () => (rand() - 0.5) * 0.012 * h.mon; // ±0.6% a day
  const monClose = r2(h.mon + move * (0.15 + rand() * 0.45) + noise());
  const tueClose = r2(h.mon + move * (0.35 + rand() * 0.6) + noise());
  return [{ date: '2026-09-21', close: monClose }, { date: '2026-09-22', close: tueClose }, { date: '2026-09-23', close: h.prev }];
}

/** Daily closes for the card's season line: from the session after the draft to the Friday
 * before the fixture week, a seeded Brownian bridge from the draft price to Monday's open
 * (each stock its own volatility and shape), then the fixture week's own bars. */
export function fixtureSeasonBars(symbol: string, variant: MatchupFixtureVariant = 'unslotted'): { date: string; close: number }[] {
  const h = holdingFor(symbol, variant);
  if (!h) return [];
  const start = Date.UTC(2026, 8, 1); // Tue Sep 1, the first session after the draft
  const end = Date.UTC(2026, 8, 18); // Fri Sep 18
  const days: number[] = [];
  for (let t = start; t <= end; t += 86_400_000) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) days.push(t);
  }
  const rand = rng(`${symbol}-season`);
  const vol = 0.008 + rand() * 0.014; // 0.8%–2.2% a day
  // A random walk, then bridged so it ends exactly at Monday's open.
  const walk: number[] = [0];
  for (let i = 1; i <= days.length + 1; i++) {
    const z = (rand() + rand() + rand() - 1.5) * 2; // ~N(0, 1)
    walk.push(walk[i - 1] + z * vol);
  }
  const n = walk.length - 1;
  const target = Math.log(h.mon / h.draft);
  const out = days.map((t, i) => {
    const k = i + 1;
    const bridged = walk[k] - (k / n) * walk[n] + (k / n) * target;
    return { date: new Date(t).toISOString().slice(0, 10), close: r2(h.draft * Math.exp(bridged)) };
  });
  return [...out, ...fixtureWeekBars(symbol, variant)];
}

// ── 'bought': the week's trades, in get_home_league's shape ─────────────────────

/** What a Home fixture adds under EXPO_PUBLIC_MATCHUP_FIXTURE: the week's trades, the extra
 * quote and the extra daily bars. Empty for every other variant. */
export function matchupWeekExtras(variant: MatchupFixtureVariant): {
  trades: ReturnType<typeof boughtWeekTrades>;
  quotes: Record<string, number>;
  bars: Record<string, { date: string; close: number }[]>;
  /** Share-count multiplier: 'stress' takes the XL million league to seven-figure weeks. */
  qtyScale: number;
} {
  if (variant === 'stress') return { trades: [], quotes: {}, bars: {}, qtyScale: STRESS_QTY_SCALE };
  if (variant === 'sold') return { trades: boughtWeekTrades().filter((t) => t.action === 'sell'), quotes: {}, bars: {}, qtyScale: 1 };
  if (variant !== 'bought') return { trades: [], quotes: {}, bars: {}, qtyScale: 1 };
  return {
    qtyScale: 1,
    trades: boughtWeekTrades(),
    quotes: { MSFT: MSFT_BUY.live },
    bars: { MSFT: [{ date: '2026-09-21', close: 404.18 }, { date: '2026-09-22', close: 407.02 }, { date: '2026-09-23', close: MSFT_BUY.prevClose }, { date: '2026-09-24', close: MSFT_BUY.live }] },
  };
}

// ── The stock sheet under the capture seam (Sell's tap-through) ──────────────────

/** A seam stock's quote for the stock sheet: the fixture's live price and the last close
 * before it (Wednesday's), so the existing sheet opens with its real Buy / Sell controls. */
export function seamSheetQuote(symbol: string): { price: number; prevClose: number } | null {
  const sym = symbol.toUpperCase();
  if (sym === 'MSFT') return { price: MSFT_BUY.live, prevClose: MSFT_BUY.prevClose };
  const h = [...ROBERTO_HOLDINGS, ...GIANLUIGI_HOLDINGS].find((r) => r.symbol === sym);
  return h ? { price: h.thu, prevClose: h.prev } : null;
}
