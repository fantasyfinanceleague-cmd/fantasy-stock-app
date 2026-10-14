// Stockpile — DEV-ONLY capture override for reset-password (gn-sweep). The screen's "form"
// and "success" states are reached only through a real recovery email (the nonce-bound
// deep link, lib/recoveryNonce.ts), so a design capture can't open them. This picks the
// state the screen RENDERS, nothing else: it never sets the recovery flag, never touches
// auth, and the form's Update password still goes through supabase (which refuses with no
// recovery session). Read only when `dev` is true; release bundles compile __DEV__ to false.

export type ResetCaptureView = 'form' | 'success';

/** EXPO_PUBLIC_RESET_CAPTURE=form|success in a dev build; anything else (or a release) is null. */
export function parseResetCaptureView(raw: string | undefined, dev: boolean): ResetCaptureView | null {
  if (!dev) return null;
  return raw === 'form' || raw === 'success' ? raw : null;
}
