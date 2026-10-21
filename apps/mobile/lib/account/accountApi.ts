// Account deletion (W4) — the server calls, through the dev seam so a capture can stand in for a server that
// hasn't landed. With the seam off these are exactly supabase.functions.invoke / supabase.rpc.
//   delete-account                POST {proof}
//   create_takeover_invite        rpc(p_league_id, p_seat_user_id) -> {code}   (commissioner only)
//   join-league {action:'takeover_preview', code} and {action:'takeover', code}

import { supabase } from '../supabase';
import { seamInvoke, seamRpc } from '../game/seamCalls';
import { readFunctionRefusal } from '../functionRefusal';
import { accountCheckFromGetUser, runDeleteFlow, type DeleteRunDeps } from './deleteRun';
import { proveWithApple, proveWithGoogle } from '../auth/socialSignIn';
import type { DeleteOutcome, DeleteRequestBody } from './deleteFlow';
import { interpretTakeover, interpretTakeoverPreview, type TakeoverPreview, type TakeoverResult } from './takeoverView';
import { normalizeTakeoverCode } from '../invite/takeoverLink';

export const deleteRunDeps: DeleteRunDeps = {
  invoke: (body) => seamInvoke('delete-account', { body: { proof: body.proof } }),
  checkAccount: async () => {
    const r = await supabase.auth.getUser();
    return accountCheckFromGetUser(r);
  },
};

export function deleteAccount(body: DeleteRequestBody, proofAt: number | null): Promise<DeleteOutcome> {
  return runDeleteFlow(body, proofAt, {
    ...deleteRunDeps,
    now: () => Date.now(),
    reprove: (kind) => (kind === 'apple' ? proveWithApple() : proveWithGoogle()),
  });
}

async function joinLeague(body: Record<string, unknown>) {
  try {
    const { data, error } = await seamInvoke('join-league', { body });
    return readFunctionRefusal(data, error);
  } catch {
    return { transport: true } as const;
  }
}

export async function previewTakeover(code: string): Promise<TakeoverPreview> {
  return interpretTakeoverPreview(await joinLeague({ action: 'takeover_preview', code }));
}

export async function takeOverTeam(code: string): Promise<TakeoverResult> {
  return interpretTakeover(await joinLeague({ action: 'takeover', code }));
}

/** The commissioner's code for a deleted seat (the pending one is reused server-side). Null on any failure or an off-shape code. */
export async function createTakeoverInvite(leagueId: string, seatUserId: string): Promise<string | null> {
  try {
    const { data, error } = await seamRpc('create_takeover_invite', { p_league_id: leagueId, p_seat_user_id: seatUserId });
    if (error) return null;
    const row = Array.isArray(data) ? data[0] : data;
    return normalizeTakeoverCode((row as { code?: unknown } | null)?.code);
  } catch {
    return null;
  }
}
