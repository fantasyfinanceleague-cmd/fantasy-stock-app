/**
 * What the signed-out invite arrival shows (onboarding W4; plan 2026-10-14 frame 1, Decision 7;
 * Giorgio's B ruling, 2026-10-14). Pure (no React Native), so tests-deno pins every state.
 *
 * BEFORE sign-in the only data is the league's name, its inviter and a refusal reason (the
 * no-session endpoint returns nothing else: the Planner's security condition). So there are no
 * counts, dates, stakes or rows here; those appear after sign-in (the "You're in" card, and the
 * session preview inside auto-join, which owns the definitive refusal).
 *
 *   inviter + name  → "{inviter} invited you to {league}" over the inviter's initials
 *   name only       → "You're invited to {league}" over the league icon
 *   nothing usable  → "You're invited to a league" over the league icon (loading, unavailable)
 *   a dead link     → NO heading: the refusal alone, then "Sign in" (Planner)
 *
 * The preview never blocks and never errors: loading and unavailable are the generic heading with
 * every sign-in option, and nothing is cleared.
 */
import { keepHyphens } from '../game/keepDots';
import { JOIN_COPY } from '../join/joinPreview';
import { COPY as MONEY_COPY } from '../money/moneyCopy';
import { INVITE_COPY } from './inviteCopy';
import type { PendingInvite } from './usePendingInvite';

export const ARRIVAL_COPY = {
  generic: "You're invited to a league",
  signIn: 'Sign in',
  useEmail: 'Use email',
  tryAgain: MONEY_COPY.tryAgain,
} as const;

/** What sits above the heading: the inviter's initials, the league icon, or nothing (a dead link). */
export type ArrivalMark = { kind: 'inviter'; name: string } | { kind: 'league' } | { kind: 'none' };

export interface ArrivalView {
  /** null = no heading at all (a dead link). */
  title: string | null;
  mark: ArrivalMark;
  /** The refusal (WarnPanel), or null. */
  refusal: string | null;
  /** The sign-in buttons show only when the link can still be used. */
  canJoin: boolean;
  /** Caption under the title when the preview was unavailable; null otherwise. */
  unreachable: string | null;
  /** "Try again" re-asks the preview (a user tap, never a loop). */
  retry: boolean;
}

/** The league's name never breaks across lines: spaces are non-breaking, hyphens carry a word joiner. */
export function keepName(name: string): string {
  return keepHyphens(name.replace(/ /g, ' '));
}

export function arrivalTitle(name: string | null, inviter: string | null): string {
  if (!name) return ARRIVAL_COPY.generic;
  return inviter ? `${inviter} invited you to ${keepName(name)}` : `You're invited to ${keepName(name)}`;
}

/** The refusal line for a reason (the contract's three, and invite_expired / anything unknown = a dead link). */
export function refusalLine(reason: string, name: string): string {
  switch (reason) {
    case 'league_full':
      return INVITE_COPY.full(name);
    case 'draft_started':
    case 'season_completed':
      return INVITE_COPY.closed(name);
    default:
      return INVITE_COPY.dead;
  }
}

export function arrivalView(invite: Pick<PendingInvite, 'preview'>): ArrivalView {
  const p = invite.preview;
  if (p.kind === 'not_found') {
    // A dead link: the refusal alone (no heading), then Sign in.
    return { title: null, mark: { kind: 'none' }, refusal: INVITE_COPY.dead, canJoin: false, unreachable: null, retry: false };
  }
  if (p.kind !== 'found') {
    const unavailable = p.kind === 'unavailable';
    return {
      title: ARRIVAL_COPY.generic,
      mark: { kind: 'league' },
      refusal: null,
      canJoin: true,
      unreachable: unavailable ? JOIN_COPY.unreachable : null,
      retry: unavailable,
    };
  }
  return {
    title: arrivalTitle(p.name, p.inviter),
    mark: p.inviter ? { kind: 'inviter', name: p.inviter } : { kind: 'league' },
    refusal: p.reason ? refusalLine(p.reason, p.name) : null,
    canJoin: p.reason === null,
    unreachable: null,
    retry: false,
  };
}
