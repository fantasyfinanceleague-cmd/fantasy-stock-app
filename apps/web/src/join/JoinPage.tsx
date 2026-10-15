import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { normalizeInviteCode } from './inviteCode';
import { fetchInvitePreview, type InvitePreview } from './invitePreview';
import { JoinView, type JoinViewState } from './JoinView';

/** What the page shows for a code and (once it arrives) the no-session preview. */
export function joinStateFor(rawCode: string | undefined, preview: InvitePreview | null): JoinViewState {
  const code = normalizeInviteCode(rawCode);
  if (!code) return { kind: 'bad_code' };
  if (preview === null) return { kind: 'loading' };
  if (preview.kind === 'not_found') return { kind: 'not_found' };
  if (preview.kind === 'found') {
    return { kind: 'invited', code, name: preview.name, inviter: preview.inviter, block: preview.block };
  }
  return { kind: 'invited', code, name: null, inviter: null, block: null };
}

/**
 * /join/:code, rendered while APP_PAUSED too (App.jsx). The code is checked
 * before anything uses it: junk gets the app's "no league has that code" line
 * with no network call. A well-formed code asks the no-session preview for the
 * league name and inviter; any failure falls back to "You're invited to a
 * league" (invitePreview.ts never throws).
 */
export default function JoinPage() {
  const { code: raw } = useParams();
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
  return <JoinView state={joinStateFor(raw, preview)} />;
}
