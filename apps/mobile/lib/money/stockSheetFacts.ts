/**
 * stockSheetFacts: who holds a symbol in one league, derived from the league's
 * draft picks and trades (3e). Pure, so the sheet's ownership rules are tested
 * without a network.
 *
 * A stock is owned by at most one manager in a league (symbol_owned). If the
 * data ever shows two owners, that is a partial-state failure, so the result
 * is `conflict` and the sheet refuses to say who owns it, rather than guess.
 */
export interface FactsDraft {
  user_id: string;
  symbol: string;
  quantity: number;
  round: number;
  pick_number: number;
}

export interface FactsTrade {
  user_id: string;
  symbol: string;
  action: string;
  quantity: number;
}

export interface FactsName {
  displayName: string | null;
  isBot: boolean;
}

export interface StockSheetFacts {
  held: { quantity: number } | null;
  draft: { round: number; inRoundPick: number } | null;
  owner: { kind: 'me' } | { kind: 'other'; name: string | null; isBot: boolean } | null;
  conflict: boolean;
}

const EPS = 1e-9;

export function deriveStockSheetFacts(input: {
  symbol: string;
  userId: string;
  drafts: FactsDraft[];
  trades: FactsTrade[];
  /** Every league pick (round + user), to count managers per round. */
  leaguePicks: { round: number; user_id: string }[];
  names: Record<string, FactsName>;
}): StockSheetFacts {
  const sym = input.symbol.toUpperCase();
  const net = new Map<string, number>();

  for (const d of input.drafts) {
    if (d.symbol.toUpperCase() !== sym) continue;
    net.set(d.user_id, (net.get(d.user_id) ?? 0) + Number(d.quantity));
  }
  for (const t of input.trades) {
    if (t.symbol.toUpperCase() !== sym) continue;
    const q = Number(t.quantity);
    net.set(t.user_id, (net.get(t.user_id) ?? 0) + (t.action === 'sell' ? -q : q));
  }

  const owners = [...net].filter(([, q]) => q > EPS);
  if (owners.length > 1) {
    return { held: null, draft: null, owner: null, conflict: true };
  }
  if (owners.length === 0) {
    return { held: null, draft: null, owner: null, conflict: false };
  }

  const [ownerId, ownerQty] = owners[0];

  if (ownerId === input.userId) {
    const myDraft = input.drafts
      .filter((d) => d.user_id === input.userId && d.symbol.toUpperCase() === sym && Number(d.quantity) > EPS)
      .sort((a, b) => a.pick_number - b.pick_number)[0];
    let draft: StockSheetFacts['draft'] = null;
    if (myDraft) {
      const managersInRound = new Set(
        input.leaguePicks.filter((p) => p.round === myDraft.round).map((p) => p.user_id),
      ).size;
      // In-round pick: the overall pick number less the picks before this round.
      // Only computed when the round is fully known; otherwise no draft line.
      if (managersInRound > 0) {
        draft = {
          round: myDraft.round,
          inRoundPick: myDraft.pick_number - (myDraft.round - 1) * managersInRound,
        };
      }
    }
    return { held: { quantity: ownerQty }, draft, owner: { kind: 'me' }, conflict: false };
  }

  const name = input.names[ownerId];
  return {
    held: null,
    draft: null,
    owner: { kind: 'other', name: name?.displayName ?? null, isBot: name?.isBot ?? false },
    conflict: false,
  };
}
