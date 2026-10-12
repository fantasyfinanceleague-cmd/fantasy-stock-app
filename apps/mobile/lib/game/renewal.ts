/**
 * Run it back (3c, R1–R10), the pure rules against the PR #94 SQL contract.
 * `group` comes from get_renewal_roster and maps to copy here; a raw value is
 * never shown. The draft gate, the 24 h nudge window and the screen each caller
 * sees are decided here, in one place.
 */

/** Run it back's kill switch (EXPO_PUBLIC_RUN_IT_BACK=1). The UI ships in 1.2.0 but its
 * backend (renew_league, get_renewal_roster: PR #94) releases later, so it stays OFF until
 * then: no card, no strip, no renewal routing. Pure (the caller passes the env value in). */
export function runItBackEnabled(flag: string | undefined): boolean {
  return flag === '1';
}

/** "Waiting on Andrea P." as a sentence: names ending in an initial already carry the
 * period, so the sentence's own period is not added again ("Andrea P.." in the capture). */
export function waitingOnSentence(names: readonly string[]): string {
  const list = `Waiting on ${names.join(', ')}`;
  return list.endsWith('.') ? list : `${list}.`;
}

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

type ScreenRoster =
  | { status: 'not_visible' }
  | { status: 'ok'; full_list: true; is_commissioner: boolean; caller_status: string }
  | { status: 'ok'; full_list: false; caller_status: 'pending' | 'out'; caller_decided_by?: string | null };

/** A player the commissioner removed ("Remove"): out, decided by the commissioner. */
function removedByCommissioner(roster: ScreenRoster): boolean {
  return roster.status === 'ok' && roster.full_list === false && roster.caller_status === 'out' && roster.caller_decided_by === 'commissioner';
}

/** The screen a caller sees, from get_renewal_roster's own fields. GS-14 (Design Lead,
 * 2026-10-11): a player who said I'm out keeps the ask (answer marked) so they can get
 * back in until the draft is set; a player the commissioner removed gets nothing. A read
 * that can't tell the two apart shows the ask (respond_to_renewal's `removed` covers it). */
export function screenFor(roster: ScreenRoster): RenewalScreen {
  if (roster.status !== 'ok') return 'none';
  if (roster.full_list === false) {
    if (roster.caller_status === 'pending') return 'ask';
    return removedByCommissioner(roster) ? 'none' : 'ask';
  }
  return roster.is_commissioner ? 'reconcile' : 'member_list';
}

/** The ask's answer so far: 'out' for a player who said I'm out (GS-14: chip "You're out",
 * I'm out checked), null for one who hasn't replied. */
export function renewalAskAnswer(roster: ScreenRoster): 'out' | null {
  if (screenFor(roster) !== 'ask' || roster.status !== 'ok' || roster.full_list !== false) return null;
  return roster.caller_status === 'out' ? 'out' : null;
}

/** GS-14's chip on the ask once the player said I'm out (Design Lead, NEW copy, verbatim). */
export const YOURE_OUT_CHIP = "You're out";

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

export type SheetAction = 'nudge' | 'remove' | 'cancel';

/** R7, the native action sheet for a non-reply: its title, message and buttons.
 * Inside the 24 h window the nudge button is OMITTED (a native sheet cannot show a
 * disabled button), and the message says when it unlocks. */
export function buildNonReplySheet(input: {
  name: string;
  askedLine: string;
  nudgedLine: string | null;
  nudgeEnabled: boolean;
  unlocksLine: string | null;
}) {
  const tail = input.nudgeEnabled ? 'You can nudge once a day.' : (input.unlocksLine ?? '');
  const message = [input.askedLine, input.nudgedLine, tail].filter((s): s is string => !!s && s.length > 0).join(' ');
  const actions: SheetAction[] = input.nudgeEnabled ? ['nudge', 'remove', 'cancel'] : ['remove', 'cancel'];
  const options = actions.map((a) => ({
    action: a,
    label: a === 'nudge' ? 'Nudge again' : a === 'remove' ? removeActionTitle(input.name) : 'Cancel',
  }));
  return {
    title: `${input.name} hasn't replied`,
    message,
    actions,
    options,
    destructiveIndex: actions.indexOf('remove'),
    cancelIndex: actions.indexOf('cancel'),
  };
}

/** "Nudged Sat, Jan 17." from the last nudge's time (ET), the R7 sheet's second date. */
export function nudgedLine(lastNudgedAtIso: string): string {
  const d = new Date(lastNudgedAtIso);
  const formatted = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' }).format(d);
  return `Nudged ${formatted}.`;
}

/** Home's season-complete card for a MEMBER (3c-2; Design Lead, board
 * #run-it-back frame 1: the ask is on Home AND the League tab): the
 * "{commissioner} is running it back. Are you in for Season 2?" card shows
 * while there is a Season 2 and the roster read says this caller is still
 * asked (screenFor → 'ask': no reply yet, or I'm out, GS-14); I'm in moves them
 * to Season 2's list, and a removed player never gets it. Never for the
 * commissioner (they have RunItBackCard). */
export function showsHomeRenewalAsk(input: { isCommissioner: boolean; successorId: string | null | undefined; screen: RenewalScreen | null }): boolean {
  return !input.isCommissioner && !!input.successorId && input.screen === 'ask';
}

// ── GS-10: the member list (board #run-it-back RibMemberList) ──────────────

/** The board's line under a member's list (RibMemberList), verbatim. */
export const MEMBER_DRAFT_LINE = 'The draft is set once everyone has replied. You can change your answer until then.';
/** The board's banner for a member who is in (RibMemberList), verbatim. */
export const RUNNING_BACK_BANNER = "You're running back";
export const CHANGE_ANSWER = 'Change';

/** "The draft is set": the commissioner scheduled Season 2 (renew_league creates it with
 * draft_date = null, and only the review sets one) or the draft has begun. Every Season 1
 * player "can flip until the draft is set" (PRODUCT_RULES, Run it back), so Change goes
 * at the first of the two, though the server's own refusal (draft_started) is the second. */
export function renewalDraftSet(r: { draft_date?: string | null; draft_status?: string | null }): boolean {
  return !!r.draft_date || (r.draft_status ?? 'not_started') !== 'not_started';
}

/** respond_to_renewal's answer, read for the ask and the Change sheet. `unchanged` (the
 * same answer again) is a success. A refusal keeps its reason for renewalAnswerRefusal;
 * a transport error or an unreadable body is a refusal with no reason. */
export type RenewalAnswerOutcome =
  | { kind: 'saved' }
  | { kind: 'refused'; reason: string | null };

export function renewalAnswerOutcome(data: unknown, error: unknown): RenewalAnswerOutcome {
  if (error || !data || typeof data !== 'object') return { kind: 'refused', reason: null };
  const d = data as { status?: unknown; reason?: unknown };
  if (d.status === 'replied' || d.status === 'unchanged') return { kind: 'saved' };
  return { kind: 'refused', reason: typeof d.reason === 'string' ? d.reason : null };
}

/** The ask's own copy (R3, board RibMemberPrompt), shared verbatim with the Change sheet. */
export const ASK_TAG = 'Season 2';
export function askQuestion(commissionerName: string): string {
  return `${commissionerName} is running it back. Are you in?`;
}
export const ASK_LINE = 'Same league, new season. The draft is set once everyone has replied.';
export const ASK_CHANGE_NOTE = 'You can change your answer until the draft is set.';

/** A refused answer, in place under the choice (Design Lead ruling, 2026-10-11, verbatim).
 * Retrying fixes none of the three named reasons, so only the catch-all (no answer, or a
 * reason with no line of its own) offers Try again. */
export const ANSWER_NOT_SAVED = "Your answer didn't go through. Try again.";
export const TRY_AGAIN = 'Try again';
export function renewalAnswerRefusal(reason: string | null): { line: string; retry: boolean } {
  switch (reason) {
    case 'draft_started': return { line: 'The draft has started, so answers are locked.', retry: false };
    case 'removed': return { line: 'The commissioner removed you from Season 2.', retry: false };
    case 'league_full': return { line: 'Season 2 is full. Ask your commissioner if they can make room.', retry: false };
    default: return { line: ANSWER_NOT_SAVED, retry: true };
  }
}

/** The commissioner's real name for the Change sheet's question, from the roster's own
 * people (no stand-in: with no commissioner row, there is no Change). */
export function rosterCommissionerName(people: readonly { is_commissioner: boolean; display_name: string }[]): string | null {
  return people.find((p) => p.is_commissioner)?.display_name || null;
}

/** What the full roster (R5 reconcile / R6 member list) shows its caller. The draft card
 * ("Draft time · Not set", "Draft order") is the commissioner's alone (GS-10 item 1). A
 * member who answered I'm in gets the banner and the board's line, and Change until the
 * draft is set (item 2; Change also needs the commissioner's real name for its question).
 * A newcomer (group 'new') joined by code and has no answer to change, so gets neither. */
export function rosterView(r: {
  is_commissioner: boolean;
  caller_status: string;
  draft_date?: string | null;
  draft_status?: string | null;
  people: readonly { is_commissioner: boolean; display_name: string }[];
}): { draftCard: boolean; banner: boolean; change: boolean; memberLine: boolean } {
  const memberIn = !r.is_commissioner && r.caller_status === 'in';
  const set = renewalDraftSet(r);
  return {
    draftCard: r.is_commissioner,
    banner: memberIn,
    change: memberIn && !set && rosterCommissionerName(r.people) !== null,
    // "You can change your answer until then" is false once the draft is set.
    memberLine: memberIn && !set,
  };
}

// ── GS-11: the commissioner's Season 2 Home (board RibHomeCounts) ──────────

/** The full roster a Home read holds, if any: kept while a re-read is in flight (the hook
 * keeps the last roster through 'loading'), gone on a failed read. */
export function heldFullRoster<R extends { status: string; full_list?: boolean }>(st: {
  status: 'idle' | 'loading' | 'ready' | 'error';
  roster: R | null;
}): Extract<R, { full_list: true }> | null {
  if (st.status === 'error' || !st.roster || st.roster.status !== 'ok' || st.roster.full_list !== true) return null;
  return st.roster as Extract<R, { full_list: true }>;
}

/** Whether Home's PreDraftCard drops its draft block ("No draft time yet", "Pick a time…",
 * Set draft time) for a renewed league (GS-11, board RibHomeCounts): while any reply is
 * pending. Before the first read lands it is dropped too, so the block never flashes in and
 * back out; a re-read keeps the last answer. A failed read falls back to today's card: the
 * server refuses an early draft time anyway (renewal_replies_pending). */
export function homeRepliesPending(st: {
  status: 'idle' | 'loading' | 'ready' | 'error';
  roster: { status: string; full_list?: boolean; replies_pending?: boolean } | null;
}): boolean {
  const r = st.roster;
  if (st.status !== 'error' && r && r.status === 'ok' && r.full_list === true) return r.replies_pending === true;
  return st.status === 'idle' || st.status === 'loading';
}

/** After the finished league's ask (Home or League tab) saves an answer: I'm in opens
 * Season 2's list on the League tab (board frame 1: "I'm in opens the full list (4b)"),
 * since only now is Season 2 one of their leagues; I'm out re-reads in place, where the
 * card stays with "You're out" (GS-14). */
export function afterAskAnswer(response: 'in' | 'out'): 'open_season_2' | 'reread' {
  return response === 'in' ? 'open_season_2' : 'reread';
}
