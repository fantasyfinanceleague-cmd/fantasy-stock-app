/**
 * useTradeSubmit: drives one trade review through reviewReducer (3e). It sends
 * the request body it was given and maps the outcome onto the review's state.
 * A retryable refusal is retried only after the caller has re-fetched fresh
 * numbers (Try again never resubmits the old quote). A double submit is ignored.
 */
import { useCallback, useReducer, useRef } from 'react';

import { callRecordTrade, type TradeBody } from './recordTrade';
import { initialReview, reviewReducer, type ReviewState } from './reviewMachine';
import type { RecordTradeOutcome } from './recordTradeOutcome';

export interface TradeSubmit {
  state: ReviewState;
  submit: (body: TradeBody) => Promise<RecordTradeOutcome | null>;
  /** Try again after a retryable refusal: re-fetch first, then call refreshed(). */
  retry: () => void;
  refreshed: () => void;
  gateClosed: (opensLabel: string | null) => void;
  /** A new review opened: clear any earlier refusal or outcome so the new review starts ready. */
  reset: () => void;
}

export function useTradeSubmit(): TradeSubmit {
  const [state, dispatch] = useReducer(reviewReducer, initialReview);
  // A ref guards the double tap before the reducer's state has re-rendered.
  const inFlight = useRef(false);

  const submit = useCallback(async (body: TradeBody) => {
    if (inFlight.current) return null;
    inFlight.current = true;
    dispatch({ type: 'SUBMIT' });
    try {
      const outcome = await callRecordTrade(body);
      dispatch({ type: 'OUTCOME', outcome });
      return outcome;
    } finally {
      inFlight.current = false;
    }
  }, []);

  const retry = useCallback(() => dispatch({ type: 'RETRY' }), []);
  const refreshed = useCallback(() => dispatch({ type: 'REFRESHED' }), []);
  const gateClosed = useCallback((opensLabel: string | null) => dispatch({ type: 'GATE_CLOSED', opensLabel }), []);
  const reset = useCallback(() => dispatch({ type: 'RESET' }), []);

  return { state, submit, retry, refreshed, gateClosed, reset };
}
