// Stockpile — Button `status` (pure). Dependency-free, same reasoning as
// ./money.ts: testable in tests-deno without an RN renderer.
//
// Approved foundation addition (Design Lead via the Orchestrator, Phase
// 3b-1): idle → loading → done. The loading state announces "Loading" to
// VoiceOver and is busy + not pressable; done is shown briefly (`quick`) by
// the caller before its action proceeds.

export type ButtonStatus = 'idle' | 'loading' | 'done';

export interface ButtonStatusA11y {
  label: string;
  busy: boolean;
  /** Presses are ignored while loading or done, so a double tap can't submit twice. */
  pressable: boolean;
}

export function buttonStatusA11y(label: string, status: ButtonStatus, disabled: boolean): ButtonStatusA11y {
  switch (status) {
    case 'loading':
      return { label: 'Loading', busy: true, pressable: false };
    case 'done':
      return { label, busy: false, pressable: false };
    case 'idle':
    default:
      return { label, busy: false, pressable: !disabled };
  }
}

/** §9C (Design Lead, W4 gate, 2026-10-13): the PRIMARY button is a pill (radius 999, the
 * board's `.dr-btn`), still full width where a screen asks for it; the other variants keep
 * the 10pt control radius. Values from constants/tokens/radius.ts (`pill`, `md`). */
export const PILL_RADIUS = 999;
export const CONTROL_RADIUS = 10;
export function buttonRadius(variant: 'primary' | 'secondary' | 'ghost' | 'destructive'): number {
  return variant === 'primary' ? PILL_RADIUS : CONTROL_RADIUS;
}
