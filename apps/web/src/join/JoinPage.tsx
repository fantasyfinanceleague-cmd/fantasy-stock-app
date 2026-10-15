import { useEffect, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
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
  const { state } = useLocation();
  const code = normalizeInviteCode(raw);
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
    return <JoinFlow key={view.code} code={view.code} name={view.name} inviter={view.inviter} handoff={readHandoff(state)} />;
  }
  return <JoinView state={view} />;
}
