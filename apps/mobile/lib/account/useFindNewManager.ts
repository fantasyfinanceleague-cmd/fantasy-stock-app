import { useCallback, useState } from 'react';
import { Share } from 'react-native';

import { takeoverShareMessage } from '../invite/takeoverLink';
import { createTakeoverInvite } from './accountApi';

/**
 * Account deletion (W4): "Find a new manager". Asks the server for the seat's takeover code (the pending one is
 * reused), then opens the share sheet with "Take over a team in {league}" and the link. One request at a time; a code
 * that can't be a link (or a failed call) is a plain "couldn't" line, never an empty share sheet.
 */
export function useFindNewManager(leagueId: string | null, leagueName: string) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const find = useCallback(
    async (seatUserId: string) => {
      if (!leagueId || busyId) return;
      setBusyId(seatUserId);
      setFailed(false);
      const code = await createTakeoverInvite(leagueId, seatUserId);
      const message = code ? takeoverShareMessage(leagueName, code) : null;
      setBusyId(null);
      if (!message) {
        setFailed(true);
        return;
      }
      try {
        await Share.share({ message });
      } catch {
        // The sheet failing to open is not the link failing: nothing to say.
      }
    },
    [leagueId, leagueName, busyId],
  );
  return { busyId, failed, find };
}
