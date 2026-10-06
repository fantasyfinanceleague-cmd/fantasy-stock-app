/**
 * THE one price rounding rule for draft tiers (draft-never-skips, 2026-10-05).
 *
 * A tier is judged on the price in CENTS, rounded half away from zero: the
 * pick-time gate (live price, validatePick -> slotAccepts) and the feasibility
 * model (cached symbols.last_price, SQL draft_feasibility_pool, setup/start).
 * The auto_pick_search_candidates SQL still compares the RAW cached price; its
 * bracket is a superset of the robust one, so it can only over-offer candidates
 * (the gate decides), never hide a legal stock.
 *
 * The decimal-string shift ("49.995e2") is deliberate: Math.round(49.995 * 100)
 * is 4999 in IEEE doubles (49.995 is stored as 49.99499999...), but the decimal
 * literal 49.995e2 parses to exactly 4999.5, so the result matches Postgres
 * round(numeric, 2). Entry prices are NOT rounded — the stored fill stays raw;
 * only the tier judgement uses this.
 *
 * Pure, no imports: shared by draft-validation.ts and draft-feasibility.ts so
 * neither can depend on the other for it.
 */
export function tierPrice(x: number): number {
  const n = Number(x);
  if (!Number.isFinite(n)) return n;
  const sign = n < 0 ? -1 : 1;
  const shifted = Math.round(Number(`${Math.abs(n)}e2`));
  return sign * Number(`${shifted}e-2`);
}
