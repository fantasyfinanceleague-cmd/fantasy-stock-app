// Onboarding W3 — what happens to a pending invite once the person is `ready`: the decisions, pure.
//
// The screen (app/join-league.tsx, invite mode) asks the same two server functions the manual flow does
// (preview-league, then join-league), and every answer maps here to ONE of: join now, open the league, show
// "You're in", show a refusal, or show a transport error, plus what to do with the STORED invite. The server's
// join-league is the only truth (a league can start or fill between the tap and the join); this table only
// reads its answer. Copy is never made here: the refusal wording is lib/join/joinPreview.ts's.
//
// The invite's fate follows one rule (the partial-state rule in CLAUDE.md, applied to this flow):
//   - a DEFINITIVE answer (joined, already a member, any refusal, a bad code) -> `clear`, and the person is
//     SHOWN why, never silently dropped;
//   - a TRANSPORT failure (network, 429, 5xx) -> `keep`: the invite waits for the person's tap, and a relaunch
//     tries once more. Nothing here retries by itself, so nothing can loop.
//
// Pure (no React Native imports) so tests-deno can exercise it hermetically.

import type { FindOutcome, JoinBlock, JoinErrorKind, JoinOutcome, PreviewLeague } from '../join/joinPreview';

/** What to do with the stored invite after this step. */
export type InviteFate = 'clear' | 'keep';

export type AfterPreview =
  /** The league is open to this person: record `triedJoin`, then join. */
  | { kind: 'join'; fate: 'keep'; league: PreviewLeague }
  /** They are already a member and never tried: just open the league (a repeat tap of a link they used). */
  | { kind: 'open'; fate: 'clear'; league: PreviewLeague }
  /** They are a member AND we tried to join: the earlier join landed, its answer was lost. Say so. */
  | { kind: 'joined_earlier'; fate: 'clear'; league: PreviewLeague }
  /** The league refuses (full, started, over, expired ...): the preview card with the existing refusal copy. */
  | { kind: 'refused'; fate: 'clear'; league: PreviewLeague; block: JoinBlock }
  /** No league has this code. */
  | { kind: 'bad_code'; fate: 'clear' }
  /** The lookup failed on the wire. The invite stays. */
  | { kind: 'error'; fate: 'keep'; error: JoinErrorKind };

export function decideAfterPreview(outcome: FindOutcome, triedJoin: boolean): AfterPreview {
  if (outcome.kind === 'bad_code') return { kind: 'bad_code', fate: 'clear' };
  if (outcome.kind === 'error') return { kind: 'error', fate: 'keep', error: outcome.error };
  if (outcome.block === null) return { kind: 'join', fate: 'keep', league: outcome.league };
  if (outcome.block === 'already_member') {
    return triedJoin
      ? { kind: 'joined_earlier', fate: 'clear', league: outcome.league }
      : { kind: 'open', fate: 'clear', league: outcome.league };
  }
  return { kind: 'refused', fate: 'clear', league: outcome.league, block: outcome.block };
}

export type AfterJoin =
  | { kind: 'joined'; fate: 'clear'; leagueId: string; leagueName: string }
  /**
   * join-league said `already_member` right after a preview that said joinable: our own join (an earlier
   * attempt whose answer was lost, or a double delivery) got there first. The person is in; `leagueId` opens it.
   */
  | { kind: 'joined_already'; fate: 'clear'; leagueId: string }
  /** The league changed since the preview (it filled, the room opened): the refusal, shown on the preview. */
  | { kind: 'refused'; fate: 'clear'; block: JoinBlock }
  /** The join failed on the wire. The invite stays, `triedJoin` stays set, and the person taps again. */
  | { kind: 'error'; fate: 'keep'; error: JoinErrorKind };

export function decideAfterJoin(outcome: JoinOutcome): AfterJoin {
  if (outcome.kind === 'error') return { kind: 'error', fate: 'keep', error: outcome.error };
  if (outcome.kind === 'joined') {
    return { kind: 'joined', fate: 'clear', leagueId: outcome.leagueId, leagueName: outcome.leagueName };
  }
  if (outcome.block === 'already_member' && outcome.leagueId) {
    return { kind: 'joined_already', fate: 'clear', leagueId: outcome.leagueId };
  }
  // already_member WITHOUT a league id cannot be opened: a refusal like any other (unknown reads as the generic copy).
  return { kind: 'refused', fate: 'clear', block: outcome.block === 'already_member' ? 'unknown' : outcome.block };
}

/**
 * Whether the root layout should open the join screen for the pending invite now. Once per code per launch
 * (`autoOpenedCode`), only when the person is in the full app (`ready`: signed in AND has a username), and
 * never while a password-recovery form or its exchange holds the navigator.
 */
export function shouldAutoOpenInvite(input: {
  phase: 'unknown' | 'signedOut' | 'gated' | 'ready';
  code: string | null;
  autoOpenedCode: string | null;
  recoveryHold: boolean;
  /** inviteOwnerAction(): the join opens only once the invite is settled for THIS person ('none'), never in the same commit that claims or clears it. */
  ownerAction: 'claim' | 'clear' | 'none';
  /** Whether the arrival is settled (signedInAtArrival known): the route (auto or tap) is decided from it. */
  arrivalSettled: boolean;
}): boolean {
  return (
    input.phase === 'ready' && !!input.code && input.autoOpenedCode !== input.code && !input.recoveryHold &&
    input.ownerAction === 'none' && input.arrivalSettled
  );
}

/** The route the layout opens. The code is NOT in it: the screen reads the stored invite. */
export const INVITE_JOIN_ROUTE = '/join-league?invite=1';

/** The same screen in TAP mode: the existing "Join {league}" preview, which waits for the person's tap (decision 18). */
export const INVITE_TAP_ROUTE = '/join-league?invite=tap';

/** Whether a person with this auth phase had a session when a link arrived. 'unknown' (a cold start, auth not resolved yet) is null: settled later, at the first resolved phase. */
export function signedInAtArrivalFrom(phase: 'unknown' | 'signedOut' | 'gated' | 'ready'): boolean | null {
  if (phase === 'unknown') return null;
  return phase !== 'signedOut';
}

/**
 * Whether the invite joins on its own or waits for the person's tap (Planner, decision 18). Only the SHARED https link
 * auto-joins (Decision 8's zero-tap join). A custom-scheme link (fantasystockapp://join/<CODE>) that arrived while the
 * person was SIGNED IN waits: other apps and redirects can fire a scheme link silently, and a silent join is a visible
 * social action. A signed-out arrival behaves the same either way (capture, then sign in, then join). Decided from facts
 * recorded when the link arrived, never inferred later; an arrival not yet settled counts as needing the tap.
 */
export function inviteNeedsTap(invite: { origin: 'https' | 'scheme'; signedInAtArrival: boolean | null }): boolean {
  if (invite.origin === 'https') return false;
  return invite.signedInAtArrival !== false;
}

export function inviteJoinRoute(invite: { origin: 'https' | 'scheme'; signedInAtArrival: boolean | null }): string {
  return inviteNeedsTap(invite) ? INVITE_TAP_ROUTE : INVITE_JOIN_ROUTE;
}

export type InviteScreenMode = 'none' | 'auto' | 'tap';

/**
 * Which mode the join screen runs in. The router PARAM only says "this is the invite screen"; it is never trusted for
 * the mode, because join-league is an ordinary deep-linkable route: a second link `fantasystockapp://join-league?invite=1`
 * would otherwise force zero-tap mode on a pending scheme invite and defeat decision 18. The mode comes from the facts
 * stored with the invite (inviteNeedsTap), and AUTO additionally requires that the layout opened the screen for this
 * code (`autoOpenedCode`, set only by the layout's own auto-open, in memory). Anything doubtful is the tap mode, which
 * joins nothing by itself.
 */
export function inviteScreenMode(
  param: string | undefined,
  invite: { code: string | null; origin: 'https' | 'scheme'; signedInAtArrival: boolean | null; autoOpenedCode: string | null }
): InviteScreenMode {
  if ((param !== '1' && param !== 'tap') || !invite.code) return 'none';
  if (inviteNeedsTap(invite)) return 'tap';
  return invite.autoOpenedCode === invite.code ? 'auto' : 'tap';
}

/**
 * An EXTERNAL link to the join screen must not carry the invite-mode param (defence in depth beside inviteScreenMode):
 * `fantasystockapp://join-league?invite=1` becomes `fantasystockapp://join-league`, the plain code-entry screen. Only the
 * `invite` key is removed (decoded, so an escaped spelling goes too); other links are returned untouched.
 */
export function stripInviteParam(path: string): string {
  const q = path.indexOf('?');
  if (q < 0) return path;
  const head = path.slice(0, q);
  if (!/(^|\/)join-league\/?$/i.test(head)) return path;
  const hashAt = path.indexOf('#', q);
  const query = path.slice(q + 1, hashAt < 0 ? undefined : hashAt);
  const rest = hashAt < 0 ? '' : path.slice(hashAt);
  const params = new URLSearchParams(query);
  if (!params.has('invite')) return path;
  params.delete('invite');
  const out = params.toString();
  return head + (out ? `?${out}` : '') + rest;
}

/**
 * Whether dismissing the join screen clears the pending invite. Only while that invite is still the one this
 * screen was opened for, and NOT once a join was attempted: the answer may have been lost, and the join may have
 * landed, so the invite stays and the next launch resolves it (already_member after `triedJoin` reads "You're in").
 */
export function shouldClearOnDismiss(current: { code: string | null; triedJoin: boolean }, mountedCode: string | null): boolean {
  return mountedCode !== null && current.code === mountedCode && !current.triedJoin;
}

/**
 * Whether an auth change must drop the pending invite: the signed-in person CHANGED or SIGNED OUT, from any phase
 * (the username gate included), so person B on the same phone never auto-joins person A's pending league. A first
 * sign-in (nobody before) keeps it: that is the invited friend arriving.
 */
export function shouldClearInviteOnAuthChange(previousUserId: string | null, nextUserId: string | null): boolean {
  return previousUserId !== null && nextUserId !== previousUserId;
}

/**
 * What a join screen does when its run turned out stale (a newer link replaced the invite, or the person walked
 * away): never sit on a dead spinner, and never touch navigation from a screen that is gone or buried.
 *   - not mounted any more         -> 'stay' (do nothing: the person already left; router.back() would pop whatever
 *                                      screen they are on NOW)
 *   - no spinner up                -> 'stay' (the person is reading something)
 *   - spinner up, screen in front  -> 'leave' (pop itself)
 *   - spinner up, another screen on top (the newer invite's own join screen) -> 'leave_on_focus': leave the moment
 *                                      this screen is uncovered, instead of popping the screen on top
 */
export function staleRunExit(input: { mounted: boolean; spinnerShowing: boolean; focused: boolean }): 'leave' | 'leave_on_focus' | 'stay' {
  if (!input.mounted || !input.spinnerShowing) return 'stay';
  return input.focused ? 'leave' : 'leave_on_focus';
}

/**
 * Whose invite is this? An invite is stamped with the person it is for the first time somebody is signed in with it
 * pending (`ownerUserId`, persisted). 'claim' = nobody owns it yet (it was tapped while signed out: the invited friend
 * arriving); 'clear' = a DIFFERENT person is signed in than the one it was stamped for, so it is dropped, even across
 * a cold start where the earlier sign-out was never observed (a session that ended while the app was closed); 'none'
 * = nothing to do (nobody signed in yet, or the owner is the person signed in).
 */
export function inviteOwnerAction(ownerUserId: string | null, signedInUserId: string | null): 'claim' | 'clear' | 'none' {
  if (signedInUserId === null) return 'none';
  if (ownerUserId === null) return 'claim';
  return ownerUserId === signedInUserId ? 'none' : 'clear';
}
