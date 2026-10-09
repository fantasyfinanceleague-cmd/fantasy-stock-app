/**
 * portfolioLedger: the typed shape of get_portfolio_ledger's response (3e) and
 * the mapping from it to the inputs the stock sheet and Portfolio need. Pure.
 *
 * A malformed response is refused as a whole (null), never half-used: a
 * partial ledger would give a partial ownership picture, which is the same
 * all-or-nothing trap CLAUDE.md warns about. Fields are checked, not cast.
 */
import type { FactsDraft, FactsName, FactsTrade } from './stockSheetFacts';

export interface LedgerActivityRow {
  kind: 'draft' | 'trade';
  user_id: string;
  symbol: string;
  action: string;
  quantity: number;
  round: number | null;
  pick_number: number | null;
  occurred_at: string;
  total_value: number | null;
  price: number | null;
}

export interface LedgerMember {
  user_id: string;
  display_name: string;
  is_bot: boolean;
}

export interface PortfolioLedger {
  activity: LedgerActivityRow[];
  symbol_names: Record<string, string>;
  members: LedgerMember[];
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNumOrNull = (v: unknown): v is number | null => v === null || isNum(v);

function parseActivityRow(r: unknown): LedgerActivityRow | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  if (o.kind !== 'draft' && o.kind !== 'trade') return null;
  if (!isStr(o.user_id) || !isStr(o.symbol) || !isStr(o.action) || !isNum(o.quantity)) return null;
  if (!isNumOrNull(o.round) || !isNumOrNull(o.pick_number)) return null;
  if (!isStr(o.occurred_at)) return null;
  if (!isNumOrNull(o.total_value ?? null) || !isNumOrNull(o.price ?? null)) return null;
  return {
    kind: o.kind,
    user_id: o.user_id,
    symbol: o.symbol,
    action: o.action,
    quantity: o.quantity,
    round: o.round as number | null,
    pick_number: o.pick_number as number | null,
    occurred_at: o.occurred_at,
    total_value: (o.total_value as number | null | undefined) ?? null,
    price: (o.price as number | null | undefined) ?? null,
  };
}

/** The RPC's JSON, validated. Null on ANY malformed part: the whole read is refused. */
export function parsePortfolioLedger(raw: unknown): PortfolioLedger | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.activity) || !Array.isArray(o.members)) return null;
  if (!o.symbol_names || typeof o.symbol_names !== 'object' || Array.isArray(o.symbol_names)) return null;

  const activity: LedgerActivityRow[] = [];
  for (const r of o.activity) {
    const row = parseActivityRow(r);
    if (!row) return null;
    activity.push(row);
  }

  const members: LedgerMember[] = [];
  for (const m of o.members) {
    if (!m || typeof m !== 'object') return null;
    const mm = m as Record<string, unknown>;
    if (!isStr(mm.user_id) || !isStr(mm.display_name) || typeof mm.is_bot !== 'boolean') return null;
    members.push({ user_id: mm.user_id, display_name: mm.display_name, is_bot: mm.is_bot });
  }

  const symbol_names: Record<string, string> = {};
  for (const [sym, name] of Object.entries(o.symbol_names as Record<string, unknown>)) {
    if (!isStr(name)) return null;
    symbol_names[sym.toUpperCase()] = name;
  }

  return { activity, symbol_names, members };
}

/** The inputs the stock sheet's ownership rules take, from one ledger. */
export function sheetInputsFromLedger(ledger: PortfolioLedger): {
  drafts: FactsDraft[];
  trades: FactsTrade[];
  leaguePicks: { round: number; user_id: string }[];
  names: Record<string, FactsName>;
} {
  const drafts: FactsDraft[] = [];
  const trades: FactsTrade[] = [];
  for (const a of ledger.activity) {
    if (a.kind === 'draft') {
      // A draft row without a round or pick number can't place itself: skip it
      // rather than invent a pick (the sheet then shows no draft line).
      if (a.round == null || a.pick_number == null) continue;
      drafts.push({ user_id: a.user_id, symbol: a.symbol, quantity: a.quantity, round: a.round, pick_number: a.pick_number });
    } else {
      trades.push({ user_id: a.user_id, symbol: a.symbol, action: a.action, quantity: a.quantity });
    }
  }
  const leaguePicks = drafts.map((d) => ({ round: d.round, user_id: d.user_id }));
  const names: Record<string, FactsName> = {};
  for (const m of ledger.members) names[m.user_id] = { displayName: m.display_name, isBot: m.is_bot };
  return { drafts, trades, leaguePicks, names };
}
