import { isConfirmRoute } from '@/lib/auth/confirmLink';
import { getLiveSession } from '@/lib/auth/liveSession';
import { stripInviteParam } from '@/lib/invite/autoJoin';
import { parseInviteArrival } from '@/lib/invite/inviteLink';
import { pendingInvite } from '@/lib/invite/pendingInviteStore';
import { isRecoveryRoute } from '@/lib/recoveryLink';
import { markOnboardingSeen } from '@/lib/shell/firstRun';
import { pendingRoute } from '@/lib/shell/pendingRoute';

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
  // Onboarding W3: an invite link (https://<domain>/join/<CODE> or fantasystockapp://join/<CODE>) is not a
  // screen either. Its code is read STRICTLY from the path (lib/invite/inviteLink.ts) and kept as the PENDING
  // INVITE (lib/invite/pendingInvite.ts), never as a router param; the root layout opens the join once the
  // person is in the app, whatever the sign-in took (Apple, Google, email + a confirmation round trip). The
  // router just opens the root: sign-in when signed out, Home when signed in. A link arrival also marks the
  // cards seen (plan: they are for a cold install with no invite). A link that fails the shape check is
  // dropped here and the router sees the original path, which matches no route and falls back as before.
  try {
    // The origin (the shared https link, or the scheme) and whether the person already had a session are decided HERE,
    // once, and travel with the invite (decision 18): a scheme link that arrives while signed in waits for a tap.
    // Whether the person has a session is read LIVE (lib/auth/liveSession.ts, published by SessionProvider the instant
    // the session appears), never from the layout's phase, which lags a sign-in by the profile read and the button's
    // hold: a scheme link fired in that window would otherwise read as signed out and auto-join.
    const invite = parseInviteArrival(path);
    const live = getLiveSession();
    if (invite && pendingInvite.capture(invite.code, { origin: invite.origin, signedInAtArrival: live.signedIn, userIdAtArrival: live.userId })) {
      markOnboardingSeen();
      return '/';
    }
  } catch (e) {
    console.warn('[native-intent] could not record invite link', e);
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
  // join-league is deep-linkable; an external link must not switch it into invite mode (?invite=...): only the layout does,
  // for a pending invite (lib/invite/autoJoin.ts inviteScreenMode).
  return stripInviteParam(path);
}
