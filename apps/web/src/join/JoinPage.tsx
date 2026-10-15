import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import JoinFlow, { type FlowHandoff, type FlowNotice } from './JoinFlow';
import { normalizeInviteCode } from './inviteCode';
import { fetchInvitePreview, type InvitePreview } from './invitePreview';
import { JoinView, type JoinViewState } from './JoinView';

/** What /join/:code shows for a code and (once it arrives) the no-session preview. */
export type JoinPageState =
  | JoinViewState
  /** Joinable, or the preview is unavailable (`name` null): the sign-in flow takes over. */
  | { kind: 'invited'; code: string; name: string | null; inviter: string | null };

export function joinStateFor(rawCode: string | undefined, preview: InvitePreview | null): JoinPageState {
  const code = normalizeInviteCode(rawCode);
  if (!code) return { kind: 'dead' };
  if (preview === null) return { kind: 'loading' };
  if (preview.kind === 'not_found') return { kind: 'dead' };
  if (preview.kind === 'found') {
    // A league that won't take players is not worth an account: say so, offer the app, no sign-in.
    if (preview.block) return { kind: 'refused', name: preview.name, inviter: preview.inviter, block: preview.block, signIn: true };
    return { kind: 'invited', code, name: preview.name, inviter: preview.inviter };
  }
  return { kind: 'invited', code, name: null, inviter: null };
}

const NOTICES: readonly FlowNotice[] = ['confirmed-sign-in', 'expired', 'paused', 'generic'];

/** The router state /auth/web-callback hands back: only known words, never a message. */
export function readHandoff(state: unknown): FlowHandoff | null {
  if (state === null || typeof state !== 'object') return null;
  const s = state as { notice?: unknown; emailConfirmed?: unknown; signedIn?: unknown };
  const notice = NOTICES.find((n) => n === s.notice);
  const emailConfirmed = s.emailConfirmed === true;
  const signedIn = s.signedIn === true || emailConfirmed;
  return notice || emailConfirmed || signedIn ? { notice, emailConfirmed, signedIn } : null;
}

/**
 * /join/:code, rendered while APP_PAUSED too (App.jsx). The code is checked
 * before anything uses it: a malformed one is a dead link, with no network
 * call. A well-formed code asks the no-session preview for the league name and
 * inviter (any failure falls back to "You're invited to a league"), then the
 * web sign-in and join take over.
 */
export default function JoinPage() {
  const { code: raw } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const code = normalizeInviteCode(raw);
  // Read ONCE, then wiped from the history entry: a handoff that said "this visit signed in"
  // must not outlive the visit (Back or a reload into an old entry, on a shared computer,
  // would otherwise carry an abandoned session straight on to the join). A reload mid-flow
  // therefore reads as cold: the session ends and the person signs in again.
  const [handoff] = useState(() => readHandoff(location.state));
  useEffect(() => {
    if (location.state !== null && location.state !== undefined) {
      navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null });
    }
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [loaded, setLoaded] = useState<{ code: string; preview: InvitePreview } | null>(null);

  useEffect(() => {
    if (!code) return;
    const abort = new AbortController();
    fetchInvitePreview(code, { signal: abort.signal }).then((preview) => {
      if (!abort.signal.aborted) setLoaded({ code, preview });
    });
    return () => abort.abort();
  }, [code]);

  const preview = loaded && loaded.code === code ? loaded.preview : null;
  const view = joinStateFor(raw, preview);
  if (view.kind === 'invited') {
    return <JoinFlow key={view.code} code={view.code} name={view.name} inviter={view.inviter} handoff={handoff} />;
  }
  return <JoinView state={view} />;
}
