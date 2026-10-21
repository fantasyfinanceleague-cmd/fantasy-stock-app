// Account deletion (W4) — "Find a new manager": who sees it and what the Members list shows. Pure.
//
// The button is the COMMISSIONER's, on a DELETED seat, from the moment the draft is complete through the end of the
// season (plan decision 14): not before the draft (no seat exists to hand over — a deleted manager simply left) and not
// during a live draft (the seat auto-picks; takeover opens once the draft is complete) and not after the season
// (nothing left to take). The server enforces the same window (create_takeover_invite / take_over_team); this only
// decides whether to OFFER it.

import { isDeletedSeatName } from './deletedSeat';

export function canFindNewManager(a: {
  isCommissioner: boolean;
  seatDeleted: boolean;
  draftStatus: string | null | undefined;
  seasonStatus: string | null | undefined;
}): boolean {
  return a.isCommissioner && a.seatDeleted && a.draftStatus === 'completed' && a.seasonStatus !== 'completed';
}

export interface MemberRowModel {
  userId: string;
  name: string;
  isYou: boolean;
  isCommissioner: boolean;
  deleted: boolean;
}

/** League › Members after the draft: you first, then the others A–Z, deleted seats last. Only CURRENT members (memberIds). */
export function membersRows(
  names: ReadonlyArray<{ user_id: string; display_name: string | null }>,
  memberIds: readonly string[],
  commissionerId: string | null | undefined,
  meId: string,
  label: string,
): MemberRowModel[] {
  const live = new Set(memberIds);
  const rows = names
    .filter((n) => live.has(String(n.user_id)))
    .map((n) => {
      const name = (n.display_name ?? '').trim();
      const deleted = isDeletedSeatName(name, label);
      return { userId: String(n.user_id), name: name || label, isYou: String(n.user_id) === meId, isCommissioner: String(n.user_id) === commissionerId, deleted };
    });
  const rank = (r: MemberRowModel) => (r.isYou ? 0 : r.deleted ? 2 : 1);
  return rows.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || (a.userId < b.userId ? -1 : 1));
}
