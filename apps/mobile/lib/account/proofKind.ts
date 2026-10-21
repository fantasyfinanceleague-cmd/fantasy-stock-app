// Account deletion (W4) — which proof to ask for, from how the account signs in (user.identities).
//
// The server decides what it accepts; this only picks what to OFFER so the person isn't asked for a password they
// never set. Apple always wins: an account with an Apple identity MUST prove with Apple (the revoke needs the fresh
// authorization code), and the server answers apple_proof_required to anything else. Google over password when both
// exist (Orchestrator, 2026-10-21); password only with no social identity.

export type ProofKind = 'password' | 'apple' | 'google';

export function proofKindFor(identities: ReadonlyArray<{ provider?: string | null }> | null | undefined): ProofKind {
  const providers = new Set((identities ?? []).map((i) => i?.provider));
  if (providers.has('apple')) return 'apple';
  if (providers.has('google')) return 'google';
  return 'password';
}

/** The proof the server's body takes (supabase/functions/delete-account). */
export type DeleteProof =
  | { kind: 'password'; password: string }
  | { kind: 'apple'; identityToken: string; authorizationCode: string; nonce: string }
  | { kind: 'google'; idToken: string };

const nonEmpty = (s: unknown): s is string => typeof s === 'string' && s.length > 0;

/** True only for a proof that carries everything the server reads. */
export function proofInHand(proof: DeleteProof | null | undefined, kind: ProofKind): boolean {
  if (!proof || proof.kind !== kind) return false;
  switch (proof.kind) {
    case 'password':
      return nonEmpty(proof.password);
    case 'apple':
      return nonEmpty(proof.identityToken) && nonEmpty(proof.authorizationCode) && nonEmpty(proof.nonce);
    case 'google':
      return nonEmpty(proof.idToken);
  }
}
