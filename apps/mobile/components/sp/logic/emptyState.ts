// Stockpile — EmptyState's layout rule (pure). Dependency-free, same
// reasoning as ./money.ts, so tests-deno can pin it.
//
// Design Lead ruling (Phase 3b-1): an EmptyState WITH actions is carded (the
// board's `Empty`: a card, padding 28/20, full-width actions inside it); an
// informational one with NO actions stays flat on the screen background
// (e.g. the tabs' "on the way" placeholders).

export function isEmptyStateCarded(actionLabel: string | undefined, hasAction: boolean): boolean {
  return !!actionLabel && hasAction;
}

/** The message's Dynamic Type ceiling: never larger than its own title at the title's cap
 * (gn-sweep, XXXL: the 15pt body grew to ~47pt under a title capped at 35pt). */
export function messageMaxScale(titlePt: number, titleMaxScale: number, bodyPt: number): number {
  return Math.floor(((titlePt * titleMaxScale) / bodyPt) * 100) / 100;
}
