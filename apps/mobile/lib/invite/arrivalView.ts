/**
 * What the signed-out invite arrival shows (onboarding W4; plan 2026-10-14 frame 1, Decision 7:
 * "{inviter} invited you to {league}", the inviter only). Pure (no React Native), so tests-deno
 * pins every state. Every string is shipped copy (the plan's title lines, Join's refusal and
 * unreachable lines, Try again); the one generic line is the Orchestrator's own wording.
 *
 * The preview never blocks and never errors: while it loads, or when it is not found or
 * unavailable, the screen is the generic "You're invited to a league" with the sign-in buttons,
 * and nothing is cleared (the definitive refusal belongs to the auto-join, at 'ready').
 */
import { JOIN_COPY, blockMessage, previewView, refineBlock, type JoinBlock, type PreviewRow } from '../join/joinPreview';
import { COPY as MONEY_COPY } from '../money/moneyCopy';
import type { PendingInvite } from './usePendingInvite';

export const ARRIVAL_COPY = {
  generic: "You're invited to a league",
  signIn: 'Sign in',
  useEmail: 'Use email',
  tryAgain: MONEY_COPY.tryAgain,
} as const;

export interface ArrivalView {
  title: string;
  /** The league's name for its initial disc; null = the generic glyph (no name is known). */
  avatarName: string | null;
  rows: PreviewRow[];
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
      rows: [],
      refusal: null,
      canJoin: true,
      unreachable: unavailable ? JOIN_COPY.unreachable : null,
      retry: unavailable,
    };
  }
  const block: JoinBlock | null = p.reason ? refineBlock(p.reason, p.league?.draftStatus) : null;
  // A full league's line needs the manager cap, which only the league facts carry; without them the
  // shipped "can't join right now" line stands in (never a guessed count).
  const refusal = block === null ? null : block === 'league_full' && !p.league ? JOIN_COPY.unknownBlock : blockMessage(block, p.league ?? { name: p.name, max: 0 });
  return {
    title: arrivalTitle(p.name, p.inviter),
    avatarName: p.name,
    rows: p.league ? previewView(p.league, block).rows : [],
    refusal,
    canJoin: block === null,
    unreachable: null,
    retry: false,
  };
}
