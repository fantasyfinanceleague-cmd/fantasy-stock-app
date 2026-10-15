// The commissioner's username for preview-league's `inviter` field (Onboarding W3, plan decision 7).
//
// Giorgio, 2026-10-14: the invite page and the link-arrival preview read "{Roberto} invited you to {league}";
// "the inviter only; nobody else". This is the ONLY profile read in preview-league: one username, by the
// commissioner's id, for a code that already resolved to a league. It is kept out of index.ts on purpose, so
// supabase/tests/preview_league_names_nobody.test.ts can keep proving the handler itself looks nobody up.
// (The no-session function invite-preview reads the same single column inside its SQL.)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A stored username, safe to return: a non-empty string of sane length, else null. */
export function cleanUsername(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s && s.length <= 40 ? s : null;
}

/**
 * `read` fetches the `username` column of ONE user_profiles row (RLS-bypassing; the caller supplies it).
 * Commissioner ids that are not uuids (bots are 'bot-N') have no profile and never reach the read. Any read
 * failure is a null inviter, not an error: the preview still works without the name.
 */
export async function lookupInviter(commissionerId: unknown, read: (id: string) => Promise<unknown>): Promise<string | null> {
  if (typeof commissionerId !== 'string' || !UUID.test(commissionerId)) return null;
  try {
    return cleanUsername(await read(commissionerId));
  } catch {
    return null;
  }
}

/** The real reader: ONE column of ONE row, through the admin (RLS-bypassing) client. */
// deno-lint-ignore no-explicit-any
export function inviterReader(admin: any): (id: string) => Promise<unknown> {
  return async (id) => {
    const { data } = await admin.from('user_profiles').select('username').eq('id', id).maybeSingle();
    return data?.username;
  };
}
