// Stockpile — when <LiveDot> pulses (DESIGN_DIRECTION §9B, "LiveDot"): the only
// loop, and it pauses when its screen loses focus or the app leaves the
// foreground, resuming on focus or return. Reduce Motion: a static dot. Pure,
// so the rule is tested without RN.

export interface LivePulseInput {
  reduced: boolean;
  /** The screen that shows the dot is focused (navigation). */
  focused: boolean;
  /** AppState is 'active'. */
  appActive: boolean;
}

export function livePulseRunning(input: LivePulseInput): boolean {
  return !input.reduced && input.focused && input.appActive;
}
