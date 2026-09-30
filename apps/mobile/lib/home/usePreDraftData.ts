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
  /** draft_date - 1h, or the later time the order actually finalized
   * (DraftOrderInfo.finalizeAt) -- board: "Draft order set Sat 6:00 PM
   * ET, an hour before the draft". Null while `waiting` is true (there is
   * no set time yet to show -- OrderWaiting's own bar covers that case). */
  finalizeAt: string | null;
  memberCount: number;
  minMembers: number;
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
    finalizeAt: null,
    memberCount: 3,
    minMembers: 4,
  };
}

/** The board's plain "before the draft" sample: the order IS set (board
 * always shows the order-set line in this variant), well short of the
 * league's full roster. */
function fixturePreDraft(): PreDraftData {
  return {
    waiting: false,
    orderRevealed: ['roberto', 'paolo', 'gianluigi'],
    members: [
      { userId: 'roberto', displayName: 'Roberto B.', isBot: false },
      { userId: 'paolo', displayName: 'Paolo M.', isBot: false },
      { userId: 'gianluigi', displayName: 'Gianluigi B.', isBot: false },
      { userId: 'luca', displayName: 'Luca V.', isBot: false },
      { userId: 'chiara', displayName: 'Chiara R.', isBot: false },
      { userId: 'marco', displayName: 'Marco T.', isBot: false },
    ],
    loading: false,
    finalizeAt: '2026-10-03T22:00:00.000Z', // Sat 6:00 PM ET, an hour before
    memberCount: 6,
    minMembers: 4,
  };
}

const EMPTY: PreDraftData = { waiting: null, orderRevealed: null, members: [], loading: true, finalizeAt: null, memberCount: 0, minMembers: 0 };

export function usePreDraftData(leagueId: string): PreDraftData {
  const [data, setData] = useState<PreDraftData>(EMPTY);

  useEffect(() => {
    if (HOME_FIXTURE === 'pre_draft_waiting') {
      setData(fixturePreDraftWaiting());
      return;
    }
    if (HOME_FIXTURE === 'pre_draft') {
      setData(fixturePreDraft());
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
      const names = (namesRaw ?? []) as { user_id: string; display_name: string; is_bot: boolean }[];
      setData({
        waiting: parsed?.waitingForMembers ?? null,
        orderRevealed: parsed?.order ?? null,
        members: names.map((n) => ({ userId: n.user_id, displayName: n.display_name, isBot: n.is_bot })),
        loading: false,
        finalizeAt: parsed?.finalizeAt ?? null,
        memberCount: parsed?.memberCount ?? 0,
        minMembers: parsed?.minMembers ?? 0,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  return data;
}
