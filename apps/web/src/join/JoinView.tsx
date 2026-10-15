import type { ReactNode } from 'react';
import { brand } from '../brand';
import { blockMessage, errorMessage, JOIN_COPY, PENDING_COPY, preSignInBlockMessage, WEB_COPY, type JoinBlock, type JoinErrorKind } from './joinCopy';
import { APP_STORE_URL, openInAppUrl } from './config';
import './joinWeb.css';

/** What preview-league says about the league (the fields this page renders). */
export interface InviteLeague {
  name: string;
  /** num_participants: blockMessage('league_full') names it. */
  max: number;
}

export type JoinViewState =
  /** The path segment can't be a code: refused without a network call. */
  | { kind: 'bad_code' }
  /** A well-formed code, the no-session preview still in flight: the page frame only. */
  | { kind: 'loading' }
  /** The code resolved nowhere (invite-preview `found:false`): the app's "no league has that code" line. */
  | { kind: 'not_found' }
  /**
   * The no-session preview (league NAME + INVITER only). `name` null is the
   * fallback when the preview is unavailable ("You're invited to a league").
   * `block` is a refusal reason from the preview; no counts exist yet.
   */
  | { kind: 'invited'; code: string; name: string | null; inviter: string | null; block: JoinBlock | null }
  | { kind: 'error'; code: string; error: JoinErrorKind }
  | {
      kind: 'preview';
      code: string;
      league: InviteLeague;
      /** The commissioner's display name, once preview-league sends `inviter` (W3). Absent: the league name alone. */
      inviter: string | null;
      /** The preview's rows (Managers / Draft / Stakes / Season), once the preview's shape is settled. */
      rows?: { label: string; value: string }[];
      block: JoinBlock | null;
    };

const APPLE = 'M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9-.7 0-1.8-.9-3-.8-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.3 0 2-1.1 2.8-2.3.9-1.3 1.2-2.5 1.3-2.6-.1 0-2.5-1-2.5-3.8zM14.1 5.8c.6-.8 1.1-1.9 1-3-.9 0-2.1.6-2.8 1.4-.6.7-1.1 1.8-1 2.9 1 .1 2.1-.5 2.8-1.3z';

/** "Roberto B." -> "RB"; one word -> its first letter. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const first = words[0][0] ?? '';
  const last = words.length > 1 ? words[words.length - 1][0] ?? '' : '';
  return (first + last).toUpperCase();
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

function GetTheApp({ code }: { code: string }) {
  return (
    <div className="obw__actions">
      <a className="obw__line-btn" href={openInAppUrl(code)}>{PENDING_COPY.openInApp}</a>
      <AppStoreBadge />
    </div>
  );
}

export function JoinView({ state }: { state: JoinViewState }) {
  if (state.kind === 'bad_code') {
    return (
      <WebPage>
        <p className="obw__warn" role="alert">{JOIN_COPY.badCode}</p>
      </WebPage>
    );
  }
  if (state.kind === 'loading') {
    return <WebPage><div aria-busy="true" /></WebPage>;
  }
  if (state.kind === 'not_found') {
    return (
      <WebPage>
        <p className="obw__warn" role="alert">{JOIN_COPY.badCode}</p>
      </WebPage>
    );
  }
  if (state.kind === 'invited') {
    const { code, name, inviter, block } = state;
    return (
      <WebPage>
        {name && inviter ? <span className="obw__av" aria-hidden="true">{initials(inviter)}</span> : null}
        <h1 className="obw__title">
          {name === null ? WEB_COPY.invitedToGeneric : inviter ? WEB_COPY.invitedBy(inviter, name) : WEB_COPY.invitedTo(name)}
        </h1>
        {block && name ? (
          <>
            <p className="obw__warn" role="alert">{preSignInBlockMessage(block, name)}</p>
            <div className="obw__actions"><AppStoreBadge /></div>
          </>
        ) : (
          <GetTheApp code={code} />
        )}
      </WebPage>
    );
  }
  if (state.kind === 'error') {
    return (
      <WebPage>
        <p className="obw__warn" role="alert">{errorMessage(state.error)}</p>
        <GetTheApp code={state.code} />
      </WebPage>
    );
  }
  const { league, inviter, rows, block } = state;
  return (
    <WebPage>
      {inviter ? <span className="obw__av" aria-hidden="true">{initials(inviter)}</span> : null}
      <h1 className="obw__title">{inviter ? WEB_COPY.invitedBy(inviter, league.name) : league.name}</h1>
      {rows && rows.length > 0 ? (
        <dl className="obw__card">
          {rows.map((r) => (
            <div className="obw__row" key={r.label}><dt>{r.label}</dt><dd>{r.value}</dd></div>
          ))}
        </dl>
      ) : null}
      {block ? (
        <>
          <p className="obw__warn" role="alert">{blockMessage(block, league)}</p>
          <div className="obw__actions"><AppStoreBadge /></div>
        </>
      ) : (
        <GetTheApp code={state.code} />
      )}
    </WebPage>
  );
}
