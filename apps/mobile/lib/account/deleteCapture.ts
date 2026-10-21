// Account deletion (W4) — DEV capture seeds for the Design Lead's gate (EXPO_PUBLIC_DELETE_FIXTURE, read only under
// __DEV__ via lib/shell/captureDev.ts). Pure. A knob RAISES the real screen's real state once and never fakes the
// render: the league lines come from the real leagueLine() over fixture leagues, and the state is a state the real
// reducer can reach. It never sends anything (a seeded 'sending' has no request behind it).

import { initialDeleteState, type DeleteState } from './deleteFlow';
import type { DeleteLeagueInput, LeagueMemberFact } from './leagueLines';
import type { DeleteProof, ProofKind } from './proofKind';

export const DELETE_FIXTURES = ['password', 'password_ready', 'apple', 'apple_done', 'google', 'google_done', 'failed', 'running', 'alert'] as const;
export type DeleteFixture = (typeof DELETE_FIXTURES)[number];

export function parseDeleteFixture(isDev: boolean, raw: string | undefined): DeleteFixture | null {
  return isDev && (DELETE_FIXTURES as readonly string[]).includes(raw ?? '') ? (raw as DeleteFixture) : null;
}

const FIXTURE_PROOF: Record<ProofKind, DeleteProof> = {
  password: { kind: 'password', password: 'fixture-password' },
  apple: { kind: 'apple', identityToken: 'fixture', authorizationCode: 'fixture', nonce: 'fixture' },
  google: { kind: 'google', idToken: 'fixture' },
};

/** The proof the account signs in with, as the knob wants it (the unset knob keeps what the account really uses). */
export function fixtureKind(f: DeleteFixture | null, real: ProofKind): ProofKind {
  if (f === null) return real;
  if (f.startsWith('apple')) return 'apple';
  if (f.startsWith('google')) return 'google';
  return 'password';
}

/** The state to start the screen in. 'alert' returns the READY state; the screen then presses the real button once. */
export function fixtureState(f: DeleteFixture | null, real: ProofKind): DeleteState {
  const kind = fixtureKind(f, real);
  const base = initialDeleteState(kind);
  switch (f) {
    case null:
    case 'password':
    case 'apple':
    case 'google':
      return base;
    case 'failed':
      return { ...base, proof: FIXTURE_PROOF[kind], failed: true };
    case 'running':
      return { ...base, proof: FIXTURE_PROOF[kind], phase: 'sending' };
    case 'password_ready':
    case 'apple_done':
    case 'google_done':
    case 'alert':
      return { ...base, proof: FIXTURE_PROOF[kind] };
  }
}

const m = (id: string, joined: string, name: string | null, deleted = false): LeagueMemberFact => ({
  user_id: id, joined_at: joined, hidden: false, displayName: name, isBot: false, deleted,
});

/** The board's moment: Roberto runs Stock Scudetto, plays in Friday Night Stocks, has joined Serie A Traders (undrafted), and runs Solo Stocks alone. */
export function fixtureLeagues(meId: string): DeleteLeagueInput[] {
  const ago = (d: number) => new Date(Date.now() - d * 24 * 3600 * 1000).toISOString();
  const ahead = new Date(Date.now() + 9 * 24 * 3600 * 1000).toISOString();
  return [
    { id: 'f1', name: 'Stock Scudetto', commissionerId: meId, facts: { seasonStatus: 'active', draftStatus: 'completed', draftDate: ago(40) }, members: [m(meId, ago(60), 'Roberto B.'), m('f-p', ago(59), 'Paolo M.'), m('f-g', ago(58), 'Giulia R.')] },
    { id: 'f2', name: 'Friday Night Stocks', commissionerId: 'f-o', facts: { seasonStatus: 'active', draftStatus: 'completed', draftDate: ago(30) }, members: [m(meId, ago(50), 'Roberto B.'), m('f-o', ago(55), 'Marco T.')] },
    { id: 'f3', name: 'Serie A Traders', commissionerId: 'f-s', facts: { seasonStatus: 'active', draftStatus: 'not_started', draftDate: ahead }, members: [m(meId, ago(5), 'Roberto B.'), m('f-s', ago(6), 'Sara L.')] },
    { id: 'f4', name: 'Solo Stocks', commissionerId: meId, facts: { seasonStatus: 'active', draftStatus: 'completed', draftDate: ago(20) }, members: [m(meId, ago(25), 'Roberto B.')] },
  ];
}
