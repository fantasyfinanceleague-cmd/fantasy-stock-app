import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { readConfirmOutcome } from './confirmOutcome';
import { openConfirmInAppUrl } from './config';
import { takeHeld } from './heldLink';
import { WEB_COPY } from './joinCopy';
import { WebPage } from './JoinView';

const CHECK = 'M5 12.5l4.5 4.5L19 7.5';

/** What the inline script in index.html kept IN MEMORY (never the URL): the auth code. Nothing else. */
function readHeldCode(): string | null {
  const held = takeHeld<{ code?: unknown }>('__stockpileAuthConfirm');
  return typeof held?.code === 'string' && held.code ? held.code : null;
}

/** A touch device, where the universal link may not have fired after GoTrue's redirect. */
function isTouchDevice(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

/**
 * /auth/confirm on a device without the app (plan Decision 16): GoTrue has
 * already verified the email by the time it redirects here, so the page only
 * says so. It never exchanges the code and never touches supabase.auth (the
 * PKCE verifier is on the phone that signed up). By the time this renders the
 * inline script in index.html has removed the code from the URL; only the
 * outcome is left, in history.state, and the code itself lives in memory.
 *
 * The app's confirmation email carries NO invite (Planner, decision 17: a
 * mistyped address would hand a stranger a join capability), so this page has
 * no league to name and calls nothing: the line is the approved one, or the
 * expired one. Any `invite` parameter that ever appears is stripped with the rest
 * of the query by the inline script and never read here.
 *
 * A visit with no outcome (typed URL, a new tab) is not a confirmation, so it
 * goes to the landing rather than claiming one.
 */
export default function ConfirmPage() {
  const [outcome] = useState(() => readConfirmOutcome(window.history.state));
  const [code] = useState(readHeldCode);

  if (outcome === 'none') return <Navigate to="/" replace />;
  if (outcome === 'error') {
    return (
      <WebPage center>
        <p className="obw__warn" role="alert">{WEB_COPY.confirmError}</p>
      </WebPage>
    );
  }
  return (
    <WebPage center>
      <span className="obw__disc" aria-hidden="true">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d={CHECK} /></svg>
      </span>
      <h1 className="obw__title">{WEB_COPY.confirmed}</h1>
      {code && isTouchDevice() ? (
        <div className="obw__actions">
          <a className="obw__line-btn" href={openConfirmInAppUrl(code)}>{WEB_COPY.openApp}</a>
        </div>
      ) : null}
    </WebPage>
  );
}
