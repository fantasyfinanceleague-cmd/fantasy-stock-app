import type { ReactNode } from 'react';
import { brand } from '../brand';
import { APP_STORE_URL } from './config';
import { errorMessage, refusalMessage, WEB_COPY, type JoinBlock, type JoinErrorKind } from './joinCopy';
import './joinWeb.css';

const APPLE = 'M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9-.7 0-1.8-.9-3-.8-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.3 0 2-1.1 2.8-2.3.9-1.3 1.2-2.5 1.3-2.6-.1 0-2.5-1-2.5-3.8zM14.1 5.8c.6-.8 1.1-1.9 1-3-.9 0-2.1.6-2.8 1.4-.6.7-1.1 1.8-1 2.9 1 .1 2.1-.5 2.8-1.3z';
export { APPLE as APPLE_PATH };
/** The board's league icon (a trophy). */
const TROPHY = 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3';

/** "Roberto B." -> "RB"; one word -> its first letter. Code-point aware (never half an emoji). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const first = Array.from(words[0])[0] ?? '';
  const last = words.length > 1 ? Array.from(words[words.length - 1])[0] ?? '' : '';
  return (first + last).toUpperCase();
}

/**
 * Names up to this many characters fit one line of the 28px headline on a 375pt phone
 * ("Stock Scudetto" is 14). A longer name could not stay on one line anyway: forcing it
 * would chop it mid-word, so it may wrap at its spaces instead.
 */
export const UNBROKEN_NAME_MAX = 20;

/** A league's name never breaks across lines in a headline (Giorgio's arrival, 2026-10-14), while it can fit. */
export function unbreakable(name: string): string {
  return Array.from(name).length <= UNBROKEN_NAME_MAX ? name.replace(/ /g, '\u00a0') : name;
}

/**
 * The invite headline: "{inviter} invited you to {league}" (the inviter's
 * initials above), "You're invited to {league}" (the league icon above), or the
 * generic fallback (the league icon). The league name is non-breaking.
 */
export function inviteHeadline(name: string | null, inviter: string | null): string {
  if (name === null) return WEB_COPY.invitedToGeneric;
  return inviter ? WEB_COPY.invitedBy(inviter, unbreakable(name)) : WEB_COPY.invitedTo(unbreakable(name));
}

export function WebPage({ children, center = false, arrival = false }: { children: ReactNode; center?: boolean; arrival?: boolean }) {
  return (
    <div className="obw">
      <header><span className="obw__wordmark">{brand.wordmark}</span></header>
      <main className={arrival ? 'obw__body obw__body--arrival' : 'obw__body'}>
        {arrival ? children : <div className={center ? 'obw__col obw__col--center' : 'obw__col'}>{children}</div>}
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

/** The inviter's initials, or (name only / no preview) the league icon. */
export function InviteMark({ name, inviter }: { name: string | null; inviter: string | null }) {
  if (name !== null && inviter) return <span className="obw__av" aria-hidden="true">{initials(inviter)}</span>;
  return (
    <span className="obw__icon" aria-hidden="true">
      <svg width="29" height="29" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d={TROPHY} /></svg>
    </span>
  );
}

/** The invite block of the arrival: the mark and the headline, centred. */
export function InviteBlock({ name, inviter }: { name: string | null; inviter: string | null }) {
  return (
    <div className="obw__invite">
      <InviteMark name={name} inviter={inviter} />
      <h1 className="obw__title">{inviteHeadline(name, inviter)}</h1>
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

/** "Not you? Sign out": on a signed-in screen that is not the end. */
export function SignOutButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="obw__link obw__signout" onClick={onClick}>{WEB_COPY.notYouSignOut}</button>
  );
}

/**
 * The warning panel that takes the buttons' place, with "Sign in" under it (approved via the Planner).
 * "Sign in" opens the WEB sign-in (the Orchestrator's ruling, 2026-10-14: on a laptop an app-scheme link is a
 * dead link): an existing member who meets a pre-sign-in "full" or "not taking new players" signs in and the
 * session preview tells them "You're already in {league}"; anyone else gets the genuine refusal. It is absent
 * where there is nothing to sign in to (after sign-in, or a code that can't be a code).
 */
function Refusal({ message, onSignIn }: { message: string; onSignIn?: () => void }) {
  return (
    <div className="obw__refuse">
      <Warn>{message}</Warn>
      {onSignIn ? <button type="button" className="obw__link" onClick={onSignIn}><b>{WEB_COPY.signIn}</b></button> : null}
    </div>
  );
}

export type JoinViewState =
  /** The no-session preview is in flight: the page frame only. */
  | { kind: 'loading' }
  /** The code can't be a code, or resolved nowhere: no heading, the panel and "Sign in", centred. */
  | { kind: 'dead'; onSignIn?: () => void }
  /**
   * The league won't take this person (before sign-in: from the no-session
   * preview; after: from join-league). The heading stays, the panel replaces
   * the buttons, and there is no App Store badge. `onSignIn` is only offered
   * before sign-in.
   */
  | { kind: 'refused'; name: string; inviter: string | null; block: JoinBlock; onSignIn?: () => void }
  /** A transport failure after sign-in: our line, never the server's. */
  | { kind: 'failed'; error: JoinErrorKind; onSignOut: () => void };

export function JoinView({ state }: { state: JoinViewState }) {
  if (state.kind === 'loading') return <WebPage><Busy /></WebPage>;
  if (state.kind === 'dead') {
    return (
      <WebPage arrival>
        <div className="obw__arrival obw__arrival--dead">
          <Refusal message={WEB_COPY.inviteLinkDead} onSignIn={state.onSignIn} />
        </div>
      </WebPage>
    );
  }
  if (state.kind === 'refused') {
    return (
      <WebPage arrival>
        <div className="obw__arrival">
          <InviteBlock name={state.name} inviter={state.inviter} />
          <Refusal message={refusalMessage(state.block, state.name)} onSignIn={state.onSignIn} />
        </div>
      </WebPage>
    );
  }
  return (
    <WebPage>
      <Warn>{errorMessage(state.error)}</Warn>
      <SignOutButton onClick={state.onSignOut} />
    </WebPage>
  );
}
