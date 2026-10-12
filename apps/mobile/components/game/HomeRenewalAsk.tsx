import { useState } from 'react';
import { router } from 'expo-router';

import { RenewalAsk } from '@/components/game/RenewalAsk';
import { RENEWAL_FIXTURE_CALLER, useRenewalRoster } from '@/lib/game/useRenewalRoster';
import { afterAskAnswer, renewalAskAnswer, screenFor, showsHomeRenewalAsk } from '@/lib/game/renewal';
import { useLeagueContext } from '@/lib/LeagueContext';

// 3c-2 (Design Lead; board #run-it-back frame 1): the member's "Are you in for
// Season 2?" ask on the finished league's Home and League tab, next to the
// commissioner-only Run it back card/strip. It reads the Season 2 roster and
// shows while this member is still asked: no reply yet, or I'm out (GS-14, the
// answer marked, so they can get back in until the draft is set). I'm in opens
// Season 2's list; a removed player never gets it. The same RenewalAsk the
// renewed league's League tab mounts (LeagueRenewal).

export interface HomeRenewalAskProps {
  successorId: string;
  isCommissioner: boolean;
  commissionerName: string;
}

export function HomeRenewalAsk({ successorId, isCommissioner, commissionerName }: HomeRenewalAskProps) {
  const [key, setKey] = useState(0);
  const { refresh, setActiveLeagueId } = useLeagueContext();
  const st = useRenewalRoster(isCommissioner ? null : successorId, isCommissioner ? null : RENEWAL_FIXTURE_CALLER, key);
  const screen = st.status === 'ready' && st.roster ? screenFor(st.roster) : null;
  if (!showsHomeRenewalAsk({ isCommissioner, successorId, screen })) return null;
  const onAnswered = async (response: 'in' | 'out') => {
    if (afterAskAnswer(response) === 'reread') {
      setKey((k) => k + 1);
      return;
    }
    // Season 2 is one of their leagues only now: re-read the list, then open it.
    await refresh();
    setActiveLeagueId(successorId);
    router.push('/(tabs)/league');
  };
  return (
    <RenewalAsk
      leagueId={successorId}
      commissionerName={commissionerName}
      answered={st.roster ? renewalAskAnswer(st.roster) : null}
      onAnswered={(r) => void onAnswered(r)}
    />
  );
}
