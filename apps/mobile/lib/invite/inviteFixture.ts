/**
 * Captures only (DEV): EXPO_PUBLIC_INVITE_FIXTURE opens the signed-out invite arrival in one
 * state, because W3's real hook is not on main yet and a simulator cannot open a universal link
 * unprompted. Pure; lib/shell/captureKnobs.ts parses the value, lib/invite/useArrivalInvite.ts
 * reads it under `__DEV__` only, so a release bundle never builds one.
 */
import type { PreviewLeague } from '../join/joinPreview';
import type { InvitePreview, PendingInvite } from './usePendingInvite';

export type InviteFixtureKind = 'found' | 'solo' | 'full' | 'drafting' | 'over' | 'loading' | 'not_found' | 'unavailable';
export const INVITE_FIXTURES: readonly InviteFixtureKind[] = ['found', 'solo', 'full', 'drafting', 'over', 'loading', 'not_found', 'unavailable'];

const LEAGUE: PreviewLeague = {
  name: 'Stock Scudetto',
  members: 4,
  max: 6,
  stakeMode: 'equal',
  notionalPerSlot: 100,
  budgetAmount: null,
  leagueType: 'season',
  numWeeks: 10,
  durationDays: null,
  draftDate: '2026-10-17T23:00:00Z',
  draftStatus: 'not_started',
};

/** The fixture's Try again: a dev log line (the real hook re-asks preview-league, a user tap each time). */
function logRetry(): void {
  console.warn('[dev] invite fixture: retryPreview()');
}

export function inviteFixture(kind: InviteFixtureKind, retry: () => void = logRetry): PendingInvite {
  const preview: InvitePreview =
    kind === 'found' ? { kind: 'found', name: LEAGUE.name, inviter: 'Roberto', reason: null, league: LEAGUE }
    : kind === 'solo' ? { kind: 'found', name: LEAGUE.name, inviter: null, reason: null, league: LEAGUE }
    : kind === 'full' ? { kind: 'found', name: LEAGUE.name, inviter: 'Roberto', reason: 'league_full', league: { ...LEAGUE, members: 6 } }
    : kind === 'drafting' ? { kind: 'found', name: LEAGUE.name, inviter: 'Roberto', reason: 'draft_started', league: { ...LEAGUE, draftStatus: 'in_progress' } }
    : kind === 'over' ? { kind: 'found', name: LEAGUE.name, inviter: 'Roberto', reason: 'season_completed', league: { ...LEAGUE, draftStatus: 'completed' } }
    : kind === 'loading' ? { kind: 'loading' }
    : kind === 'not_found' ? { kind: 'not_found' }
    : { kind: 'unavailable' };
  return { code: 'FXTR01', leagueName: LEAGUE.name, preview, retryPreview: retry };
}
