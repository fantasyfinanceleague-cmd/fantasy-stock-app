import { useState } from 'react';

import { RenewalAsk } from '@/components/game/RenewalAsk';
import { useRenewalRoster } from '@/lib/game/useRenewalRoster';
import { screenFor, showsHomeRenewalAsk } from '@/lib/game/renewal';

// 3c-2 (Design Lead; board #run-it-back frame 1): the member's "Are you in for
// Season 2?" ask on Home, next to the commissioner-only RunItBackCard. It reads
// the Season 2 roster and shows only while this member is still asked; after
// they answer, the roster is re-read and the card goes. The same RenewalAsk
// the League tab mounts (LeagueRenewal).

export interface HomeRenewalAskProps {
  successorId: string;
  isCommissioner: boolean;
  commissionerName: string;
}

export function HomeRenewalAsk({ successorId, isCommissioner, commissionerName }: HomeRenewalAskProps) {
  const [key, setKey] = useState(0);
  const st = useRenewalRoster(isCommissioner ? null : successorId, null, key);
  const screen = st.status === 'ready' && st.roster ? screenFor(st.roster) : null;
  if (!showsHomeRenewalAsk({ isCommissioner, successorId, screen })) return null;
  return <RenewalAsk leagueId={successorId} commissionerName={commissionerName} onAnswered={() => setKey((k) => k + 1)} />;
}
