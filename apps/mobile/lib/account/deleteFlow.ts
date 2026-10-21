// Account deletion (W4) — the delete screen's state machine. Pure, so the guarantees that matter are tested
// rather than hoped for:
//
//   * NOTHING IS SENT BEFORE "Delete". The only function that returns a request body is `confirmDelete`, and it
//     returns one only from the `confirming` phase (the alert is up) with a proof in hand. Tapping the button only
//     opens the alert (`askConfirm`); "Keep my account" returns to `editing` and sends nothing.
//   * The button is dimmed until the proof is in hand (`canAsk`); while the request runs nothing is tappable.
//   * A server answer is read by its REASON, not its HTTP shape (the CLAUDE.md success-signal rule: `ok:true` is the
//     only success, anything else is a refusal or an unknown). Everything but bad_proof / apple_proof_required is the
//     one plain failure line, and clears the proof (the server consumed it; an Apple code is single-use).
//   * An Apple/Google proof is discarded on "Keep my account": the code is short-lived and was meant for this
//     request, so a cancel discards it (plan, How it works 3).

import type { FunctionRefusal } from '../functionRefusal';
import { proofInHand, type DeleteProof, type ProofKind } from './proofKind';

export type DeletePhase = 'editing' | 'confirming' | 'sending' | 'done';

export interface DeleteState {
  phase: DeletePhase;
  kind: ProofKind;
  proof: DeleteProof | null;
  /** When the proof arrived (ms, the caller's clock). Apple's authorization code lives ~5 minutes and an id token ~10, so a social proof is aged at Delete (lib/account/deleteRun.ts). */
  proofAt: number | null;
  /** The plain line "Couldn't delete your account. Try again." is showing. */
  failed: boolean;
  /** The last proof was refused: the password field is marked invalid (no new copy), the social button is offered again. */
  proofRejected: boolean;
}

export function initialDeleteState(kind: ProofKind): DeleteState {
  return { phase: 'editing', kind, proof: null, proofAt: null, failed: false, proofRejected: false };
}

/** Whether "Delete my account" is live: editing, with the proof in hand. */
export function canAsk(s: DeleteState): boolean {
  return s.phase === 'editing' && proofInHand(s.proof, s.kind);
}

/** Typing a password, or an Apple/Google proof arriving. A proof of the wrong kind is ignored. */
export function setProof(s: DeleteState, proof: DeleteProof | null, now: number): DeleteState {
  if (s.phase !== 'editing') return s;
  if (proof !== null && proof.kind !== s.kind) return s;
  return { ...s, proof, proofAt: proof === null ? null : now, proofRejected: false };
}

/** "Delete my account" tapped: opens the alert. Sends nothing. */
export function askConfirm(s: DeleteState): DeleteState {
  return canAsk(s) ? { ...s, phase: 'confirming', failed: false } : s;
}

/** The alert's "Keep my account" (or a dismissal): back to editing, nothing sent. A social proof is discarded. */
export function keepAccount(s: DeleteState): DeleteState {
  if (s.phase !== 'confirming') return s;
  return { ...s, phase: 'editing', proof: s.kind === 'password' ? s.proof : null, proofAt: s.kind === 'password' ? s.proofAt : null };
}

export interface DeleteRequestBody {
  proof: DeleteProof;
}

/**
 * The alert's "Delete". The ONLY producer of a request body: it exists only from `confirming` with a proof in hand.
 * Returns the next state and the body to send (null = nothing to send, e.g. a stray second tap).
 */
export function confirmDelete(s: DeleteState): { state: DeleteState; body: DeleteRequestBody | null; proofAt: number | null } {
  if (s.phase !== 'confirming' || !proofInHand(s.proof, s.kind) || s.proof === null) return { state: s, body: null, proofAt: null };
  return { state: { ...s, phase: 'sending', failed: false }, body: { proof: s.proof }, proofAt: s.proofAt };
}

export type DeleteOutcome =
  | { kind: 'deleted' }
  | { kind: 'bad_proof' }
  | { kind: 'apple_required' }
  /** The Apple/Google token was over ~10 minutes old (does not count toward the proof limit): ask for a fresh one, never the generic failure. */
  | { kind: 'proof_expired' }
  /** The person closed the Apple/Google sheet that refreshed an aged proof: nothing was sent, nothing to say. */
  | { kind: 'cancelled' }
  | { kind: 'failed' };

/** Reads the function's answer. Only an explicit `ok: true` is deleted; a transport failure is an unknown, shown as failed. */
export function deleteOutcome(r: FunctionRefusal): DeleteOutcome {
  if (r.transport) return { kind: 'failed' };
  // ok:true AND stage 'done' (W3: ok is returned only when the deletion is fully done; apple_revoke pending/unrevoked is the server's to retry, not ours to show).
  if (r.reason === null) return r.body.ok === true && r.body.stage === 'done' ? { kind: 'deleted' } : { kind: 'failed' };
  if (r.reason === 'bad_proof') return { kind: 'bad_proof' };
  if (r.reason === 'apple_proof_required') return { kind: 'apple_required' };
  if (r.reason === 'proof_expired') return { kind: 'proof_expired' };
  return { kind: 'failed' };
}

/** Applies the answer. Only a request in flight can be answered. */
export function applyOutcome(s: DeleteState, o: DeleteOutcome): DeleteState {
  if (s.phase !== 'sending') return s;
  switch (o.kind) {
    case 'deleted':
      return { ...s, phase: 'done', failed: false, proofRejected: false };
    case 'bad_proof':
      return { ...s, phase: 'editing', proof: null, proofAt: null, failed: false, proofRejected: true };
    case 'apple_required':
      return { ...s, phase: 'editing', kind: 'apple', proof: null, proofAt: null, failed: false, proofRejected: false };
    case 'proof_expired':
    case 'cancelled':
      // Re-ask: the proof block is back (the button's reason), with no failure line.
      return { ...s, phase: 'editing', proof: null, proofAt: null, failed: false, proofRejected: false };
    case 'failed':
      return { ...s, phase: 'editing', proof: null, proofAt: null, failed: true, proofRejected: false };
  }
}
