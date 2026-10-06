/**
 * Create league's four steps (3c-2): League, Season, Draft, Stakes, as the
 * board numbers them ("Step 2 of 4 · Season", "Step 3 of 4 · Draft"). Pure, so
 * the rules tests run without the app.
 *
 * The regroup from the old nine steps changes the ORDER of the screens only.
 * Every write, clamp and validator is the one create-league.tsx always used.
 * The checks are the old ones; their copy follows the Design Lead's rulings
 * (inline field errors, not Alerts). The stake check takes
 * `validateSlotConfig`'s result as input rather than importing it
 * (categoryData pulls in supabase). Rounds (Draft) and managers (Season) still
 * come before the roster slots (Stakes), so slot capacity is checked against
 * the real values (BUG 2a).
 */
import { seasonCaption } from './createLeagueSetup';
import { PRICE_TIERS_NEED_A_SLOT } from './slotBuilderCopy';

export type CreateStep = 'league' | 'season' | 'draft' | 'stakes';

export const CREATE_STEPS: readonly CreateStep[] = ['league', 'season', 'draft', 'stakes'];

/** Titles and subtitles. Season and Draft are the board's; League and Stakes
 * are NEW copy (no frame), flagged for the Design Lead. */
export const CREATE_STEP_COPY: Record<CreateStep, { title: string; subtitle: string }> = {
  league: { title: 'League', subtitle: "Name your league and choose how it's played." }, // NEW copy
  season: { title: 'Season', subtitle: 'How big the league is and how long it runs.' }, // board
  draft: { title: 'Draft', subtitle: 'A live snake draft. Everyone picks in turn, and the order reverses each round.' }, // board
  stakes: { title: 'Stakes', subtitle: 'How do teams stake their picks?' }, // the old stake step's line
};

export function stepNumber(step: CreateStep): number {
  return CREATE_STEPS.indexOf(step) + 1;
}

/** "Step 2 of 4" (board). */
export function stepCaption(step: CreateStep): string {
  return `Step ${stepNumber(step)} of ${CREATE_STEPS.length}`;
}

/** The step after this one; null on the last step, where the action creates the league. */
export function nextStep(step: CreateStep): CreateStep | null {
  return CREATE_STEPS[CREATE_STEPS.indexOf(step) + 1] ?? null;
}

/** The step before this one; null on the first step, where back dismisses the flow. */
export function prevStep(step: CreateStep): CreateStep | null {
  const i = CREATE_STEPS.indexOf(step);
  return i > 0 ? CREATE_STEPS[i - 1] : null;
}

/** League name, inline (Design Lead ruling): the old checks (blank, then
 * moderation on the TRIMMED name), the ruled copy. Null when it's fine. Used
 * by Create league's League step and by League settings. */
export function leagueNameError(
  name: string,
  check: (trimmed: string) => { isValid: boolean; reason?: string },
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Enter a league name.';
  if (!check(trimmed).isValid) return 'League name is not allowed';
  return null;
}

/** Creating from the Stakes step. Only price tiers need slots (they are the
 * anti-skew mechanism); the other modes go straight through, as before. With
 * price tiers: no slot shows PRICE_TIERS_NEED_A_SLOT under Roster slots; slot
 * errors show on the slots themselves (SlotBuilder). */
export function stakesStepError(stakeMode: string, slotCount: number, slotErrors: readonly string[]): string | null {
  if (stakeMode !== 'price_tiers') return null;
  if (slotCount === 0) return PRICE_TIERS_NEED_A_SLOT;
  if (slotErrors.length > 0) return slotErrors[0];
  return null;
}

// ── Season step ─────────────────────────────────────────────────────────

/** League sizes create offers: DB CHECK leagues_num_participants_range (4..16),
 * even numbers, the same list as before (the board's 7 is a product question). */
export const MANAGER_SIZES: readonly number[] = [4, 6, 8, 10, 12, 14, 16];

/** One step through MANAGER_SIZES, held at the ends. A size off the list moves
 * to the nearest listed size in that direction. */
export function stepManagers(size: number, direction: 1 | -1): number {
  const first = MANAGER_SIZES[0];
  const last = MANAGER_SIZES[MANAGER_SIZES.length - 1];
  if (direction === 1) return MANAGER_SIZES.find((s) => s > size) ?? last;
  return [...MANAGER_SIZES].reverse().find((s) => s < size) ?? first;
}

/** The weeks the league will be created with: never fewer than one round robin
 * (size − 1). This is the same max() the insert has always used, so the stepper
 * shows the value that will be written instead of a stale one below the floor. */
export function weeksShown(numWeeks: number, size: number): number {
  return Math.max(numWeeks, size - 1);
}

/** One weeks step from the shown value, never below the round-robin floor. */
export function stepWeeks(numWeeks: number, size: number, direction: 1 | -1): number {
  return Math.max(size - 1, weeksShown(numWeeks, size) + direction);
}

/** Under the weeks stepper (Design Lead ruling). */
export function roundRobinCaption(minWeeks: number): string {
  return `At least ${minWeeks} weeks, so every team plays every other team once.`;
}

/** "2 to 7, up to your expected managers" (board). */
export function playoffTeamsSub(size: number): string {
  return `2 to ${size}, up to your expected managers`;
}

/** "Season: 13 weeks + 2 playoff weeks. We check this again when the draft starts." (board) */
export function seasonCheckCaption(regularWeeks: number, playoffTeams: number): string {
  return `${seasonCaption(regularWeeks, playoffTeams)}. We check this again when the draft starts.`;
}

/** The second line of the bye heads-up in Create league (board): the member
 * count isn't final, so it says the notice is based on the expected size. */
export function byeExpectedCopy(managers: number): string {
  return `Based on the ${managers} you expect. This updates as people join.`;
}

/** A Duration league's lengths: DB CHECK leagues_duration_days_check in (7,30,90,180,365). */
export const DURATION_OPTIONS: readonly { value: number; label: string; desc: string }[] = [
  { value: 7, label: '1 Week', desc: 'Quick game' },
  { value: 30, label: '1 Month', desc: 'Standard' },
  { value: 90, label: '3 Months', desc: 'Quarter' },
  { value: 180, label: '6 Months', desc: 'Half year' },
  { value: 365, label: '1 Year', desc: 'Full season' },
];

// ── Draft step ──────────────────────────────────────────────────────────

/** Rounds (one stock per round per team) in Create league: 3..12, as before. */
export const CREATE_ROUNDS_BOUNDS = { min: 3, max: 12 } as const;

/** Any stepper's next value, held inside [min, max]. */
export function stepWithin(value: number, direction: 1 | -1, min: number, max: number): number {
  return Math.min(max, Math.max(min, value + direction));
}

// ── Stakes step ─────────────────────────────────────────────────────────

/** Under the Draft date row while it's TBD (Design Lead ruling). */
export const DRAFT_DATE_LATER = 'Set a draft date before the draft can start. You can do it later in League settings.';

/** The budget-cap presets, as before. */
export const BUDGET_PRESETS: readonly string[] = ['1000', '2500', '5000', '10000'];
