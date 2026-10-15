import type { ReactNode } from 'react';
import { brand } from '../brand';
import { openInAppUrl, APP_STORE_URL } from './config';
import { blockMessage, errorMessage, preSignInBlockMessage, WEB_COPY, type JoinBlock, type JoinErrorKind } from './joinCopy';
import type { PreviewRow } from './previewData';
import './joinWeb.css';

const APPLE = 'M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9-.7 0-1.8-.9-3-.8-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.3 0 2-1.1 2.8-2.3.9-1.3 1.2-2.5 1.3-2.6-.1 0-2.5-1-2.5-3.8zM14.1 5.8c.6-.8 1.1-1.9 1-3-.9 0-2.1.6-2.8 1.4-.6.7-1.1 1.8-1 2.9 1 .1 2.1-.5 2.8-1.3z';
export { APPLE as APPLE_PATH };

/** "Roberto B." -> "RB"; one word -> its first letter. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const first = words[0][0] ?? '';
  const last = words.length > 1 ? words[words.length - 1][0] ?? '' : '';
  return (first + last).toUpperCase();
}

/** The invite headline: "{inviter} invited you to {league}", "You're invited to {league}", or the generic fallback. */
export function inviteHeadline(name: string | null, inviter: string | null): string {
  if (name === null) return WEB_COPY.invitedToGeneric;
  return inviter ? WEB_COPY.invitedBy(inviter, name) : WEB_COPY.invitedTo(name);
}

export function WebPage({ children, center = false }: { children: ReactNode; center?: boolean }) {
  return (
    <div className="obw">
      <header><span className="obw__wordmark">{brand.wordmark}</span></header>
      <main className="obw__body">
        <div className={center ? 'obw__col obw__col--center' : 'obw__col'}>{children}</div>
      </main>
    </div>
  );
}

/** Work in progress: no words, nothing to mistake for a result. */
export function Busy() {
  return <div className="obw__busy" aria-busy="true" />;
}

export function Warn({ children }: { children: ReactNode }) {
  return <p className="obw__warn" role="alert">{children}</p>;
}

export function Avatar({ inviter }: { inviter: string | null }) {
  return inviter ? <span className="obw__av" aria-hidden="true">{initials(inviter)}</span> : null;
}

export function AppStoreBadge() {
  return (
    <a className="obw__store" href={APP_STORE_URL} aria-label={WEB_COPY.appStoreBadge} rel="noopener noreferrer">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={APPLE} /></svg>
      <span className="obw__store-text" aria-hidden="true">
        <span className="obw__store-small">Download on the</span>
        <span className="obw__store-big">App Store</span>
      </span>
    </a>
  );
}

/** "Open the app" (the custom scheme: a same-domain https link does not fire a universal link from Safari). */
export function OpenInApp({ code, as = 'button' }: { code: string; as?: 'button' | 'link' }) {
  return (
    <a className={as === 'link' ? 'obw__link' : 'obw__line-btn'} href={openInAppUrl(code)}>{WEB_COPY.openApp}</a>
  );
}

/** "Not you? Sign out": on a signed-in screen that is not the end. */
export function SignOutButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="obw__link obw__signout" onClick={onClick}>{WEB_COPY.notYouSignOut}</button>
  );
}

export type JoinViewState =
  /** The no-session preview is in flight: the page frame only. */
  | { kind: 'loading' }
  /** The code can't be a code, or resolved nowhere: the Planner's "link doesn't work anymore" line. */
  | { kind: 'dead' }
  /** The no-session preview refused: a reason, no counts (so only the Planner's neutral lines). */
  | { kind: 'refused'; name: string; inviter: string | null; block: JoinBlock }
  /** A refusal AFTER sign-in: the facts rows and the app's full line, now that the counts are known. */
  | { kind: 'refused_after'; league: { name: string; max: number }; inviter: string | null; rows: PreviewRow[]; block: JoinBlock }
  /** A transport failure after sign-in: our line, never the server's. */
  | { kind: 'failed'; error: JoinErrorKind; onSignOut: () => void };

export function JoinView({ state }: { state: JoinViewState }) {
  if (state.kind === 'loading') return <WebPage><Busy /></WebPage>;
  if (state.kind === 'dead') {
    return <WebPage><Warn>{WEB_COPY.inviteLinkDead}</Warn></WebPage>;
  }
  if (state.kind === 'refused') {
    return (
      <WebPage>
        <Avatar inviter={state.inviter} />
        <h1 className="obw__title">{inviteHeadline(state.name, state.inviter)}</h1>
        <Warn>{preSignInBlockMessage(state.block, state.name)}</Warn>
        <div className="obw__actions"><AppStoreBadge /></div>
      </WebPage>
    );
  }
  if (state.kind === 'failed') {
    return (
      <WebPage>
        <Warn>{errorMessage(state.error)}</Warn>
        <SignOutButton onClick={state.onSignOut} />
      </WebPage>
    );
  }
  const { league, inviter, rows, block } = state;
  return (
    <WebPage>
      <Avatar inviter={inviter} />
      <h1 className="obw__title">{inviteHeadline(league.name, inviter)}</h1>
      {rows.length > 0 ? (
        <dl className="obw__card">
          {rows.map((r) => (
            <div className="obw__row" key={r.label}><dt>{r.label}</dt><dd>{r.value}</dd></div>
          ))}
        </dl>
      ) : null}
      <Warn>{blockMessage(block, league)}</Warn>
      <div className="obw__actions"><AppStoreBadge /></div>
    </WebPage>
  );
}
