/**
 * useRosterData (W4, the Matchup roster and the player card): what Matchup needs beyond
 * Home's fetch.
 *  - The league ledger (get_portfolio_ledger, the cached read Portfolio already shares):
 *    how each stock was got (the card's "How you got it"), the draft/slot order before the
 *    week's first close, and the company names.
 *  - The league's slots and the slot each held position fills (slotted leagues only):
 *    league_draft_slots, then the two managers' drafts.slot_id and buys' trades.slot_id —
 *    the server's own record (matchupRoster.recordedSlots reads it; nothing is derived).
 *    A league whose slots carry no filter is unslotted, and stops after the first read.
 *    Each multi-row read asks for an exact count and fails visibly when partial
 *    (readGuard): a partial slot map would mis-group a roster as if whole.
 * Under the capture seam both come from matchupFixture.ts, no network.
 */
import { useEffect, useState } from 'react';

import { supabase } from '../supabase';
import { SEAM_ON } from './devSeam';
import { checkRowsComplete } from './readGuard';
import { fetchCategories } from '../categoryData';
import { usePortfolioLedger } from '../money/usePortfolioLedger';
import type { PortfolioLedger } from '../money/portfolioLedger';
import { fixtureLedger, fixtureSlots, parseMatchupFixture } from './matchupFixture';
import { isSlotted, recordedSlots, type SlotEvent, type SlotRow } from './matchupRoster';
import type { Category } from '../../components/sp/logic/gameNight';

const VARIANT = parseMatchupFixture(process.env.EXPO_PUBLIC_MATCHUP_FIXTURE);

export interface RosterSlotsState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** Empty for an unslotted league. */
  slots: SlotRow[];
  /** userId → symbol → slot id (null = no recorded slot). */
  bySide: Record<string, Record<string, string | null>>;
}

export interface RosterData {
  ledger: PortfolioLedger | null;
  ledgerStatus: 'loading' | 'ready' | 'error';
  slots: RosterSlotsState;
  retry: () => void;
}

async function loadSlots(leagueId: string, me: string, opp: string): Promise<{ slots: SlotRow[]; bySide: Record<string, Record<string, string | null>> }> {
  if (SEAM_ON) return fixtureSlots(VARIANT, me, opp) ?? { slots: [], bySide: {} };

  const sl = await supabase
    .from('league_draft_slots')
    .select('id, slot_index, slot_count, price_min, price_max, category_id', { count: 'exact' })
    .eq('league_id', leagueId);
  if (sl.error) throw new Error(sl.error.message);
  const rawSlots = sl.data ?? [];
  if (!checkRowsComplete(rawSlots.length, sl.count ?? null).ok) throw new Error('league_draft_slots read incomplete');

  const cats = rawSlots.some((s) => s.category_id) ? await fetchCategories() : [];
  const slugOf = new Map(cats.map((c) => [c.id, c.slug as Category]));
  const slots: SlotRow[] = rawSlots.map((s) => ({
    id: String(s.id),
    slot_index: Number(s.slot_index),
    slot_count: Number(s.slot_count),
    price_min: s.price_min == null ? null : Number(s.price_min),
    price_max: s.price_max == null ? null : Number(s.price_max),
    category: s.category_id ? slugOf.get(String(s.category_id)) ?? null : null,
  }));
  // A category id that didn't resolve (the categories read failed) can't be named: refuse
  // the grouping rather than show a slot as "Flex" that isn't.
  if (rawSlots.some((s, i) => s.category_id && slots[i].category === null)) throw new Error('slot category unresolved');
  if (!isSlotted(slots)) return { slots: [], bySide: {} };

  const users = [me, opp];
  const dr = await supabase
    .from('drafts')
    .select('user_id, symbol, slot_id, created_at', { count: 'exact' })
    .eq('league_id', leagueId)
    .in('user_id', users)
    .neq('symbol', 'SKIP');
  if (dr.error) throw new Error(dr.error.message);
  if (!checkRowsComplete((dr.data ?? []).length, dr.count ?? null).ok) throw new Error('drafts read incomplete');
  const tr = await supabase
    .from('trades')
    .select('user_id, symbol, slot_id, created_at', { count: 'exact' })
    .eq('league_id', leagueId)
    .in('user_id', users)
    .eq('action', 'buy');
  if (tr.error) throw new Error(tr.error.message);
  if (!checkRowsComplete((tr.data ?? []).length, tr.count ?? null).ok) throw new Error('trades read incomplete');
  if (__DEV__) console.log('[game:roster-slots] 3 requests (league_draft_slots, drafts, trades) + categories (cached)');

  const events: SlotEvent[] = [
    ...(dr.data ?? []).map((r) => ({ user_id: String(r.user_id), symbol: r.symbol, slot_id: r.slot_id ?? null, kind: 'draft' as const, at: r.created_at })),
    ...(tr.data ?? []).map((r) => ({ user_id: String(r.user_id), symbol: r.symbol, slot_id: r.slot_id ?? null, kind: 'buy' as const, at: r.created_at })),
  ];
  return { slots, bySide: { [me]: recordedSlots(me, events), [opp]: recordedSlots(opp, events) } };
}

export function useRosterData(leagueId: string | null, me: string | null, opp: string | null): RosterData {
  const ledgerState = usePortfolioLedger(SEAM_ON ? null : leagueId);
  const [slots, setSlots] = useState<RosterSlotsState>({ status: 'idle', slots: [], bySide: {} });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!leagueId || !me || !opp) return;
    let cancelled = false;
    setSlots((s) => ({ ...s, status: 'loading' }));
    loadSlots(leagueId, me, opp)
      .then((r) => {
        if (!cancelled) setSlots({ status: 'ready', ...r });
      })
      .catch((err: Error) => {
        console.warn('[game:roster-slots] failed', err.message);
        if (!cancelled) setSlots({ status: 'error', slots: [], bySide: {} });
      });
    return () => {
      cancelled = true;
    };
  }, [leagueId, me, opp, tick]);

  const retry = () => {
    ledgerState.refresh();
    setTick((t) => t + 1);
  };

  if (SEAM_ON) {
    return {
      ledger: me && opp ? fixtureLedger(VARIANT, me, opp) : null,
      ledgerStatus: me && opp ? 'ready' : 'loading',
      slots,
      retry,
    };
  }
  return { ledger: ledgerState.ledger, ledgerStatus: ledgerState.status, slots, retry };
}

