/**
 * stockSheetModel: every decision the stock sheet makes, as pure data (3e).
 * The sheet component only renders this, so the rules are tested without RN.
 *
 *   held                       → Sell is selected; the sell summary is the whole
 *                                position ("Sell all X sh ≈ $Y", no partial amount).
 *   free and the market open   → Buy is selected and enabled.
 *   owned by another manager   → Buy disabled, "Owned by {name}" (+ Bot badge).
 *   already held by you        → Buy disabled ("You already hold this stock.").
 *   market closed              → both actions disabled with the card's own note ("Market's
 *                                closed. Opens Fri 9:30 AM ET."); the
 *                                sheet still informs (previews stay allowed).
 *   price unknown              → the action is disabled; never a $0 figure.
 *   roster full (budget/tier)  → Buy disabled ("Your roster is full. Sell a holding first.").
 *   price over the budget left → Buy disabled ("{SYMBOL} costs more than your budget left."),
 *                                BEFORE the review (W4 defect (a)): the preview's would_fill
 *                                ignores the budget, so the review used to offer a buy the
 *                                server then refused as over_budget, showing "Budget left
 *                                after −$X" on the way.
 *
 * A stock is owned by at most one manager in a league (symbol_owned), so the
 * owner is either the caller, another manager, or nobody.
 */
import { formatMoney } from '../../components/sp/logic/money';
import { cleanCompanyName } from './cleanCompanyName';
import { formatShares } from './formatShares';
import { COPY } from './moneyCopy';

export interface StockSheetInput {
  symbol: string;
  companyName: string | null;
  price: number | null;
  prevClose: number | null;
  /** The caller's own holding, or null. */
  held: { quantity: number } | null;
  /** Who owns it in this league when it isn't the caller. */
  owner: { kind: 'me' } | { kind: 'other'; name: string | null; isBot: boolean } | null;
  /** The caller's draft row for a held stock, when it was drafted. */
  draft: { round: number; inRoundPick: number } | null;
  gate: { open: boolean; opensLabel?: string | null };
  leagueName: string;
  /** e.g. "Friday's close", for the closed-market note. */
  lastCloseLabel: string | null;
  /** How you got a held stock, in the player card's words ("Drafted 2nd overall · Aug 31 ·
   * $290.10", gameNight.acquisitionLine): one string for it on the card and the sheet. */
  acquisition?: string | null;
  /** budget_cap only: the server's cap minus cash spent (budgetFigures); null elsewhere or unread. */
  budgetLeft?: number | null;
  /** budget_cap / price_tiers: every slot is held, so a buy has nowhere to go. */
  rosterFull?: boolean;
}

export interface ActionState {
  enabled: boolean;
  reason: string | null;
}

export interface StockSheetModel {
  name: string;
  selected: 'buy' | 'sell';
  /** blockedBy names WHY buy is disabled, so the sheet can show the right
   * pre-review block (E-3, 3e UX audit): 'owned' gets a warn card and a
   * visible disabled Review buy, the others keep the plain caption. */
  buy: ActionState & { blockedBy: 'closed' | 'price' | 'owned' | 'held' | 'full' | 'budget' | null };
  sell: ActionState & { summary: string | null };
  ownershipLine: string;
  ownerBadge: 'Bot' | null;
  marketNote: string | null;
  todayChange: { perShare: number; pct: number } | null;
}

const cents = (v: number) => Math.round(v * 100) / 100;

export function stockSheetModel(input: StockSheetInput): StockSheetModel {
  const held = input.held !== null;
  const other = input.owner && input.owner.kind === 'other' ? input.owner : null;
  const otherOwned = other !== null;
  const priced = input.price !== null && Number.isFinite(input.price);

  const closedReason = input.gate.open
    ? null
    : input.gate.opensLabel
      ? COPY.marketClosedOpens(input.gate.opensLabel)
      : COPY.tradingHoursUnavailable;

  const priceReason = priced ? null : COPY.noPrice;

  // Buy: the first failing rule explains the disabled state.
  let buyReason: string | null = closedReason ?? priceReason;
  let buyBlockedBy: StockSheetModel['buy']['blockedBy'] = buyReason ? (closedReason ? 'closed' : 'price') : null;
  if (buyReason === null && otherOwned) {
    buyReason = COPY.ownedBy((other!.name ?? 'another manager'));
    buyBlockedBy = 'owned';
  }
  if (buyReason === null && held) {
    buyReason = COPY.alreadyHeld;
    buyBlockedBy = 'held';
  }
  if (buyReason === null && input.rosterFull) {
    buyReason = COPY.rosterFull;
    buyBlockedBy = 'full';
  }
  // One share per buy in a budget league: the share's price must fit the budget left, the
  // server's own check (spent + price > cap → over_budget). A cent of float slack, as there.
  if (buyReason === null && input.budgetLeft != null && priced && input.price! > input.budgetLeft + 1e-9) {
    buyReason = COPY.costsMoreThanBudget(input.symbol.toUpperCase());
    buyBlockedBy = 'budget';
  }

  // Sell: only a holding can be sold, and it needs the market and a price.
  let sellReason: string | null = null;
  let sellSummary: string | null = null;
  if (!held) {
    sellReason = COPY.notHeld;
  } else {
    sellReason = closedReason ?? priceReason;
    if (priced) {
      const qty = input.held!.quantity;
      sellSummary = COPY.sellAll(formatShares(qty), formatMoney(cents(qty * input.price!)));
    }
  }

  let ownershipLine: string;
  if (held) {
    ownershipLine = input.acquisition
      ?? (input.draft ? COPY.draftedByYou(input.draft.round, input.draft.inRoundPick) : COPY.heldByYou);
  } else if (otherOwned) {
    ownershipLine = COPY.ownedBy((other!.name ?? 'another manager'));
  } else {
    ownershipLine = COPY.noOneOwns(input.leagueName, input.symbol);
  }

  const marketNote = !input.gate.open && input.lastCloseLabel ? COPY.pricesShowClose(input.lastCloseLabel) : null;

  const todayChange =
    priced && input.prevClose !== null && input.prevClose > 0
      ? { perShare: input.price! - input.prevClose, pct: ((input.price! - input.prevClose) / input.prevClose) * 100 }
      : null;

  return {
    name: cleanCompanyName(input.companyName) || input.symbol,
    selected: held ? 'sell' : 'buy',
    buy: { enabled: buyReason === null, reason: buyReason, blockedBy: buyBlockedBy },
    sell: { enabled: held && sellReason === null, reason: sellReason, summary: sellSummary },
    ownershipLine,
    ownerBadge: other?.isBot ? 'Bot' : null,
    marketNote,
    todayChange,
  };
}

/** The sheet header's company line (W4 DL gate): the name, or nothing when all that's known is
 * the ticker itself — never "AMD" printed under "AMD". */
export function companyLine(name: string | null | undefined, symbol: string): string {
  return name && name.trim().toUpperCase() !== symbol.trim().toUpperCase() ? name : '';
}
