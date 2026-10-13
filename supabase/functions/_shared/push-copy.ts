/**
 * Push notification COPY, the one source of truth for each message both a
 * user-triggered push (send-notification) and a server-originated push
 * (draft-write.ts) can send. Pure: no I/O, no Deno APIs.
 *
 * Every argument must be a server-verified value (e.g. the league name read
 * from the leagues row), never caller input: the copy is the content the F7
 * review authorized, and a caller-supplied string here would reopen it.
 */
import type { PushMessage } from './push.ts';

/** "Your turn" in the draft. The pre-2026-07-30 client copy, verbatim.
 * `league_id` + `pick_number` are the app's once-per-turn key: a foreground push
 * and the open draft room share one buzz + chime per turn (apps/mobile
 * lib/game/yourTurnPush.ts). Data only, never shown. */
export function draftTurnMessage(leagueName: string, leagueId: string, pickNumber: number): PushMessage {
  return {
    title: "It's Your Turn! 🏈",
    body: `Time to make your pick in ${leagueName}`,
    data: { type: 'draft_turn', screen: 'draft', league_id: leagueId, pick_number: pickNumber },
  };
}

/** The commissioner's ONE draft-stall push: live prices unavailable for a turn
 * (draft-write.ts noteOutage, once per turn after OUTAGE_ESCALATE_MS). The copy is
 * the shipped string, verbatim. There is deliberately NO push for a turn the
 * auto-pick cannot fill or is slow to fill (Giorgio, 2026-10-13: "Drop the wrong
 * 'pick manually' notification and don't add a new one. The commissioner can't
 * do anything about it anyway."); those are draft_stalls rows and logs for the
 * operator. Data only, never shown: `type` is the app's routing key. */
export const DRAFT_OUTAGE_PUSH = {
  title: 'Auto-pick is waiting on prices',
  body: 'Live prices are unavailable for pick {pick}. The turn stays open and retries.',
  type: 'draft_outage',
} as const;

export function draftOutageMessage(leagueId: string, pickNumber: number): PushMessage {
  return {
    title: DRAFT_OUTAGE_PUSH.title,
    body: DRAFT_OUTAGE_PUSH.body.replace('{pick}', String(pickNumber)),
    data: { type: DRAFT_OUTAGE_PUSH.type, league_id: leagueId, pick_number: pickNumber },
  };
}
