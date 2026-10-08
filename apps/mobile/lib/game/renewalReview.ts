/**
 * The Season 2 review (3c, R8): the settings start_renewed_season accepts, the
 * teams line, and when the draft can be scheduled. Only the server's whitelist is
 * ever sent; the server refuses anything else (pick_clock_enabled is not in it).
 */

/** start_renewed_season's whitelist (PR #94). */
export const RENEWAL_SETTINGS_KEYS = [
  'name', 'num_rounds', 'stake_mode', 'notional_per_slot', 'budget_amount', 'allow_undraftable',
  'num_weeks', 'playoff_teams', 'draft_order_mode', 'pick_seconds', 'draft_date',
] as const;

/** Keep only the whitelisted keys: anything else is dropped, never sent. */
export function buildRenewalSettings(form: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of RENEWAL_SETTINGS_KEYS) if (k in form && form[k] !== undefined) out[k] = form[k];
  return out;
}

/** "Teams": who's in plus the newcomers, up to 16, with the invite code for more. */
export function teamsLine(counts: { in: number; new: number }, inviteCode: string): { value: string; sub: string } {
  return { value: String(counts.in + counts.new), sub: `Follows who's in, up to 16. More can join with ${inviteCode} until the draft.` };
}

/** The draft can be scheduled once nobody is pending and a date is set. */
export function canSchedule(input: { repliesPending: boolean; draftDate: string | null }): boolean {
  return !input.repliesPending && input.draftDate !== null;
}
