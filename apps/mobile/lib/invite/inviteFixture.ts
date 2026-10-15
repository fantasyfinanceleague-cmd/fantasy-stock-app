/**
 * Captures only (DEV): EXPO_PUBLIC_INVITE_FIXTURE opens the signed-out invite arrival in one
 * state, because W3's real hook is not on main yet and a simulator cannot open a universal link
 * unprompted. Pure; lib/shell/captureKnobs.ts parses the value, lib/invite/useArrivalInvite.ts
 * reads it under `__DEV__` only, so a release bundle never builds one.
 */
import type { InvitePreview, PendingInvite } from './usePendingInvite';

export type InviteFixtureKind = 'found' | 'solo' | 'full' | 'drafting' | 'over' | 'loading' | 'not_found' | 'unavailable';
export const INVITE_FIXTURES: readonly InviteFixtureKind[] = ['found', 'solo', 'full', 'drafting', 'over', 'loading', 'not_found', 'unavailable'];

const NAME = 'Stock Scudetto';

/** The fixture's Try again: a dev log line (the real hook re-asks preview-league, a user tap each time). */
function logRetry(): void {
  console.warn('[dev] invite fixture: retryPreview()');
}

export function inviteFixture(kind: InviteFixtureKind, retry: () => void = logRetry): PendingInvite {
  const preview: InvitePreview =
    kind === 'found' ? { kind: 'found', name: NAME, inviter: 'Roberto', reason: null }
    : kind === 'solo' ? { kind: 'found', name: NAME, inviter: null, reason: null }
    : kind === 'full' ? { kind: 'found', name: NAME, inviter: 'Roberto', reason: 'league_full' }
    : kind === 'drafting' ? { kind: 'found', name: NAME, inviter: 'Roberto', reason: 'draft_started' }
    : kind === 'over' ? { kind: 'found', name: NAME, inviter: 'Roberto', reason: 'season_completed' }
    : kind === 'loading' ? { kind: 'loading' }
    : kind === 'not_found' ? { kind: 'not_found' }
    : { kind: 'unavailable' };
  return { code: 'FXTR01', leagueName: NAME, preview, retryPreview: retry };
}
