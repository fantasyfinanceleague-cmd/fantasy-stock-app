/**
 * reviewPresentation: what a trade review shows for each state (3e), as pure
 * data. The review IS the confirmation (Design Lead ruling (b)): one primary
 * button names the action, and it disables while the submit is in flight.
 *
 * Rulings encoded here:
 *  - Refusals and blockers (market_closed, no_proceeds, a refusal) keep the
 *    warn-tint card with NO icon. They're `messageTone: 'warn'`.
 *  - Only a retryable refusal (trade_conflict) and a 503 offer Try again.
 *  - An unconfirmed trade (a dropped network) offers NO retry: it may already
 *    have been recorded, so the copy sends the user to their history.
 *  - A closed market swaps the button state at once; the numbers stay.
 *  - Nothing here says "Confirm" or "OK": the button names the action.
 */
import { COPY } from './moneyCopy';
import { tierRefusalSentence, type CategoryResolver } from './tierContract';
import { refusalCopy } from './refusals';
import type { ReviewState } from './reviewMachine';

export interface ReviewPresentation {
  message: string | null;
  messageTone: 'text' | 'warn';
  button: { label: string; enabled: boolean; progress: boolean } | null;
  footer: 'try_again' | 'back_to_picker' | 'done' | null;
}

export function reviewPresentation(
  state: ReviewState,
  review: { buttonLabel: string; buttonRole?: 'sell' | 'buy' },
  ctx: { title: string; symbol: string; resolve?: CategoryResolver },
): ReviewPresentation {
  switch (state.kind) {
    case 'ready':
      return { message: null, messageTone: 'text', button: { label: review.buttonLabel, enabled: true, progress: false }, footer: null };
    case 'submitting':
      // The label names the work in flight: "Selling…" / "Buying…" (Design Lead copy), never the resting label.
      return { message: null, messageTone: 'text', button: { label: review.buttonRole === 'buy' ? COPY.buyingProgress : COPY.sellingProgress, enabled: false, progress: true }, footer: null };
    case 'refreshing':
      return { message: null, messageTone: 'text', button: { label: review.buttonLabel, enabled: false, progress: true }, footer: null };
    case 'done':
      return { message: ctx.title, messageTone: 'text', button: null, footer: 'done' };
    case 'refused': {
      // A tier refusal names the stock's price and the slot that would take it (the server's words).
      if (state.reason === 'no_eligible_slot' && state.tier?.price != null) {
        return {
          message: tierRefusalSentence(ctx.symbol, state.tier.price, state.tier.openSlots, ctx.resolve),
          messageTone: 'warn',
          button: null,
          footer: null,
        };
      }
      const copy = refusalCopy(state.reason, {});
      return {
        message: copy.message,
        messageTone: 'warn',
        button: null,
        footer: copy.retryable ? 'try_again' : copy.backTo === 'picker' ? 'back_to_picker' : null,
      };
    }
    case 'closed':
      return {
        message: state.opensLabel ? COPY.tradingOpens(state.opensLabel) : COPY.marketClosedNow,
        messageTone: 'warn',
        button: { label: review.buttonLabel, enabled: false, progress: false },
        footer: null,
      };
    case 'unavailable':
      return { message: COPY.tradingHoursUnavailable, messageTone: 'text', button: null, footer: 'try_again' };
    case 'unconfirmed':
      return { message: COPY.unconfirmed, messageTone: 'text', button: null, footer: null };
  }
}
