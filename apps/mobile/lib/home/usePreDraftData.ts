/**
 * usePreDraftData: PreDraftCard's own data fetch (get_draft_order +
 * get_league_display_names), extracted out of the component so the
 * DEV-ONLY fixture seam lives in a hook, not the component (Design Lead
 * ruling, 2026-09-30: states 6-waiting and 7 need real captures, and
 * PreDraftCard/DraftingCard's own direct Supabase calls -- unlike Home's
 * own useHomeLeague -- had no fixture path at all).
 *
 * PRODUCTION PATH IS UNCHANGED: when HOME_FIXTURE is unset (every real
 * user, and every __DEV__=false release build, where HOME_FIXTURE is
 * `null` unconditionally), this hook's effect is byte-for-byte the
 * `Promise.all([get_draft_order, get_league_display_names])` call
 * PreDraftCard used to make directly, with the same params, same
 * response parsing (parseDraftOrder), same state shape. Proof: the
 * `!HOME_FIXTURE` branch below is that exact code, unedited except for
 * being moved into this file; a diff against the pre-extraction
 * PreDraftCard.tsx (git show HEAD~1:components/home/PreDraftCard.tsx)
 * shows only the fixture branch as new.
 */
import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';
import { parseDraftOrder } from '@/lib/draftOrder';
import { HOME_FIXTURE } from './devFixture';

export interface PreDraftMember {
  userId: string;
  displayName: string;
  isBot: boolean;
}

export interface PreDraftData {
  waiting: boolean | null;
  orderRevealed: string[] | null;
  members: PreDraftMember[];
  loading: boolean;
}

/** "3 of 4 joined, so the order isn't set yet" (Design Lead capture spec,
 * 2026-09-30) -- the board's own pre-draft-waiting sample. */
function fixturePreDraftWaiting(): PreDraftData {
  return {
    waiting: true,
    orderRevealed: null,
    members: [
      { userId: 'roberto', displayName: 'Roberto B.', isBot: false },
      { userId: 'paolo', displayName: 'Paolo M.', isBot: false },
      { userId: 'gianluigi', displayName: 'Gianluigi B.', isBot: false },
    ],
    loading: false,
  };
}

export function usePreDraftData(leagueId: string): PreDraftData {
  const [waiting, setWaiting] = useState<boolean | null>(null);
  const [orderRevealed, setOrderRevealed] = useState<string[] | null>(null);
  const [members, setMembers] = useState<PreDraftMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (HOME_FIXTURE === 'pre_draft_waiting') {
      const fx = fixturePreDraftWaiting();
      setWaiting(fx.waiting);
      setOrderRevealed(fx.orderRevealed);
      setMembers(fx.members);
      setLoading(false);
      return;
    }
    if (HOME_FIXTURE === 'pre_draft') {
      // The plain pre-draft capture: order not yet revealed, not waiting
      // on more members either -- the board's "before the draft" sample
      // with no order/waiting line shown at all.
      setWaiting(false);
      setOrderRevealed(null);
      setMembers([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      const [{ data: orderRaw }, { data: namesRaw }] = await Promise.all([
        supabase.rpc('get_draft_order', { p_league_id: leagueId }),
        supabase.rpc('get_league_display_names', { p_league_id: leagueId }),
      ]);
      if (cancelled) return;
      const parsed = parseDraftOrder(orderRaw);
      setWaiting(parsed?.waitingForMembers ?? null);
      setOrderRevealed(parsed?.order ?? null);
      const names = (namesRaw ?? []) as { user_id: string; display_name: string; is_bot: boolean }[];
      setMembers(names.map((n) => ({ userId: n.user_id, displayName: n.display_name, isBot: n.is_bot })));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  return { waiting, orderRevealed, members, loading };
}
