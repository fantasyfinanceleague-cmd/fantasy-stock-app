/**
 * useDraftingData: DraftingCard's own data fetch (get_draft_clock +
 * get_draft_order + the drafts table), extracted out of the component so
 * the DEV-ONLY fixture seam lives in a hook, not the component (Design
 * Lead ruling, 2026-09-30 — see usePreDraftData.ts's matching doc).
 *
 * PRODUCTION PATH IS UNCHANGED: when HOME_FIXTURE is unset, this hook's
 * effect is byte-for-byte the `Promise.all([get_draft_clock,
 * get_draft_order, drafts select])` call DraftingCard used to make
 * directly, with the same params, same response parsing, same state
 * shape. Proof: the `!HOME_FIXTURE` branch below is that exact code,
 * unedited except for being moved into this file; a diff against the
 * pre-extraction DraftingCard.tsx (git show HEAD~1:components/home/DraftingCard.tsx)
 * shows only the fixture branch as new.
 */
import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';
import { parseDraftOrder } from '@/lib/draftOrder';
import { HOME_FIXTURE } from './devFixture';

export interface DraftClockState {
  pickSeconds: number;
  picksMade: number;
  deadlineAt: string | null;
  serverNow: string;
}

export interface DraftingData {
  clock: DraftClockState | null;
  order: string[] | null;
  myPickCount: number;
}

/** A 6-manager snake order with `myUserId` (the caller's own id) seeded
 * at position 2 — round 1 pick 2, round 2 pick 5 (reversed) — so both
 * capture variants land on the exact examples in the Design Lead's spec:
 * "Round 2 - Pick 11 - 0:42 left" (on the clock) and "... up in 4 picks"
 * (waiting). */
function fixtureOrder(myUserId: string): string[] {
  return ['fx-p1', myUserId, 'fx-p3', 'fx-p4', 'fx-p5', 'fx-p6'];
}

function fixtureDraftingData(fixture: 'drafting_on_clock' | 'drafting_waiting_turn', myUserId: string): DraftingData {
  const order = fixtureOrder(myUserId);
  if (fixture === 'drafting_on_clock') {
    // Round 2, overall pick 11 (0-based picksMade 10) -- round 2 is
    // reversed, so position 2 (myUserId) is 5th from the end, landing
    // exactly on pick 11 of a 6-team order.
    return {
      clock: { pickSeconds: 60, picksMade: 10, deadlineAt: '2026-10-03T20:00:42.000Z', serverNow: '2026-10-03T20:00:00.000Z' },
      order,
      myPickCount: 1, // picked once already, in round 1
    };
  }
  // drafting_waiting_turn: round 2 has just started (picksMade 6) -- the
  // picker on the clock is fx-p6, and myUserId is 4 picks away.
  return {
    clock: { pickSeconds: 60, picksMade: 6, deadlineAt: '2026-10-03T19:58:30.000Z', serverNow: '2026-10-03T19:58:00.000Z' },
    order,
    myPickCount: 1,
  };
}

export function useDraftingData(leagueId: string, myUserId: string): DraftingData {
  const [clock, setClock] = useState<DraftClockState | null>(null);
  const [order, setOrder] = useState<string[] | null>(null);
  const [myPickCount, setMyPickCount] = useState(0);

  useEffect(() => {
    if (HOME_FIXTURE === 'drafting_on_clock' || HOME_FIXTURE === 'drafting_waiting_turn') {
      const fx = fixtureDraftingData(HOME_FIXTURE, myUserId);
      setClock(fx.clock);
      setOrder(fx.order);
      setMyPickCount(fx.myPickCount);
      return;
    }

    let cancelled = false;
    (async () => {
      const [{ data: clockRaw }, { data: orderRaw }, { data: picksRaw }] = await Promise.all([
        supabase.rpc('get_draft_clock', { p_league_id: leagueId }),
        supabase.rpc('get_draft_order', { p_league_id: leagueId }),
        supabase.from('drafts').select('symbol').eq('league_id', leagueId).eq('user_id', myUserId),
      ]);
      if (cancelled) return;
      const c = Array.isArray(clockRaw) ? clockRaw[0] : clockRaw;
      if (c) {
        setClock({ pickSeconds: c.pick_seconds, picksMade: c.picks_made, deadlineAt: c.deadline_at, serverNow: c.server_now });
      }
      const parsed = parseDraftOrder(orderRaw);
      setOrder(parsed?.order ?? null);
      setMyPickCount((picksRaw ?? []).length);
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId, myUserId]);

  return { clock, order, myPickCount };
}
