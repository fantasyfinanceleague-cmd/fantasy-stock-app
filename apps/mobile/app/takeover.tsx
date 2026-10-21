import { useCallback, useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';

import { TakeoverLanding, type TakeoverLandingState } from '@/components/shell/TakeoverLanding';
import { previewTakeover, takeOverTeam } from '@/lib/account/accountApi';
import { useDeletedManagerLabel } from '@/lib/account/deletedLabelStore';
import type { TakeoverPreview } from '@/lib/account/takeoverView';
import { useLeagueContext } from '@/lib/LeagueContext';
import { pendingTakeover, useTakeoverSnapshot } from '@/lib/invite/pendingTakeoverStore';

// Account deletion (W4) — the takeover landing's container. Opened by app/_layout.tsx for the PENDING TAKEOVER
// (lib/invite/pendingTakeover.ts), once per code per launch, once the person is in the full app. It previews the seat
// (join-league `takeover_preview`: league, record, rank), waits for the tap, and only "Take the team" writes
// (`takeover`). Every definitive answer clears the pending link; a lost answer keeps it and waits for a tap.
export default function TakeoverScreen() {
  const snap = useTakeoverSnapshot();
  const code = snap.code;
  const label = useDeletedManagerLabel();
  const { refresh, setActiveLeagueId } = useLeagueContext();
  const [view, setView] = useState<TakeoverLandingState>({ kind: 'loading' });
  const [takeFailed, setTakeFailed] = useState<'unreachable' | 'rate_limited' | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const home = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  }, []);

  const settle = useCallback(async (v: TakeoverPreview) => {
    if (!alive.current) return;
    if (v.kind === 'member') {
      if (code) await pendingTakeover.clear(code);
      router.replace('/(tabs)'); // already in this league: the app just opens
      return;
    }
    if (v.kind === 'taken' || v.kind === 'dead') if (code) await pendingTakeover.clear(code);
    if (alive.current) setView(v);
  }, [code]);

  const load = useCallback(async () => {
    if (!code) return;
    setView({ kind: 'loading' });
    await settle(await previewTakeover(code));
  }, [code, settle]);
  useEffect(() => { void load(); }, [load]);

  const take = useCallback(async () => {
    if (view.kind !== 'found' || !code) return;
    setTakeFailed(null);
    setView({ kind: 'taking', found: view });
    const r = await takeOverTeam(code);
    if (!alive.current) return;
    if (r.kind === 'taken_over') {
      await pendingTakeover.clear(code);
      await refresh();
      // The reply names the league: open it (the person just chose to take this team).
      if (r.leagueId) setActiveLeagueId(r.leagueId);
      router.replace('/(tabs)');
      return;
    }
    if (r.kind === 'unknown' || r.kind === 'rate_limited') {
      setTakeFailed(r.kind === 'rate_limited' ? 'rate_limited' : 'unreachable');
      setView(view); // keep the link; the person's tap retries (no loop)
      return;
    }
    await settle(r);
  }, [view, code, refresh, settle]);

  const notNow = useCallback(async () => {
    if (code) await pendingTakeover.clear(code);
    home();
  }, [code, home]);

  return <TakeoverLanding state={view} label={label} onTake={take} onNotNow={notNow} onHome={home} onRetry={load} takeFailed={takeFailed} />;
}
