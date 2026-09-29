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
