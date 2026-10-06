/**
 * refusals: maps every record-trade refusal reason to the polite, specific
 * copy the screens show (never a raw code). A refusal appears instantly and
 * never reads as success. `backTo: 'picker'` returns the user to "Which sale
 * pays?"; `terminal` ends the flow with no retry. Unknown reasons get one
 * generic line.
 */
import { COPY } from './moneyCopy';

export interface RefusalContext {
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
}

export function refusalCopy(reason: string, ctx: RefusalContext): RefusalCopy {
  switch (reason) {
    case 'proceeds_unavailable':
      return { message: COPY.proceedsUnavailable, backTo: 'picker' };
    case 'no_proceeds':
      return { message: COPY.noProceeds, terminal: true };
    case 'symbol_owned':
      return { message: ctx.ownerName ? COPY.ownedBy(ctx.ownerName) : COPY.ownedBy('another manager') };
    case 'not_owned':
      return { message: COPY.notHeld };
    case 'over_budget':
      return { message: COPY.overBudget };
    case 'no_eligible_slot':
      return { message: COPY.noEligibleSlot };
    case 'roster_full':
      return { message: COPY.rosterFull };
    case 'not_draftable':
      return { message: COPY.notDraftable };
    case 'no_price':
      return { message: COPY.noPrice };
    case 'rate_limited':
      return { message: COPY.rateLimited };
    case 'draft_not_completed':
      return { message: COPY.draftNotCompleted };
    case 'not_a_member':
      return { message: COPY.notAMember };
    case 'invalid_price':
      return { message: COPY.invalidPrice };
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
