import { isConfirmRoute } from '@/lib/auth/confirmLink';
import { isRecoveryRoute } from '@/lib/recoveryLink';
import { pendingRoute } from '@/lib/shell/pendingRoute';
import { markOnboardingSeen } from '@/lib/shell/firstRun';

// Phase 3b-1 — the first half of the signed-out deep-link resume.
//
// expo-router calls this for every system link (the cold-start URL and any
// link opened while running) BEFORE it routes. The link is recorded so the
// root layout can open it after sign-in, and the path is returned unchanged:
// the router still handles it, and Stack.Protected (app/_layout.tsx) sends a
// signed-out user to sign-in instead of rendering the guarded screen.
// lib/shell/pendingRoute.ts decides whether the recorded link is ever
// replayed; lib/shell/resumeTarget.ts decides whether it is allowed to be.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    pendingRoute.record(path);
    // A link arrival is the invited path: it never sees the cards (cold installs only; plan
    // 2026-10-14), so the cards count as seen from here on.
    if (pendingRoute.peek()) markOnboardingSeen();
  } catch (e) {
    // Throwing here can crash the app (expo-router's own warning); the
    // link still routes normally, it just won't be resumed.
    console.warn('[native-intent] could not record deep link', e);
  }
  // Onboarding W2: the email-confirmation return (fantasystockapp://auth/confirm?code=…) is not a
  // screen. The root layout's link handler reads it; the router just opens sign-in, which the
  // guard swaps for the next step once (and only if) the code exchanges. Returning a fixed path
  // also keeps the one-time code out of the router's params and navigation state.
  if (isConfirmRoute(path)) return '/login';
  // The password-reset link carries a one-time code too: open the plain screen, so the code stays out of
  // the router's params (and its navigation state). app/_layout.tsx exchanges it from the link itself,
  // and the screen reads only its own `status` param.
  if (isRecoveryRoute(path)) return '/reset-password';
  return path;
}
