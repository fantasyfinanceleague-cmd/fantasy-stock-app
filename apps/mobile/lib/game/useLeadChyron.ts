/**
 * useLeadChyron (3c, G2): the chyron for a LEAD CHANGE. It watches the live
 * leader and each stock's contribution, and when the lead flips (at most one
 * per 30 s, by detectLeadChange), it names the stock that moved the game most.
 * It never fires on the first read or a tie. The text is leadChangeChyron's.
 */
import { useEffect, useRef, useState } from 'react';
import { detectLeadChange, pickMover, dayMovePct, type Leader } from './leadChange';
import { leadChangeChyron } from './gameCopy';
import type { MatchupLiveViewModel } from './buildMatchupViewModel';
import type { BarsBySymbol } from '../home/buildHomeViewModel';

interface Memory {
  leader: Leader | null;
  bySymbol: Record<string, number>;
  firedAt: number | null;
}

export function useLeadChyron(
  live: MatchupLiveViewModel | null,
  quote: (symbol: string) => number | null,
  bars: BarsBySymbol,
  todayIso: string,
): string | null {
  const memory = useRef<Memory>({ leader: null, bySymbol: {}, firedAt: null });
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!live || !live.opp || !live.leader) return;
    const now = Date.now();
    const bySymbol: Record<string, number> = {};
    for (const row of live.me.lineup) bySymbol[row.symbol] = row.cents / 100;
    const prev = memory.current;

    if (detectLeadChange(prev.leader, live.leader, now, prev.firedAt)) {
      const mover = pickMover(prev.bySymbol, bySymbol);
      if (mover !== null) {
        const leaderName = live.leader === 'me' ? live.me.name : live.opp.name;
        setMessage(leadChangeChyron({ symbol: mover, dayPct: dayMovePct(bars, quote, mover, todayIso), leaderName }));
        memory.current = { leader: live.leader, bySymbol, firedAt: now };
        return;
      }
    }
    memory.current = { leader: live.leader, bySymbol, firedAt: prev.firedAt };
  }, [live, quote, bars, todayIso]);

  return message;
}
