import { useCallback, useEffect, useRef, useState } from 'react';
import { failingPasswordRequirements } from '@fantasy-stock/shared/constants';
import { getAuthErrorMessage, isEmailNotConfirmedError } from './authErrors';
import { CheckEmailScreen, DoneScreen, EmailFormScreen, SignInScreen, UsernameScreen, type Notice } from './FlowScreens';
import { JoinView, Busy, WebPage } from './JoinView';
import { WEB_COPY, type JoinBlock, type JoinErrorKind } from './joinCopy';
import {
  checkUsernames,
  currentSession,
  joinWithSession,
  previewWithSession,
  readOwnUsername,
  setUsername,
  signInWithEmail,
  signInWithProvider,
  signOutLocal,
  signUpWithEmail,
  type AuthFailure,
} from './onboardingAuth';
import { previewRows, type PreviewRow } from './previewData';
import { suggestGamertag } from './gamertag';

/** A notice the web callback hands back to /join (router state: only these words, never a message). */
export type FlowNotice = 'confirmed-sign-in' | 'expired' | 'paused' | 'generic';

/** What /auth/web-callback hands /join through the router's location state. */
export interface FlowHandoff {
  notice?: FlowNotice;
  /** The link confirmed the email and signed this browser in. */
  emailConfirmed?: boolean;
  /**
   * THIS visit produced the sign-in (a confirmation link or a Google/Apple return, both
   * through /auth/web-callback, which can only hand this over via the router's own state).
   * Only then does an existing session carry straight on to the join.
   */
  signedIn?: boolean;
}

export function noticeFor(notice: FlowNotice | undefined): Notice | null {
  switch (notice) {
    case 'confirmed-sign-in':
      return { tone: 'info', text: WEB_COPY.confirmedSignIn };
    case 'expired':
      return { tone: 'warn', text: WEB_COPY.webLinkExpired };
    case 'paused':
      return { tone: 'warn', text: WEB_COPY.signupsPaused };
    case 'generic':
      return { tone: 'warn', text: WEB_COPY.generic };
    default:
      return null;
  }
}

type Stage =
  | { s: 'boot' }
  | { s: 'options' }
  | { s: 'email'; mode: 'create' | 'signin' }
  | { s: 'check-email'; email: string }
  | { s: 'username'; suggestion: string }
  | { s: 'joining' }
  | { s: 'failed'; error: JoinErrorKind }
  // Terminal: the session ends here (signOutLocal), the web's only job is done.
  | { s: 'dead' }
  | { s: 'refused'; name: string; block: JoinBlock }
  | { s: 'member'; name: string; rows: PreviewRow[] | null }
  | { s: 'in'; name: string; rows: PreviewRow[] | null };

const TERMINAL = new Set<Stage['s']>(['dead', 'refused', 'member', 'in']);

/** The web sign-in and join. The invite is `code`; `name` / `inviter` come from the no-session preview (null when unavailable). */
export default function JoinFlow(props: { code: string; name: string | null; inviter: string | null; handoff?: FlowHandoff | null }) {
  const { code, name, inviter } = props;
  const [stage, setStage] = useState<Stage>({ s: 'boot' });
  const [notice, setNotice] = useState<Notice | null>(() => noticeFor(props.handoff?.notice));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'apple' | 'google' | 'form' | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [chip, setChip] = useState<boolean>(props.handoff?.emailConfirmed === true);
  // Kept in memory ONLY so "Send again" can repeat signUp; never stored.
  const credentials = useRef<{ email: string; password: string } | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const set = useCallback((next: Stage) => { if (alive.current) setStage(next); }, []);

  /** The league is joined, refused or gone: end this browser's session, forget the invite. */
  useEffect(() => {
    if (TERMINAL.has(stage.s)) void signOutLocal();
  }, [stage.s]);

  const joinNow = useCallback(async () => {
    set({ s: 'joining' });
    const preview = await previewWithSession(code);
    if (preview.kind === 'error') return set({ s: 'failed', error: preview.error });
    if (preview.kind === 'bad_code') return set({ s: 'dead' });
    const { league, block } = preview;
    if (block === 'already_member') return set({ s: 'member', name: league.name, rows: previewRows(league, null) });
    if (block) return set({ s: 'refused', name: league.name, block });
    // The preview said joinable; join-league is the only truth (the league can change in between).
    const joined = await joinWithSession(code);
    if (joined.kind === 'error') return set({ s: 'failed', error: joined.error });
    if (joined.kind === 'refused') {
      if (joined.block === 'already_member') return set({ s: 'member', name: league.name, rows: previewRows(league, null) });
      return set({ s: 'refused', name: league.name, block: joined.block });
    }
    // Joined. The facts are readable now (C1): fetch them AFTER the join, so Managers counts this person.
    // A failed fetch is not a failed join: the card is simply absent.
    const facts = await previewWithSession(code);
    const rows = facts.kind === 'found' ? previewRows(facts.league, null) : null;
    return set({ s: 'in', name: joined.leagueName, rows });
  }, [code, set]);

  const afterSignIn = useCallback(async (userId: string) => {
    const username = await readOwnUsername(userId);
    // Fail open like the app: a failed read must not strand someone on a username screen.
    if (username !== null) return void (await joinNow());
    // A gamertag the server says is free (the app's generator, mirrored), or the plain form: an empty
    // field to type in. Never a name nobody checked.
    const tag = await suggestGamertag(checkUsernames);
    set({ s: 'username', suggestion: tag ?? '' });
  }, [joinNow, set]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const session = await currentSession();
      if (cancelled) return;
      if (session && props.handoff?.signedIn) return void (await afterSignIn(session.userId));
      // A session found COLD (an abandoned flow, a shared computer) never joins a league on its own:
      // anyone could send that person an invite link. It is ended, and the person signs in again.
      if (session) await signOutLocal();
      if (cancelled) return;
      set(props.handoff?.notice === 'confirmed-sign-in' ? { s: 'email', mode: 'signin' } : { s: 'options' });
    })();
    return () => { cancelled = true; };
    // Once, on arrival: later transitions are driven by the screens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signOut = useCallback(async () => {
    credentials.current = null;
    await signOutLocal();
    setChip(false);
    setError(null);
    set({ s: 'options' });
  }, [set]);

  const provider = async (which: 'apple' | 'google') => {
    setError(null);
    setNotice(null);
    setBusy(which);
    const { error: err } = await signInWithProvider(which, code);
    // Success navigates away to the provider; only a failure comes back here.
    if (err && alive.current) {
      setBusy(null);
      setError(getAuthErrorMessage(err));
    }
  };

  const describe = (err: AuthFailure) => getAuthErrorMessage(err, WEB_COPY.passwordRule);

  const submitEmail = async (mode: 'create' | 'signin', email: string, password: string) => {
    setError(null);
    setNotice(null);
    setUnconfirmed(false);
    if (mode === 'create') {
      const failing = failingPasswordRequirements(password);
      if (failing.length > 0) return setError(WEB_COPY.passwordNeeds(failing.map((r) => r.label)));
    }
    setBusy('form');
    credentials.current = { email, password };
    if (mode === 'create') {
      const res = await signUpWithEmail(email, password, code);
      if (!alive.current) return;
      setBusy(null);
      if (res.error) return setError(describe(res.error));
      if (res.needsConfirmation) return set({ s: 'check-email', email });
    } else {
      const res = await signInWithEmail(email, password);
      if (!alive.current) return;
      if (res.error) {
        setBusy(null);
        setUnconfirmed(isEmailNotConfirmedError(res.error));
        return setError(describe(res.error));
      }
    }
    const session = await currentSession();
    if (!alive.current) return;
    setBusy(null);
    credentials.current = null; // the password has done its job
    if (session) await afterSignIn(session.userId);
    else setError(WEB_COPY.generic);
  };

  const resend = async (email: string, password: string) => {
    setError(null);
    setBusy('form');
    const res = await signUpWithEmail(email, password, code);
    if (!alive.current) return;
    setBusy(null);
    if (res.error) setError(describe(res.error));
  };

  const submitUsername = async (value: string): Promise<string | null> => {
    const checked = await checkUsernames([value]);
    const status = checked?.find((r) => r.username.toLowerCase() === value.toLowerCase())?.status;
    if (status === 'taken') return WEB_COPY.usernameTaken;
    if (status === 'invalid') return WEB_COPY.usernameNotAllowed;
    const result = await setUsername(value);
    if (result === 'taken') return WEB_COPY.usernameTaken;
    if (result === 'invalid') return WEB_COPY.usernameNotAllowed;
    if (result === null) return WEB_COPY.usernameCheckFailed;
    setChip(false);
    void joinNow();
    return null;
  };

  switch (stage.s) {
    case 'boot':
    case 'joining':
      return <WebPage><Busy /></WebPage>;
    case 'options':
      return (
        <SignInScreen
          name={name} inviter={inviter} notice={notice} error={error}
          busy={busy === 'apple' || busy === 'google' ? busy : null}
          onApple={() => void provider('apple')}
          onGoogle={() => void provider('google')}
          onEmail={() => { setError(null); setNotice(null); set({ s: 'email', mode: 'create' }); }}
        />
      );
    case 'email':
      return (
        <EmailFormScreen
          key={stage.mode}
          mode={stage.mode} notice={notice} initialEmail={credentials.current?.email ?? ''} error={error} unconfirmed={unconfirmed} busy={busy === 'form'}
          onSubmit={(email, password) => void submitEmail(stage.mode, email, password)}
          onToggleMode={() => { setError(null); setNotice(null); setUnconfirmed(false); set({ s: 'email', mode: stage.mode === 'create' ? 'signin' : 'create' }); }}
          onResend={(email, password) => void resend(email, password)}
        />
      );
    case 'check-email':
      return (
        <CheckEmailScreen
          email={stage.email} league={name} error={error} busy={busy === 'form'}
          onResend={() => void resend(stage.email, credentials.current?.password ?? '')}
          onBack={() => { setError(null); set({ s: 'email', mode: 'signin' }); }}
        />
      );
    case 'username':
      return <UsernameScreen initial={stage.suggestion} confirmedChip={chip} onSubmit={submitUsername} onSignOut={() => void signOut()} />;
    case 'failed':
      return <JoinView state={{ kind: 'failed', error: stage.error, onSignOut: () => void signOut() }} />;
    case 'dead':
      return <JoinView state={{ kind: 'dead' }} />;
    case 'refused':
      return <JoinView state={{ kind: 'refused', name: stage.name, inviter, block: stage.block }} />;
    case 'member':
      return <DoneScreen title={WEB_COPY.alreadyIn(stage.name)} rows={stage.rows} />;
    case 'in':
      return <DoneScreen title={WEB_COPY.youreIn(stage.name)} rows={stage.rows} />;
  }
}
