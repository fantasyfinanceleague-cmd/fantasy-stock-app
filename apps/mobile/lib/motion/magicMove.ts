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
  | { type: 'RESET' };

/** idle -ROW_TAPPED-> flying -ARRIVED-> handed_off; RESET returns to idle
 * from any stage (the sheet closed, or a different row opened mid-flight). */
export function magicMoveReducer(stage: MagicMoveStage, event: MagicMoveEvent): MagicMoveStage {
  switch (event.type) {
    case 'ROW_TAPPED':
      return stage === 'idle' ? 'flying' : stage;
    case 'ARRIVED':
      return stage === 'flying' ? 'handed_off' : stage;
    case 'RESET':
      return 'idle';
  }
}
