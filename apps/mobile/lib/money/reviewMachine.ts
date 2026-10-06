/**
 * reviewMachine: the state of one trade review (3e). The Review screen IS the
 * confirmation (Design Lead ruling, DESIGN_DIRECTION §9B @ b1992f4): there is
 * no native sheet on top. One primary button names the action and disables
 * while the submit is in flight.
 *
 *   ready        the button is live. Dismissing is allowed.
 *   submitting   the button disabled, showing progress. Dismissing is GUARDED
 *                (the one place a dismiss guard is justified: it protects data).
 *   done         the trade is recorded (a refusal can't come after this).
 *   refused      a game-flow refusal, mapped to copy. The button stays disabled.
 *   closed       the market closed, either refused by the server or observed on
 *                the client's clock. The numbers stay; the button is disabled.
 *   unavailable  the calendar couldn't be read (503). NOT a failed trade: the
 *                review stays open and can retry.
 *   unconfirmed  the network dropped during a submit. The trade may have been
 *                recorded. There is NO retry: a blind retry could double-buy.
 *                The copy sends the user to their trade history instead.
 */
import { marketOpensLabel } from './marketOpensLabel';
import type { RecordTradeOutcome } from './recordTradeOutcome';

export type ReviewState =
  | { kind: 'ready' }
  | { kind: 'submitting' }
  | { kind: 'done'; trade: unknown }
  | { kind: 'refused'; reason: string; backTo?: 'picker'; terminal?: boolean }
  | { kind: 'closed'; opensLabel: string | null }
  | { kind: 'unavailable' }
  | { kind: 'unconfirmed' };

export type ReviewEvent =
  | { type: 'SUBMIT' }
  | { type: 'OUTCOME'; outcome: RecordTradeOutcome }
  | { type: 'GATE_CLOSED'; opensLabel: string | null }
  | { type: 'RETRY' };

export const initialReview: ReviewState = { kind: 'ready' };

/** Dismissing the review is allowed except while a submit is in flight. */
export function canDismiss(state: ReviewState): boolean {
  return state.kind !== 'submitting';
}

/** The primary button is live only when the review is ready to submit. */
export function canSubmit(state: ReviewState): boolean {
  return state.kind === 'ready' || state.kind === 'unavailable';
}

export function reviewReducer(state: ReviewState, event: ReviewEvent): ReviewState {
  // A closed market swaps the button state instantly, from any non-final state.
  if (event.type === 'GATE_CLOSED') {
    if (state.kind === 'done') return state;
    return { kind: 'closed', opensLabel: event.opensLabel };
  }

  if (event.type === 'SUBMIT') {
    // Double-taps and submits on a closed or refused review are ignored.
    return canSubmit(state) ? { kind: 'submitting' } : state;
  }

  if (event.type === 'RETRY') {
    // Only a 503 can retry. An unconfirmed trade must never be resubmitted blind.
    return state.kind === 'unavailable' ? { kind: 'ready' } : state;
  }

  // OUTCOME: only meaningful while a submit is in flight.
  if (state.kind !== 'submitting') return state;
  const o = event.outcome;
  switch (o.kind) {
    case 'ok':
      return { kind: 'done', trade: o.trade };
    case 'unavailable':
      return { kind: 'unavailable' };
    case 'network':
      return { kind: 'unconfirmed' };
    case 'refused':
      if (o.reason === 'market_closed') {
        return { kind: 'closed', opensLabel: marketOpensLabel(o.nextOpenAt ?? null) };
      }
      return {
        kind: 'refused',
        reason: o.reason,
        ...(o.reason === 'proceeds_unavailable' ? { backTo: 'picker' as const } : {}),
        ...(o.reason === 'no_proceeds' ? { terminal: true } : {}),
      };
  }
}
