// Onboarding W3 — the invite flow of app/join-league.tsx (invite mode), as one pure, dependency-injected
// sequence: preview -> (markTried BEFORE the join) -> join -> the invite's fate. The screen only draws the
// result, so every partial-state path is testable end to end without React Native (tests-deno).
//
// lib/invite/autoJoin.ts holds the per-answer decisions and their reasoning; this module strings them together
// and applies the fate: a definitive answer CLEARS the stored invite and hands the screen the reason to show,
// a transport failure KEEPS it and hands back the error. Nothing here loops or retries.

import { interpretJoin, interpretPreview, refineBlock, type JoinBlock, type JoinErrorKind, type PreviewLeague } from '../join/joinPreview';
import { decideAfterJoin, decideAfterPreview } from './autoJoin';

export interface InviteJoinDeps {
  /** The two server calls, as the screen makes them (an invoke result; a throw is a transport failure). */
  preview(code: string): Promise<{ data: unknown; error: unknown }>;
  join(code: string): Promise<{ data: unknown; error: unknown }>;
  /** Whether `triedJoin` was already set when this run began (a previous attempt's answer may have been lost). */
  triedJoin(): boolean;
  /**
   * Persist `triedJoin`; resolved BEFORE the join call is made. Its result is deliberately NOT a gate: if the write
   * failed (false) the join is still the right thing to do. The cost is only that a lost answer is then not
   * recognisable after a relaunch, which opens the league silently (the `open` path) instead of saying "You're in".
   */
  markTried(): Promise<unknown>;
  /** Drop the stored invite. */
  clear(): Promise<void>;
  /** False once the person has walked away from this run: its answer is then ignored. */
  isCurrent(): boolean;
}

export type InviteJoinResult =
  /** No league has the code. Invite cleared. Show the "no league has that code" line. */
  | { kind: 'bad_code' }
  /** The lookup failed on the wire. Invite KEPT. Show the error under the field; Find league is the retry tap. */
  | { kind: 'lookup_error'; error: JoinErrorKind }
  /** A refusal: show the preview card with this block's existing copy. Invite cleared. */
  | { kind: 'refused'; league: PreviewLeague; block: JoinBlock }
  /** The join failed on the wire. Invite KEPT, `triedJoin` stays set. Show the preview with the error; Join is the retry tap. */
  | { kind: 'join_error'; league: PreviewLeague; error: JoinErrorKind }
  /** In. `leagueId` is the league to make active. Invite cleared. Show "You're in {leagueName}". */
  | { kind: 'joined'; league: PreviewLeague; leagueId: string; leagueName: string }
  /** Already a member (never tried): open the league without ceremony. Invite cleared. */
  | { kind: 'opened'; leagueId: string };

async function call(f: () => Promise<{ data: unknown; error: unknown }>): Promise<{ data: unknown; error: unknown }> {
  try {
    return await f();
  } catch {
    return { data: null, error: new Error('network') };
  }
}

/**
 * TAP MODE (decision 18): a scheme link that arrived while the person was signed in. Look the league up and SHOW it;
 * never join, never mark `triedJoin`, never touch the active league. The preview's own button joins (or opens) on the
 * person's tap, through the same screen and the same copy as typing a code. The invite stays until that tap or a
 * dismissal, except on a definitive answer that has nothing to wait for (no such league, or a refusal), which clears
 * it and shows why, exactly as the automatic run does.
 */
export type InviteTapResult =
  | { kind: 'bad_code' }
  | { kind: 'lookup_error'; error: JoinErrorKind }
  /** The preview to draw: `block` null = joinable (the Join button), 'already_member' = the Open button, anything else = a refusal. */
  | { kind: 'preview'; league: PreviewLeague; block: JoinBlock | null };

export async function runInvitePreviewOnly(deps: InviteJoinDeps, code: string): Promise<InviteTapResult | null> {
  const { data, error } = await call(() => deps.preview(code));
  if (!deps.isCurrent()) return null;
  const next = decideAfterPreview(interpretPreview(data, error), deps.triedJoin());
  if (next.kind === 'bad_code') {
    await deps.clear();
    return { kind: 'bad_code' };
  }
  if (next.kind === 'error') return { kind: 'lookup_error', error: next.error };
  if (next.kind === 'refused') {
    await deps.clear();
    return { kind: 'preview', league: next.league, block: next.block };
  }
  // joinable -> the Join button; already a member -> the Open button; both wait for the person
  return { kind: 'preview', league: next.league, block: next.kind === 'join' ? null : 'already_member' };
}

/** The join half, shared by the automatic run and the person's tap on the preview's Join button. Null when stale. */
export async function completeInviteJoin(
  deps: InviteJoinDeps,
  code: string,
  league: PreviewLeague,
  mode: 'join' | 'open' | 'earlier'
): Promise<InviteJoinResult | null> {
  const { data, error } = await call(() => deps.join(code));
  if (!deps.isCurrent()) return null;
  const next = decideAfterJoin(interpretJoin(data, error));
  if (next.kind === 'error') return { kind: 'join_error', league, error: next.error };
  if (next.kind === 'refused') {
    await deps.clear();
    const block = refineBlock(next.block, league.draftStatus);
    return { kind: 'refused', league: block === 'draft_in_progress' ? { ...league, draftStatus: 'in_progress' } : league, block };
  }
  await deps.clear();
  if (mode === 'open' && next.kind === 'joined_already') return { kind: 'opened', leagueId: next.leagueId };
  return {
    kind: 'joined',
    league,
    leagueId: next.leagueId,
    leagueName: next.kind === 'joined' ? next.leagueName : league.name,
  };
}

/** The whole automatic run for the stored invite's code. Null when stale. */
export async function runInviteJoin(deps: InviteJoinDeps, code: string): Promise<InviteJoinResult | null> {
  const { data, error } = await call(() => deps.preview(code));
  if (!deps.isCurrent()) return null;
  const next = decideAfterPreview(interpretPreview(data, error), deps.triedJoin());
  if (next.kind === 'bad_code') {
    await deps.clear();
    return { kind: 'bad_code' };
  }
  if (next.kind === 'error') return { kind: 'lookup_error', error: next.error };
  if (next.kind === 'refused') {
    await deps.clear();
    return { kind: 'refused', league: next.league, block: next.block };
  }
  if (next.kind === 'join') await deps.markTried(); // BEFORE the call: a lost answer must still be recognisable
  return completeInviteJoin(deps, code, next.league, next.kind === 'join' ? 'join' : next.kind === 'open' ? 'open' : 'earlier');
}

/**
 * The league to make ACTIVE right now, after the automatic path. Only `opened` (someone who is already a member
 * tapped their own league's link: the app opens that league). A forced join (`joined`) must NOT also take over the
 * active league: Decision 8's zero-tap join stays, but switching what the person is looking at is theirs to do.
 */
export function activeLeagueNow(result: InviteJoinResult): string | null {
  return result.kind === 'opened' ? result.leagueId : null;
}

/** The league the Joined screen's "Go to the league" tap makes active (the person's own tap). */
export function activeLeagueOnContinue(result: InviteJoinResult): string | null {
  return result.kind === 'joined' ? result.leagueId : null;
}
