/**
 * What the /auth/confirm page shows. The decision is made by the inline
 * script in index.html, BEFORE the bundle loads: it drops the query and hash
 * from the URL and leaves only the outcome in this history entry's state. The
 * page never sees the code, and never calls supabase.auth: the PKCE verifier
 * lives on the phone that signed up, so there is nothing to exchange here.
 */
export type ConfirmOutcome = 'confirmed' | 'error' | 'none';

export function readConfirmOutcome(historyState: unknown): ConfirmOutcome {
  if (historyState === null || typeof historyState !== 'object') return 'none';
  const v = (historyState as { authConfirm?: unknown }).authConfirm;
  return v === 'confirmed' || v === 'error' ? v : 'none';
}
