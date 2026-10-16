/**
 * The Season 2 review (3c, R8): the settings start_renewed_season accepts, the
 * teams line, and when the draft can be scheduled. Only the server's whitelist is
 * ever sent; the server refuses anything else (pick_clock_enabled is not in it).
 */
import { isFutureDraftDate } from './renewalPickers';

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

/** The draft can be scheduled once nobody is pending and a FUTURE draft time is set. `now` is passed in, never read
 * here: a time picked as future can be past by the time the commissioner presses Schedule, and the picker's
 * `minimumDate` is a convenience, not the rule (W8 F4). */
export function canSchedule(input: { repliesPending: boolean; draftDate: string | null; now: Date }): boolean {
  return !input.repliesPending && isFutureDraftDate(input.draftDate, input.now);
}

/** The Draft row's value until a time is set: the shipped string Create league and League settings use. */
export const DRAFT_ROW_UNSET = 'Pick a draft time';

/** NEW copy (Design Lead, 2026-10-16): the line under a disabled "Schedule the draft", in the footnote's place and
 * style. It covers no time AND a time that is in the past. */
export const SCHEDULE_NEEDS_TIME = 'Pick a future draft time.';

/** The footnote that returns once a future time is set (unchanged). */
export const SCHEDULE_FOOTNOTE = "Everyone who's in gets a notification. Season 1 stays in History.";

/** Why the button is disabled, or null when the time is fine (the footnote shows then). */
export function scheduleReason(input: { draftDate: string | null; now: Date }): string | null {
  return isFutureDraftDate(input.draftDate, input.now) ? null : SCHEDULE_NEEDS_TIME;
}

/** The line under the button: the reason while the time is missing or past, else the footnote. */
export function scheduleLine(input: { draftDate: string | null; now: Date }): string {
  return scheduleReason(input) ?? SCHEDULE_FOOTNOTE;
}
