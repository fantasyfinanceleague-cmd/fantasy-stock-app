/**
 * First-time tips (onboarding W4; plan 2026-10-14, Decisions row 13): the game's unfamiliar ideas
 * are taught IN PLACE, one line, once, never on a launch card. A tip shows until the person
 * dismisses it, then never again on this device. Pure (no storage), so tests-deno pins the rules;
 * lib/shell/firstTimeTip.ts holds the stored flags.
 */

/** The tips, by key: the words are Giorgio's, existing copy (PRODUCT_RULES "Generic scoring copy": "best performance wins"). */
export const TIPS = {
  /** The first pre-draft Home. */
  weekWindow: {
    key: 'sp.tip.week-window.v1',
    text: "Your week runs Monday's open to Friday's close. Best performance wins.",
  },
  /** The first draft room, lobby or live (the Planner, 2026-10-15). Dismissed by a tap or by the person's first pick. */
  outOfTime: {
    key: 'sp.tip.draft-room.v1',
    text: "Out of time? We pick for you: your queue first, then the best stock that fits your league's rules.",
  },
} as const;

export type TipId = keyof typeof TIPS;

/** What a read of the stored flag means. `undefined` = not read yet; `'error'` = the read failed. */
export type TipStored = string | null | undefined | 'error';

/**
 * Whether the tip shows. Not read yet: no (never flash a tip that is about to disappear). Dismissed
 * ('1'): no. A failed read: no (never nag because storage failed). Never seen (null): yes.
 */
export function tipVisible(stored: TipStored): boolean {
  return stored === null;
}

/** The draft-room tip goes away on the person's first pick (a recorded pick of theirs: their own or the auto-pick made for them). */
export function dismissesOnFirstPick(picksMade: number): boolean {
  return picksMade > 0;
}
