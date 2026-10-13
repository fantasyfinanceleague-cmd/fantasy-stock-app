/**
 * The Matchup roster's capture fixture (W4): the board's Roberto vs Gianluigi B. week
 * (homeFixtureData.ts) plus what Matchup reads beyond Home — the league ledger (how each
 * stock was got, the company names) and, per variant, the league's slots. Pure data, no
 * `__DEV__`, so tests-deno can import it; the app reads it only through the capture seam
 * (SEAM_ON, useRosterData.ts). Production never sees it.
 *
 * Variants (EXPO_PUBLIC_MATCHUP_FIXTURE, capture only):
 *  - unset      an unslotted league (one list, best first).
 *  - 'category' category slots: Tech ×3 · Finance · Retail ×2 · Flex ×3.
 *  - 'tiers'    price tiers by entry price: $200 or more ×5 · $100–$200 ×2 · up to $100 ×2.
 *  - 'bought'   unslotted; Roberto's COST was bought, not drafted, and today (a 1-point
 *               season line). Gianluigi's NKE was bought Sep 8.
 */
import { ROBERTO_HOLDINGS, GIANLUIGI_HOLDINGS, fixtureQty, type HoldingRow } from '../home/homeFixtureData';
import type { LedgerActivityRow, PortfolioLedger } from '../money/portfolioLedger';
import type { Category } from '../../components/sp/logic/gameNight';
import type { SlotRow } from './matchupRoster';

export type MatchupFixtureVariant = 'unslotted' | 'category' | 'tiers' | 'bought';

export function parseMatchupFixture(raw: string | undefined): MatchupFixtureVariant {
  return raw === 'category' || raw === 'tiers' || raw === 'bought' ? raw : 'unslotted';
}

const NAMES: Record<string, string> = {
  NVDA: 'NVIDIA', AAPL: 'Apple', CRM: 'Salesforce', TSLA: 'Tesla', COST: 'Costco Wholesale', V: 'Visa',
  AMZN: 'Amazon.com', JPM: 'JPMorgan Chase & Co.', DIS: 'Walt Disney', NKE: 'Nike', KO: 'Coca-Cola', BA: 'Boeing',
};

const CATEGORY: Record<string, Category> = {
  NVDA: 'tech', AAPL: 'tech', CRM: 'tech', TSLA: 'transport', COST: 'retail', V: 'finance',
  AMZN: 'retail', JPM: 'finance', DIS: 'media', NKE: 'retail', KO: 'food', BA: 'industrials',
};

/** A 6-team snake: Roberto picks 2nd, Gianluigi 5th. */
const PICKS: Record<string, number> = {
  NVDA: 2, AAPL: 11, CRM: 14, TSLA: 23, COST: 26, V: 35,
  AMZN: 5, JPM: 8, DIS: 17, NKE: 20, KO: 29, BA: 32,
};

const DRAFTED_AT = '2026-09-01T00:30:00.000Z'; // Mon Aug 31, 8:30 PM ET
/** The fixtures' "now" is Thursday Sep 24 (1:37 PM ET); 'bought' buys COST that morning. */
const TODAY_BUY_AT = '2026-09-24T14:05:00.000Z';
const NKE_BUY_AT = '2026-09-08T15:00:00.000Z';

export function fixtureLedger(variant: MatchupFixtureVariant, me: string, opp: string): PortfolioLedger {
  const rows: LedgerActivityRow[] = [];
  const add = (userId: string, h: HoldingRow) => {
    const bought = variant === 'bought' && (h.symbol === 'COST' || h.symbol === 'NKE');
    rows.push(bought
      ? { kind: 'trade', user_id: userId, symbol: h.symbol, action: 'buy', quantity: fixtureQty(h), round: null, pick_number: null,
        occurred_at: h.symbol === 'COST' ? TODAY_BUY_AT : NKE_BUY_AT, total_value: null, price: h.symbol === 'COST' ? h.thu - 6.4 : h.draft }
      : { kind: 'draft', user_id: userId, symbol: h.symbol, action: 'buy', quantity: fixtureQty(h), round: null, pick_number: PICKS[h.symbol],
        occurred_at: DRAFTED_AT, total_value: null, price: h.draft });
  };
  for (const h of ROBERTO_HOLDINGS) add(me, h);
  for (const h of GIANLUIGI_HOLDINGS) add(opp, h);
  return { activity: rows, symbol_names: { ...NAMES }, members: [] };
}

function bySide(me: string, opp: string, slotOf: (sym: string) => string): Record<string, Record<string, string | null>> {
  const of = (rows: HoldingRow[]) => Object.fromEntries(rows.map((h) => [h.symbol, slotOf(h.symbol)]));
  return { [me]: of(ROBERTO_HOLDINGS), [opp]: of(GIANLUIGI_HOLDINGS) };
}

/** The variant's slots and each side's recorded slot per symbol (the server's record). */
export function fixtureSlots(variant: MatchupFixtureVariant, me: string, opp: string): { slots: SlotRow[]; bySide: Record<string, Record<string, string | null>> } | null {
  if (variant === 'category') {
    const slots: SlotRow[] = [
      { id: 'tech', slot_index: 0, slot_count: 3, price_min: null, price_max: null, category: 'tech' },
      { id: 'finance', slot_index: 1, slot_count: 1, price_min: null, price_max: null, category: 'finance' },
      { id: 'retail', slot_index: 2, slot_count: 2, price_min: null, price_max: null, category: 'retail' },
      { id: 'flex', slot_index: 3, slot_count: 3, price_min: null, price_max: null, category: null },
    ];
    const slotOf = (sym: string) => {
      const c = CATEGORY[sym];
      return c === 'tech' || c === 'finance' || c === 'retail' ? c : 'flex';
    };
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


/** Daily closes for the card's season line: from the acquisition to Monday's open of the
 * fixture week, a deterministic walk (never flat), then the fixture week's own bars. */
export function fixtureSeasonBars(symbol: string): { date: string; close: number }[] {
  const h = [...ROBERTO_HOLDINGS, ...GIANLUIGI_HOLDINGS].find((r) => r.symbol === symbol);
  if (!h) return [];
  const out: { date: string; close: number }[] = [];
  const start = Date.UTC(2026, 8, 1); // Tue Sep 1, the first session after the draft
  const end = Date.UTC(2026, 8, 18); // Fri Sep 18
  const days: number[] = [];
  for (let t = start; t <= end; t += 86_400_000) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) days.push(t);
  }
  days.forEach((t, i) => {
    const f = (i + 1) / (days.length + 1);
    const wiggle = Math.sin(i * 1.7 + symbol.length) * 0.012 * h.draft;
    const close = Math.round((h.draft + (h.mon - h.draft) * f + wiggle) * 100) / 100;
    out.push({ date: new Date(t).toISOString().slice(0, 10), close });
  });
  out.push({ date: '2026-09-21', close: h.mon }, { date: '2026-09-22', close: Math.round(((h.mon + h.prev) / 2) * 100) / 100 }, { date: '2026-09-23', close: h.prev });
  return out;
}
