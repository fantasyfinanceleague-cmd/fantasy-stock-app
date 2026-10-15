import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { readConfirmOutcome } from './confirmOutcome';
import { fetchInvitePreview } from './invitePreview';
import { normalizeInviteCode } from './inviteCode';
import { openConfirmInAppUrl } from './config';
import { PENDING_COPY, WEB_COPY } from './joinCopy';
import { WebPage } from './JoinView';

const CHECK = 'M5 12.5l4.5 4.5L19 7.5';

/** What the inline script in index.html kept IN MEMORY (never the URL): the code, and a pending invite. */
interface HeldLink { code: string | null; invite: string | null }
function readHeldLink(): HeldLink {
  const held = (window as unknown as { __stockpileAuthConfirm?: Partial<HeldLink> }).__stockpileAuthConfirm;
  return { code: typeof held?.code === 'string' && held.code ? held.code : null, invite: typeof held?.invite === 'string' ? held.invite : null };
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
 * With a pending invite the line names the league ("...to finish joining
 * {league}"). The name comes only from the preview, never from the URL; an
 * unknown or refused invite (or any failure) gets the plain line, since there
 * is nothing to finish joining.
 *
 * A visit with no outcome (typed URL, a new tab) is not a confirmation, so it
 * goes to the landing rather than claiming one.
 */
export default function ConfirmPage() {
  const [outcome] = useState(() => readConfirmOutcome(window.history.state));
  const [held] = useState(readHeldLink);
  const invite = outcome === 'confirmed' ? normalizeInviteCode(held.invite) : null;
  const [league, setLeague] = useState<{ settled: boolean; name: string | null }>({ settled: invite === null, name: null });

  useEffect(() => {
    if (!invite) return;
    const abort = new AbortController();
    fetchInvitePreview(invite, { signal: abort.signal, timeoutMs: 3000 }).then((p) => {
      if (!abort.signal.aborted) setLeague({ settled: true, name: p.kind === 'found' && !p.block ? p.name : null });
    });
    return () => abort.abort();
  }, [invite]);

  if (outcome === 'none') return <Navigate to="/" replace />;
  if (outcome === 'error') {
    return (
      <WebPage center>
        <p className="obw__warn" role="alert">{WEB_COPY.confirmError}</p>
      </WebPage>
    );
  }
  // Wait (briefly) for the league name rather than flash the plain line and swap it.
  if (!league.settled) return <WebPage center><div aria-busy="true" /></WebPage>;
  return (
    <WebPage center>
      <span className="obw__disc" aria-hidden="true">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d={CHECK} /></svg>
      </span>
      <h1 className="obw__title">{league.name ? WEB_COPY.confirmedWithInvite(league.name) : WEB_COPY.confirmed}</h1>
      {held.code && isTouchDevice() ? (
        <div className="obw__actions">
          <a className="obw__line-btn" href={openConfirmInAppUrl(held.code)}>{PENDING_COPY.openInApp}</a>
        </div>
      ) : null}
    </WebPage>
  );
}
