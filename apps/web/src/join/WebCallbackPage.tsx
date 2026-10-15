import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { clearPendingInvite, getPendingInvite } from './pendingInvite';
import { normalizeInviteCode } from './inviteCode';
import { exchangeCode, signOutLocal } from './onboardingAuth';
import { WebPage, Busy, Warn } from './JoinView';
import { WEB_COPY } from './joinCopy';
import type { FlowNotice } from './JoinFlow';

/** What the inline script in index.html kept IN MEMORY (never the URL) for this one visit. */
export interface HeldCallback {
  code: string | null;
  invite: string | null;
  via: 'email' | 'oauth';
  /** The link carried an error: the signup gate's refusal, or anything else. */
  error: false | 'paused' | 'other';
}

export function readHeldCallback(): HeldCallback | null {
  const held = (window as unknown as { __stockpileWebCallback?: Partial<HeldCallback> }).__stockpileWebCallback;
  if (!held) return null;
  return {
    code: typeof held.code === 'string' && held.code ? held.code : null,
    invite: typeof held.invite === 'string' ? held.invite : null,
    via: held.via === 'oauth' ? 'oauth' : 'email',
    error: held.error === 'paused' ? 'paused' : held.error ? 'other' : false,
  };
}

/** Which line a failed return gets: the web's own words, never the server's. */
export function failureNotice(via: 'email' | 'oauth', cause: 'error-link' | 'exchange-failed', error: false | 'paused' | 'other'): FlowNotice {
  if (error === 'paused') return 'paused';
  if (via === 'email') return cause === 'error-link' ? 'expired' : 'confirmed-sign-in';
  return 'generic';
}

const FAILURE_LINE: Record<FlowNotice, string> = {
  'confirmed-sign-in': WEB_COPY.confirmedSignIn,
  expired: WEB_COPY.webLinkExpired,
  paused: WEB_COPY.signupsPaused,
  generic: WEB_COPY.generic,
};

/**
 * /auth/web-callback: where an email link sent by THIS web page, or a Google /
 * Apple return, lands. (The app's own emails land on /auth/confirm, which never
 * exchanges; this path is NOT in the apple-app-site-association, so iOS never
 * hands it to the app.)
 *
 * The PKCE verifier for these is in THIS browser, so this page DOES exchange
 * the code, explicitly: by the time it renders, the inline script has already
 * taken the code off the URL, so no client ever read it. Then it returns to
 * /join/<invite> (the invite from the redirect URL, else the one stored when
 * sign-in began), where the flow carries on: username, then join.
 *
 * A failure goes back to the same page with a notice (a known word, never a
 * message). With no invite to go back to there is nowhere to sign in, so the
 * line shows here.
 */
export default function WebCallbackPage() {
  const navigate = useNavigate();
  const started = useRef(false);
  const [held] = useState(readHeldCallback);
  const invite = normalizeInviteCode(held?.invite) ?? getPendingInvite();
  const [stuck, setStuck] = useState<FlowNotice | null>(null);

  useEffect(() => {
    if (started.current) return; // StrictMode runs effects twice; a code exchanges once
    started.current = true;
    void (async () => {
      const back = (state?: object) => invite
        ? navigate(`/join/${invite}`, { replace: true, state })
        : null;
      // A reload (or a typed URL): nothing in memory. A live session continues from the join page.
      if (!held || (!held.code && !held.error)) {
        if (invite) return navigate(`/join/${invite}`, { replace: true });
        return navigate('/', { replace: true });
      }
      if (held.error || !held.code) {
        const notice = failureNotice(held.via, 'error-link', held.error);
        clearPendingInvite();
        return back({ notice }) ?? setStuck(notice);
      }
      const { error } = await exchangeCode(held.code);
      if (error) {
        const notice = failureNotice(held.via, 'exchange-failed', false);
        return back({ notice }) ?? setStuck(notice);
      }
      if (!invite) {
        // Signed in with nothing to join: the web's only job is the join, so end the session.
        await signOutLocal();
        return navigate('/', { replace: true });
      }
      return back({ emailConfirmed: held.via === 'email' });
    })();
  }, [held, invite, navigate]);

  if (!held && !invite) return <Navigate to="/" replace />;
  return (
    <WebPage center>
      {stuck ? <Warn>{FAILURE_LINE[stuck]}</Warn> : <Busy />}
    </WebPage>
  );
}
