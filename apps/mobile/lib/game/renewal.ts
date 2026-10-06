/**
 * Run it back (3c, R1–R10), the pure rules against the PR #94 SQL contract.
 * `group` comes from get_renewal_roster and maps to copy here; a raw value is
 * never shown. The draft gate, the 24 h nudge window and the screen each caller
 * sees are decided here, in one place.
 */

export type RenewalGroup = 'in' | 'new' | 'out' | 'pending';

export interface RenewalCounts {
  in: number;
  new: number;
  out: number;
  pending: number;
  team_count: number;
  max_teams: number;
}

/** group → the copy the board shows (the marker is the [New] tag). */
export function groupCopy(group: RenewalGroup): { label: string; marker: string | null } {
  switch (group) {
    case 'in': return { label: 'Running back', marker: null };
    case 'new': return { label: 'Joining', marker: 'New' };
    case 'out': return { label: 'Out', marker: null };
    case 'pending': return { label: 'No reply yet', marker: null };
  }
}

/** "4 running back · 1 new · 1 out · 1 no reply yet" (the board's line, verbatim). */
export function countsLine(c: RenewalCounts): string {
  return `${c.in} running back · ${c.new} new · ${c.out} out · ${c.pending} no reply yet`;
}

/** The draft rows are disabled exactly while any reply is pending (the server enforces it too). */
export function draftDisabled(repliesPending: boolean): boolean {
  return repliesPending;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** One nudge a day. Inside 24 h the nudge is unavailable, and the line says when it unlocks (ET). */
export function nudgeWindow(input: { lastNudgedAt: string | null; now: Date }): { enabled: boolean; unlocksLine: string | null } {
  if (input.lastNudgedAt === null) return { enabled: true, unlocksLine: null };
  const last = new Date(input.lastNudgedAt).getTime();
  const unlocks = new Date(last + DAY_MS);
  if (input.now.getTime() - last >= DAY_MS) return { enabled: true, unlocksLine: null };
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).format(unlocks);
  return { enabled: false, unlocksLine: `You can nudge again tomorrow at ${time} ET.` };
}

/** Season 1 order, newcomers last: the server's frozen rank, never a client sort. */
export function orderRoster<T extends { user_id: string; group: RenewalGroup }>(people: T[], season1Order: string[]): T[] {
  const rank = (p: T) => {
    if (p.group === 'new') return Number.MAX_SAFE_INTEGER;
    const i = season1Order.indexOf(p.user_id);
    return i < 0 ? Number.MAX_SAFE_INTEGER - 1 : i;
  };
  return [...people].sort((a, b) => rank(a) - rank(b));
}

export type RenewalScreen = 'reconcile' | 'member_list' | 'ask' | 'none';

/** The screen a caller sees, from get_renewal_roster's own fields. */
export function screenFor(roster:
  | { status: 'not_visible' }
  | { status: 'ok'; full_list: true; is_commissioner: boolean; caller_status: string }
  | { status: 'ok'; full_list: false; caller_status: 'pending' | 'out' }): RenewalScreen {
  if (roster.status !== 'ok') return 'none';
  if (roster.full_list === false) return roster.caller_status === 'pending' ? 'ask' : 'none';
  return roster.is_commissioner ? 'reconcile' : 'member_list';
}

/** The destructive action's title names the person (§9B: never Yes/No). */
export function removeActionTitle(name: string): string {
  return `Remove ${name}`;
}

/** "Asked Fri, Jan 16." from the renewed league's creation time (every invitee is asked at once). */
export function askedLine(createdAtIso: string): string {
  const d = new Date(createdAtIso);
  const formatted = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' }).format(d);
  return `Asked ${formatted}.`;
}
