import { useEffect, useRef, useState, type FormEvent } from 'react';
import { PASSWORD_REQUIREMENTS } from '@fantasy-stock/shared/constants';
import { WEB_COPY } from './joinCopy';
import { firstFailingRule } from './usernameRules';
import { APPLE_PATH, AppStoreBadge, Avatar, Busy, inviteHeadline, OpenInApp, SignOutButton, WebPage, Warn } from './JoinView';

const CHECK = 'M5 12.5l4.5 4.5L19 7.5';

/** A line above the sign-in options: a result the person needs to know about. */
export interface Notice {
  tone: 'info' | 'warn';
  text: string;
}

function NoticeLine({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  return notice.tone === 'warn' ? <Warn>{notice.text}</Warn> : <p className="obw__sub" role="status">{notice.text}</p>;
}

/** Continue with Apple · Continue with Google · Use email (the board's order). */
export function SignInScreen(props: {
  code: string;
  name: string | null;
  inviter: string | null;
  notice: Notice | null;
  error: string | null;
  busy: 'apple' | 'google' | null;
  onApple: () => void;
  onGoogle: () => void;
  onEmail: () => void;
}) {
  const { busy } = props;
  return (
    <WebPage>
      <Avatar inviter={props.name ? props.inviter : null} />
      <h1 className="obw__title">{inviteHeadline(props.name, props.inviter)}</h1>
      <NoticeLine notice={props.notice} />
      <div className="obw__stack">
        <button type="button" className="obw__btn obw__btn--apple" disabled={busy !== null} onClick={props.onApple}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={APPLE_PATH} /></svg>
          {WEB_COPY.continueApple}
        </button>
        <button type="button" className="obw__btn obw__btn--line" disabled={busy !== null} onClick={props.onGoogle}>
          <b aria-hidden="true">G</b>
          {WEB_COPY.continueGoogle}
        </button>
        <button type="button" className="obw__btn obw__btn--line" disabled={busy !== null} onClick={props.onEmail}>
          {WEB_COPY.useEmail}
        </button>
      </div>
      {props.error ? <p className="obw__error" role="alert">{props.error}</p> : null}
      <OpenInApp code={props.code} as="link" />
    </WebPage>
  );
}

/** Email + password, create or sign in. No username here: the pick-username step asks. */
export function EmailFormScreen(props: {
  mode: 'create' | 'signin';
  notice: Notice | null;
  initialEmail: string;
  error: string | null;
  /** The sign-in was refused because the email was never confirmed: offer "Send again". */
  unconfirmed: boolean;
  busy: boolean;
  onSubmit: (email: string, password: string) => void;
  onToggleMode: () => void;
  onResend: (email: string, password: string) => void;
}) {
  const [email, setEmail] = useState(props.initialEmail);
  const [password, setPassword] = useState('');
  const create = props.mode === 'create';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    props.onSubmit(email.trim(), password);
  };
  return (
    <WebPage>
      <h1 className="obw__title">{create ? WEB_COPY.createAccount : WEB_COPY.signIn}</h1>
      <NoticeLine notice={props.notice} />
      <form className="obw__form" onSubmit={submit} noValidate>
        <div className="obw__field">
          <label htmlFor="obw-email">{WEB_COPY.emailLabel}</label>
          <input id="obw-email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
            value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={props.error ? true : undefined} />
        </div>
        <div className="obw__field">
          <label htmlFor="obw-password">{WEB_COPY.passwordLabel}</label>
          <input id="obw-password" type="password" autoComplete={create ? 'new-password' : 'current-password'}
            value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={props.error ? true : undefined} />
        </div>
        {create ? (
          <ul className="obw__rules">
            {PASSWORD_REQUIREMENTS.map((r) => (
              <li key={r.id} data-ok={r.test(password)}>{r.label}</li>
            ))}
          </ul>
        ) : null}
        {props.error ? <p className="obw__error" role="alert">{props.error}</p> : null}
        <button type="submit" className="obw__btn" disabled={props.busy}>{create ? WEB_COPY.createAccount : WEB_COPY.signIn}</button>
        {props.unconfirmed ? (
          <button type="button" className="obw__link" disabled={props.busy} onClick={() => props.onResend(email.trim(), password)}>{WEB_COPY.resend}</button>
        ) : null}
      </form>
      {create ? null : <p className="obw__plain">{WEB_COPY.forgotInApp}</p>}
      <button type="button" className="obw__link" onClick={props.onToggleMode}>
        {create ? WEB_COPY.haveAccount : WEB_COPY.newHere} <b>{create ? WEB_COPY.signIn : WEB_COPY.createAnAccount}</b>
      </button>
    </WebPage>
  );
}

export function CheckEmailScreen(props: {
  email: string;
  league: string | null;
  error: string | null;
  busy: boolean;
  onResend: () => void;
  onBack: () => void;
}) {
  return (
    <WebPage>
      <h1 className="obw__title">{WEB_COPY.checkEmailTitle}</h1>
      <p className="obw__sub">{props.league ? WEB_COPY.confirmSentInvite(props.email, props.league) : WEB_COPY.confirmSentPlain(props.email)}</p>
      {props.error ? <p className="obw__error" role="alert">{props.error}</p> : null}
      <div className="obw__stack">
        <button type="button" className="obw__btn obw__btn--line" disabled={props.busy} onClick={props.onResend}>{WEB_COPY.resend}</button>
        <button type="button" className="obw__link" onClick={props.onBack}>{WEB_COPY.checkEmailBack}</button>
      </div>
    </WebPage>
  );
}

/** Pick a username: a gamertag pre-filled, "Keep" the primary action, "Change" opens the field. */
export function UsernameScreen(props: {
  initial: string;
  /** "✓ EMAIL CONFIRMED" above the title when the confirmation link brought the person back. */
  confirmedChip: boolean;
  /** Resolves to the line to show, or null when the username was set. */
  onSubmit: (name: string) => Promise<string | null>;
  onSignOut: () => void;
}) {
  const [value, setValue] = useState(props.initial);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);

  const keep = async () => {
    const failing = firstFailingRule(value);
    if (failing) {
      setEditing(true);
      setError(failing);
      return;
    }
    setBusy(true);
    const line = await props.onSubmit(value);
    setBusy(false);
    if (line) {
      setError(line);
      setEditing(true);
    }
  };

  return (
    <WebPage>
      {props.confirmedChip ? <span className="obw__chip">{WEB_COPY.confirmedChip}</span> : null}
      <div className="obw__stack">
        <h1 className="obw__title">{WEB_COPY.usernameTitle}</h1>
        <p className="obw__sub">{WEB_COPY.usernameSub}</p>
      </div>
      <div className="obw__field">
        <label htmlFor="obw-username">{WEB_COPY.usernameLabel}</label>
        <input id="obw-username" ref={input} type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={20}
          value={value} readOnly={!editing} aria-invalid={error ? true : undefined}
          onChange={(e) => { setValue(e.target.value); setError(null); }} />
        {error ? <p className="obw__error" role="alert">{error}</p> : <p className="obw__helper">{WEB_COPY.usernameHelper}</p>}
      </div>
      <div className="obw__stack">
        <button type="button" className="obw__btn" disabled={busy} onClick={keep}>{WEB_COPY.keep}</button>
        {editing ? null : (
          <button type="button" className="obw__btn obw__btn--line" disabled={busy} onClick={() => setEditing(true)}>{WEB_COPY.change}</button>
        )}
      </div>
      <SignOutButton onClick={props.onSignOut} />
    </WebPage>
  );
}

/** "You're in {league}." + "Get the app to draft and play." (approved, plan Decision 10). */
export function DoneScreen({ title, showSub = true }: { title: string; showSub?: boolean }) {
  return (
    <WebPage center>
      <span className="obw__disc" aria-hidden="true">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d={CHECK} /></svg>
      </span>
      <div className="obw__stack">
        <h1 className="obw__title">{title}</h1>
        {showSub ? <p className="obw__sub">{WEB_COPY.getTheApp}</p> : null}
      </div>
      <AppStoreBadge />
    </WebPage>
  );
}

export { Busy };
