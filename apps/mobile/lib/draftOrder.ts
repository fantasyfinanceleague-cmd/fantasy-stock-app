/**
 * The league's STORED draft order, as served by the get_draft_order RPC
 * (supabase/migrations/20261013000000_draft_order_modes.sql). Pure — no RN,
 * no network — so it is hermetically tested in tests-deno/draftOrder.test.ts.
 *
 * The client never derives an order any more. The old rule (commissioner
 * first, then ids sorted — duplicated in draft.tsx and web DraftPage.jsx) is
 * gone; the server randomizes it (random mode, revealed at draft_date - 1h) or
 * the commissioner arranges it (manual mode), and it locks at draft start.
 */

export type DraftOrderMode = 'random' | 'manual' | 'legacy';
export type DraftOrderState = 'open' | 'finalized' | 'locked';

export interface DraftOrderInfo {
  mode: DraftOrderMode;
  state: DraftOrderState;
  draftDate: string | null;
  /** draft_date - 1h: when the order is set (random: revealed). Null while the date is TBD. */
  finalizeAt: string | null;
  revealed: boolean;
  revealedAt: string | null;
  finalized: boolean;
  finalizedAt: string | null;
  locked: boolean;
  lockedAt: string | null;
  /** user ids, position 1 first; bots included ('bot-*'). Null = not revealed yet. */
  order: string[] | null;
  numRounds: number;
  memberCount: number;
  minMembers: number;
  /** finalizeAt has passed but the league is below minMembers: set when the next member joins. */
  waitingForMembers: boolean;
  isCommissioner: boolean;
  canEditOrder: boolean;
  canChangeMode: boolean;
  serverNow: string;
}

/** Parse the RPC's jsonb. Returns null on a refusal ({ok:false}) or a
 * malformed payload — the caller shows the not-revealed state, never a
 * guessed order. */
// deno-lint-ignore no-explicit-any
export function parseDraftOrder(raw: any): DraftOrderInfo | null {
  if (!raw || raw.ok !== true) return null;
  const mode = raw.mode;
  const state = raw.state;
  if (mode !== 'random' && mode !== 'manual' && mode !== 'legacy') return null;
  if (state !== 'open' && state !== 'finalized' && state !== 'locked') return null;
  let order: string[] | null = null;
  if (Array.isArray(raw.order)) {
    order = [...raw.order]
      .sort((a, b) => Number(a.position) - Number(b.position))
      .map((r) => String(r.user_id));
  }
  return {
    mode,
    state,
    draftDate: raw.draft_date ?? null,
    finalizeAt: raw.finalize_at ?? null,
    revealed: raw.revealed === true && order !== null,
    revealedAt: raw.revealed_at ?? null,
    finalized: raw.finalized === true,
    finalizedAt: raw.finalized_at ?? null,
    locked: raw.locked === true,
    lockedAt: raw.locked_at ?? null,
    order,
    numRounds: Number(raw.num_rounds) || 0,
    memberCount: Number(raw.member_count) || 0,
    minMembers: Number(raw.min_members) || 4,
    waitingForMembers: raw.waiting_for_members === true,
    isCommissioner: raw.is_commissioner === true,
    canEditOrder: raw.can_edit_order === true,
    canChangeMode: raw.can_change_mode === true,
    serverNow: String(raw.server_now ?? ''),
  };
}

/**
 * Overall pick numbers (1-based) for the manager at `position` (1-based) in a
 * snake draft of `n` managers over `rounds` rounds — "You pick 4th, then 13th,
 * 20th…". Same rule as the server's currentTurn: odd rounds run forward, even
 * rounds reversed.
 */
export function snakePickNumbers(position: number, n: number, rounds: number): number[] {
  if (!Number.isInteger(position) || position < 1 || position > n || rounds < 1) return [];
  const picks: number[] = [];
  for (let r = 1; r <= rounds; r++) {
    const slot = r % 2 === 1 ? position : n - position + 1;
    picks.push((r - 1) * n + slot);
  }
  return picks;
}

/** The caller's 1-based position in the revealed order, or null. */
export function myPosition(info: DraftOrderInfo | null, userId: string | null | undefined): number | null {
  if (!info?.order || !userId) return null;
  const i = info.order.indexOf(userId);
  return i === -1 ? null : i + 1;
}
