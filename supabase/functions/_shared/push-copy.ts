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

/** "Your turn" in the draft. The pre-2026-07-30 client copy, verbatim. */
export function draftTurnMessage(leagueName: string): PushMessage {
  return {
    title: "It's Your Turn! 🏈",
    body: `Time to make your pick in ${leagueName}`,
    data: { type: 'draft_turn', screen: 'draft' },
  };
}
