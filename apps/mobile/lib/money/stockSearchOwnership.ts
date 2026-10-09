/**
 * stockSearchOwnership: the search result's ownership label (3e UX audit,
 * E-3, board #buy-a-stock). Who owns a symbol comes from deriveStockSheetFacts
 * (the same league-wide ledger read the stock sheet already uses) -- never a
 * new RPC. Not-draftable is a separate, prior concern (lib/symbolSearch.ts's
 * own is_draftable handling); this module only labels ownership for a symbol
 * that IS in the league's list.
 */
import { COPY } from './moneyCopy';
import type { StockSheetFacts } from './stockSheetFacts';

export interface OwnershipSuffix {
  /** Appended to the result's subtitle, or null when nobody owns it. */
  text: string | null;
  /** True for the caller's own holding (distinct styling, board ruling (a)). */
  mine: boolean;
}

/**
 * (a) mine -> "You own this"; (b) another manager's -> "Owned by {name}", with
 * "another manager" as the fallback when the name isn't resolved; a ledger
 * conflict (more than one owner -- a data-integrity failure) or no owner at
 * all both show nothing, never a guess.
 */
export function ownershipSuffix(owner: StockSheetFacts['owner'], conflict: boolean): OwnershipSuffix {
  if (conflict || !owner) return { text: null, mine: false };
  if (owner.kind === 'me') return { text: COPY.youOwnThis, mine: true };
  return { text: COPY.ownedBy(owner.name ?? 'another manager'), mine: false };
}
