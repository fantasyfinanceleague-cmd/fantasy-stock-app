/**
 * refusals: maps every record-trade refusal reason to the polite, specific
 * copy the screens show (never a raw code). A refusal appears instantly and
 * never reads as success. `backTo: 'picker'` returns the user to "Which sale
 * pays?"; `terminal` ends the flow with no retry. Unknown reasons get one
 * generic line.
 */
import { COPY } from './moneyCopy';

export interface RefusalContext {
  /** The stock the player tried, named in the copy the audit table rules. */
  symbol?: string;
  ownerName?: string;
  /** Formatted "Mon 9:30 AM ET", when the server gave a next open. */
  opensLabel?: string | null;
}

export interface RefusalCopy {
  message: string;
  backTo?: 'picker';
  terminal?: boolean;
  /** The user may retry, after the review re-fetches fresh numbers. */
  retryable?: boolean;
  /** The next step, as a button: every refusal names one (Design Lead rule 8). */
  next?: 'pick_stock' | 'sell_first' | 'sign_in';
}

export function refusalCopy(reason: string, ctx: RefusalContext): RefusalCopy {
  const symbol = ctx.symbol;
  switch (reason) {
    case 'proceeds_unavailable':
      return { message: COPY.proceedsUnavailable, backTo: 'picker' };
    case 'no_proceeds':
      return { message: COPY.noProceeds, terminal: true };
    case 'symbol_owned':
      return { message: COPY.alreadyOwned(ctx.ownerName ?? 'Another manager', symbol ?? 'this stock'), next: 'pick_stock' };
    case 'not_owned':
      return { message: symbol ? COPY.notHeldSymbol(symbol) : COPY.notHeld };
    case 'over_budget':
      return { message: symbol ? COPY.costsMoreThanBudget(symbol) : COPY.overBudget, next: 'pick_stock' };
    case 'no_eligible_slot':
      return { message: COPY.noEligibleSlot, next: 'sell_first' };
    case 'roster_full':
      return { message: COPY.rosterFull, next: 'sell_first' };
    case 'not_draftable':
      return { message: symbol ? COPY.notDraftableSymbol(symbol) : COPY.notDraftable, next: 'pick_stock' };
    case 'no_price':
      return { message: symbol ? COPY.cantPriceSymbol(symbol) : COPY.noPrice, retryable: true };
    case 'rate_limited':
      // Waiting is the step (the table): no button.
      return { message: COPY.rateLimited };
    case 'league_not_found':
      return { message: COPY.leagueNotFound };
    case 'not_authenticated':
      return { message: COPY.sessionEnded, next: 'sign_in' };
    case 'draft_not_completed':
      return { message: COPY.draftNotCompleted };
    case 'not_a_member':
      return { message: COPY.notAMember };
    case 'invalid_price':
      return { message: symbol ? COPY.priceNotUsable(symbol) : COPY.invalidPrice, retryable: true };
    case 'market_closed':
      return { message: ctx.opensLabel ? COPY.tradingOpens(ctx.opensLabel) : COPY.marketClosedNow };
    case 'calendar_unavailable':
      return { message: COPY.tradingHoursUnavailable };
    case 'trade_conflict':
      return { message: COPY.tradeConflict, retryable: true };
    default:
      return { message: COPY.tradeDidNotGoThrough };
  }
}
