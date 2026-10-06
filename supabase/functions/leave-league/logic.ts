/**
 * Pure logic for leave-league: request parsing, the client response, the
 * commissioner's member_left push copy, and the notice's push_status. No DB, no
 * Deno runtime APIs, so it is hermetically tested in logic.test.ts.
 *
 * The RPC (leave_league / unhide_league, 20261107000001) owns every rule; this
 * file only shapes inputs and outputs around it.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type LeaveAction = 'leave' | 'unhide';

export interface LeaveRequest {
  action: LeaveAction;
  leagueId: string;
  newCommissionerId: string | null;
}

/** Strict: a malformed body is a 400, never a guessed default. */
export function parseLeaveRequest(body: unknown): LeaveRequest | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const action = b.action ?? 'leave';
  if (action !== 'leave' && action !== 'unhide') return null;
  const leagueId = typeof b.league_id === 'string' ? b.league_id.trim() : '';
  if (!UUID_RE.test(leagueId)) return null;
  const raw = b.new_commissioner_id;
  let newCommissionerId: string | null = null;
  if (raw !== undefined && raw !== null && raw !== '') {
    if (action !== 'leave' || typeof raw !== 'string' || !UUID_RE.test(raw.trim())) return null;
    newCommissionerId = raw.trim();
  }
  return { action, leagueId, newCommissionerId };
}

// deno-lint-ignore no-explicit-any
type RpcResult = Record<string, any>;

/**
 * What the CLIENT sees. Only the outcome: the RPC's notice id, recipient and
 * names are for the push and never leave the server.
 */
export function clientResponse(r: RpcResult): Record<string, unknown> {
  switch (r?.status) {
    case 'left':
      return { ok: true, status: 'left', reconfirm_required: r.reconfirm_required === true };
    case 'hidden':
      return { ok: true, status: 'hidden' };
    case 'shown':
      return { ok: true, status: 'shown' };
    case 'refused':
      return r.window
        ? { ok: false, reason: String(r.reason), window: String(r.window) }
        : { ok: false, reason: String(r.reason) };
    default:
      return { ok: false, reason: 'unhandled' };
  }
}

export interface MemberLeftInput {
  leagueId: string;
  leagueName: string | null;
  leaverName: string | null;
  madeCommissioner: boolean;
  reconfirmRequired: boolean;
}

/**
 * The push to the (new) commissioner. COPY IS PROVISIONAL: the Design Lead owns
 * the final wording (Orchestrator's draft: "<name> left <League>. Confirm your
 * roster before the draft.").
 */
export function memberLeftMessage(i: MemberLeftInput) {
  const league = i.leagueName?.trim() || 'your league';
  const who = i.leaverName?.trim() || 'A manager';
  const lead = i.madeCommissioner ? `${who} left ${league} and made you commissioner.` : `${who} left ${league}.`;
  return {
    title: league,
    body: i.reconfirmRequired ? `${lead} Confirm your roster before the draft.` : lead,
    data: { type: 'member_left', league_id: i.leagueId },
  };
}

export type DeliveryOutcome = 'sent' | 'no_token' | 'lookup_failed' | 'expo_error' | 'expo_ticket_error';

/**
 * ONE attempt, settled truthfully. Nothing retries member_left (draft-order-notify
 * selects only draft_order_set), so a failure is 'failed', never a 'pending'
 * that would read as "still to come". The reconfirm banner and the start
 * blocker are the reliable surfaces; the push is the courtesy.
 */
export function noticeStatus(o: DeliveryOutcome): 'sent' | 'no_device' | 'failed' {
  if (o === 'sent') return 'sent';
  if (o === 'no_token') return 'no_device';
  return 'failed';
}
