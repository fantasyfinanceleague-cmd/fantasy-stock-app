/**
 * sheetRequests: which network reads a stock-sheet open needs, given what is
 * already in memory (3e). Pure, so the request budget is a tested rule, not a
 * hope. The Orchestrator's correction (2026-10-05): reuse the league ledger,
 * the cached quote and the cached name; fetch only what is genuinely missing.
 *
 *   held (in the ledger, quote warm)     → 0 requests
 *   held (quote cold)                    → 1 (the quote)
 *   free (nothing warm)                  → 2 (the quote and the company name)
 *   owned by another (quote cold)        → 1 (its name is in the ledger)
 *
 * The ledger itself is one request per league per session, shared with
 * Portfolio: it counts only when it is not yet loaded.
 */
export interface SheetRequestState {
  ledgerLoaded: boolean;
  quoteCached: boolean;
  /** A name is known: from the ledger's symbol_names, or the name cache. */
  nameKnown: boolean;
}

export interface SheetRequestPlan {
  ledger: boolean;
  quote: boolean;
  name: boolean;
  count: number;
}

export function planSheetRequests(s: SheetRequestState): SheetRequestPlan {
  const ledger = !s.ledgerLoaded;
  const quote = !s.quoteCached;
  const name = !s.nameKnown;
  return { ledger, quote, name, count: [ledger, quote, name].filter(Boolean).length };
}
