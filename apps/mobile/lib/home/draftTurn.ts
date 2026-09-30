/**
 * currentPickerFor: the snake-draft "whose turn" math (Phase 3b-2's
 * drafting card), mirroring app/(tabs)/draft.tsx's own inline derivation
 * so Home's card and the draft room can never disagree about whose turn
 * it is. Pure, so it's deno-testable.
 */

export interface DraftTurn {
  round: number;
  pickInRound: number; // 0-based
  pickerId: string | null; // null past the end of the order (shouldn't happen mid-draft)
  overallPick: number; // 1-based
}

/**
 * `order`: draft positions 1..N, in order. `picksMade`: drafts rows so
 * far (this league's picks table count). `numRounds`: the league's round
 * count. Odd rounds go forward through `order`; even rounds reverse it
 * (the standard snake pattern draft.tsx already implements).
 */
export function currentPickerFor(order: string[], picksMade: number, numRounds: number): DraftTurn {
  const teams = order.length;
  const overallPick = picksMade + 1;
  if (teams === 0) return { round: 1, pickInRound: 0, pickerId: null, overallPick };
  const round = Math.ceil(overallPick / teams) || 1;
  const pickInRound = (overallPick - 1) % teams;
  const isReverseRound = round % 2 === 0;
  const orderForRound = isReverseRound ? [...order].reverse() : order;
  const pickerId = orderForRound[pickInRound] ?? null;
  return { round, pickInRound, pickerId, overallPick };
}

/** How many picks until `userId` is on the clock again (0 if it's their
 * turn right now) — the drafting card's "you're up in K picks" line. */
export function picksUntilTurn(order: string[], picksMade: number, numRounds: number, userId: string): number {
  const teams = order.length;
  if (teams === 0) return -1;
  const totalPicks = teams * numRounds;
  for (let overall = picksMade + 1; overall <= totalPicks; overall++) {
    const turn = currentPickerFor(order, overall - 1, numRounds);
    if (turn.pickerId === userId) return overall - (picksMade + 1);
  }
  return -1; // the user has no remaining pick (shouldn't happen for a real roster member)
}
