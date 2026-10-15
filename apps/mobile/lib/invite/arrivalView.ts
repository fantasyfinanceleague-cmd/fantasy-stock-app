/**
 * What the signed-out invite arrival shows (onboarding W4; plan 2026-10-14 frame 1, Decision 7:
 * "{inviter} invited you to {league}", the inviter only). Pure (no React Native), so tests-deno
 * pins every state.
 *
 * BEFORE sign-in the only data is the league's name, its inviter and a refusal reason (the
 * no-session endpoint returns nothing else: the Planner's security condition). So there are no
 * counts, dates, stakes or rows here; those appear after sign-in, in the session preview inside
 * auto-join, which owns the definitive refusal ("N of N" and the rest, lib/join/joinPreview.ts).
 * The refusal lines below are the Planner's pre-sign-in wording, the same lines the web page uses.
 *
 * The preview never blocks and never errors: while it loads, or when it is not found or
 * unavailable, the screen is the generic "You're invited to a league" with the sign-in buttons,
 * and nothing is cleared.
 */
import { JOIN_COPY } from '../join/joinPreview';
import { COPY as MONEY_COPY } from '../money/moneyCopy';
import type { InviteReason, PendingInvite } from './usePendingInvite';

export const ARRIVAL_COPY = {
  generic: "You're invited to a league",
  signIn: 'Sign in',
  useEmail: 'Use email',
  tryAgain: MONEY_COPY.tryAgain,
  /** The three signed-out refusals, one place (Planner, 2026-10-14). A finished season reads like a started draft. */
  refusal: {
    league_full: (name: string) => `${name} is full. Ask whoever invited you if they can make room.`,
    draft_started: (name: string) => `${name} isn't taking new players right now.`,
    season_completed: (name: string) => `${name} isn't taking new players right now.`,
  } satisfies Record<InviteReason, (name: string) => string>,
} as const;

export interface ArrivalView {
  title: string;
  /** The league's name for its initial disc; null = the generic glyph (no name is known). */
  avatarName: string | null;
  /** The refusal (WarnPanel), or null. */
  refusal: string | null;
  /** The sign-in buttons show only when the league can take a new manager. */
  canJoin: boolean;
  /** Caption under the title when the preview was unavailable; null otherwise. */
  unreachable: string | null;
  /** "Try again" re-asks the preview (a user tap, never a loop). */
  retry: boolean;
}

export function arrivalTitle(name: string | null, inviter: string | null): string {
  if (!name) return ARRIVAL_COPY.generic;
  return inviter ? `${inviter} invited you to ${name}` : `You're invited to ${name}`;
}

export function arrivalView(invite: Pick<PendingInvite, 'preview'>): ArrivalView {
  const p = invite.preview;
  if (p.kind !== 'found') {
    const unavailable = p.kind === 'unavailable';
    return {
      title: ARRIVAL_COPY.generic,
      avatarName: null,
      refusal: null,
      canJoin: true,
      unreachable: unavailable ? JOIN_COPY.unreachable : null,
      retry: unavailable,
    };
  }
  return {
    title: arrivalTitle(p.name, p.inviter),
    avatarName: p.name,
    refusal: p.reason ? ARRIVAL_COPY.refusal[p.reason](p.name) : null,
    canJoin: p.reason === null,
    unreachable: null,
    retry: false,
  };
}
