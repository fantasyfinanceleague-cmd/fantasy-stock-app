/**
 * magicMove: the pure math behind M1 (row -> sheet shared element). The
 * tapped row's ticker tile + name are measured (measureInWindow) at tap
 * time; a temporary absolutely-positioned copy travels from that rect to
 * the sheet header's rect while the real sheet rises underneath, then hands
 * off to the real header. Kept dependency-free (no react-native-reanimated,
 * no react-native-svg) so it's testable under Deno, same reasoning as
 * components/sp/logic/*.ts and lib/chart/chartGeometry.ts.
 *
 * `'worklet'` on interpolateRect: it also runs on the UI thread, called from
 * inside a Reanimated useAnimatedStyle callback during the tile's flight.
 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The rect at `t` (0..1, clamped) between `from` and `to` — plain linear
 * interpolation on all four fields. */
export function interpolateRect(from: Rect, to: Rect, t: number): Rect {
  'worklet';
  const clamped = Math.min(1, Math.max(0, t));
  return {
    x: from.x + (to.x - from.x) * clamped,
    y: from.y + (to.y - from.y) * clamped,
    width: from.width + (to.width - from.width) * clamped,
    height: from.height + (to.height - from.height) * clamped,
  };
}

/**
 * idle: no transition in flight, nothing renders.
 * flying: the temporary tile is traveling from the row's rect to the
 *   header's rect; the real header is still invisible or not yet measured.
 * handed_off: the tile's flight finished; the real header takes over and the
 *   temporary tile unmounts.
 */
export type MagicMoveStage = 'idle' | 'flying' | 'handed_off';

export type MagicMoveEvent =
  | { type: 'ROW_TAPPED' }
  | { type: 'ARRIVED' }
  /** The safety timeout fired (M1-a, DL robustness check): toRect never arrived,
   * or the flight animation never reported completion. Same destination as
   * ARRIVED -- the tile has waited long enough and hands off regardless. */
  | { type: 'TIMEOUT' }
  | { type: 'RESET' };

/** idle -ROW_TAPPED-> flying -(ARRIVED|TIMEOUT)-> handed_off; RESET returns to
 * idle from any stage (the sheet closed, or a different row opened mid-flight). */
export function magicMoveReducer(stage: MagicMoveStage, event: MagicMoveEvent): MagicMoveStage {
  switch (event.type) {
    case 'ROW_TAPPED':
      return stage === 'idle' ? 'flying' : stage;
    case 'ARRIVED':
    case 'TIMEOUT':
      return stage === 'flying' ? 'handed_off' : stage;
    case 'RESET':
      return 'idle';
  }
}

/**
 * startTransition: the measure-fails path (DL gate checklist), made explicit
 * and testable. A row's measureInWindow can fail to fire, or the ref can be
 * gone (unmounted mid-tap, a fast re-render) — either way the opener passes
 * null here rather than a rect, and the sheet must still open in place, with
 * no tile and no flight, never a delayed or hidden sheet. Reduce Motion (M1-b,
 * DL robustness check) is the same kind of decision: no tile is ever created,
 * since the sheet's own fade already covers the transition and a tile that
 * sits still at the row's rect until toRect arrives would flash and jump.
 * This is the single decision point: a null rect, or Reduce Motion, always
 * yields no transition.
 */
export function startTransition(
  symbol: string,
  name: string | null,
  originRect: Rect | null,
  reduced: boolean,
): { symbol: string; name: string | null; fromRect: Rect } | null {
  if (reduced || !originRect) return null;
  return { symbol, name, fromRect: originRect };
}

/** The safety timeout (M1-a): has `elapsedMs` since the tile mounted reached
 * `timeoutMs` (duration.slow — the "never block input longer than slow" rule)
 * without the flight reporting ARRIVED? If so, the caller hands off anyway. */
export function hasTimedOut(elapsedMs: number, timeoutMs: number): boolean {
  return elapsedMs >= timeoutMs;
}
