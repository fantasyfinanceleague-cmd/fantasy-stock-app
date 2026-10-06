/**
 * draftRoom (3c): the rules the draft room shows. The pick-log line for each
 * pick_source (the board's words; a skip is a skip, never a pick), the Auto
 * badge (every auto_%), and the clock state from the SERVER's deadline and
 * server time, so a skewed device clock never changes what the room says.
 */
import { dollars } from '../stakesLine';
import { managerAtPick } from './draftBoard';

const PICK_LOG: Record<string, string> = {
  auto_queue: 'Auto-picked · from their queue',
  auto_best: 'Auto-picked · best available',
  manual: 'Picked',
  bot: 'Picked',
};

export function pickLogLine(source: string): string {
  return PICK_LOG[source] ?? 'Picked';
}

/** A legacy SKIP row: written before the server stopped skipping (#105), in old
 * test leagues only. A draft pick can never be unused, so it is not shown as a
 * skip, and it is not counted as a pick. */
export function isLegacySkip(p: { symbol: string; source: string }): boolean {
  return p.symbol.toUpperCase() === 'SKIP' || p.source === 'skip' || p.source === 'auto_skip';
}


/** The Auto badge: every pick the server made for the manager (auto_%). */
export function isAutoPick(source: string): boolean {
  return source.startsWith('auto_');
}

/** One pick-log row. A legacy SKIP row is a plain row with a "—" symbol and no
 * label, badge or explanation (Giorgio's ruling: a draft pick can never be unused). */
export function pickRowView(p: { symbol: string; source: string }): { symbolCell: string; symbolLabel: string; label: string | null; auto: boolean; countsAsPick: boolean } {
  // The Design Lead's addition: VoiceOver reads "No pick" for the dash cell, never "dash" or nothing.
  if (isLegacySkip(p)) return { symbolCell: '—', symbolLabel: 'No pick', label: null, auto: false, countsAsPick: false };
  return { symbolCell: p.symbol, symbolLabel: p.symbol, label: pickLogLine(p.source), auto: isAutoPick(p.source), countsAsPick: true };
}

export type ClockState =
  | { kind: 'idle'; secondsLeft: null }
  | { kind: 'on_clock'; secondsLeft: number }
  | { kind: 'last10'; secondsLeft: number }
  | { kind: 'auto_picking'; secondsLeft: 0 };

/** The clock from the server's deadline and the server's time. Past the deadline
 * it says auto-picking until the pick row arrives: it never assumes a pick happened. */
export function clockState(input: { running: boolean; deadlineAt: string | null; serverNow: string }): ClockState {
  if (!input.running || input.deadlineAt === null) return { kind: 'idle', secondsLeft: null };
  const left = Math.ceil((new Date(input.deadlineAt).getTime() - new Date(input.serverNow).getTime()) / 1000);
  if (!(left > 0)) return { kind: 'auto_picking', secondsLeft: 0 };
  if (left <= 10) return { kind: 'last10', secondsLeft: left };
  return { kind: 'on_clock', secondsLeft: left };
}

/** "Round 2 of 6 · Pick 11" (Design Lead, UX rule 10: the round says "of" the total). NEW. */
export function roundPickLine(round: number, rounds: number, pick: number): string {
  return `Round ${round} of ${rounds} · Pick ${pick}`;
}

/** "3 picks until you" when it isn't your turn (UX rule 10). NEW. Null when it is
 * your turn (0) or you have no pick left (-1, picksUntilTurn). */
export function picksUntilYouLine(picksAway: number): string | null {
  if (!(picksAway > 0)) return null;
  return `${picksAway} ${picksAway === 1 ? 'pick' : 'picks'} until you`;
}

/** Your drafted picks, in pick order (the snake's seats via managerAtPick). A
 * legacy SKIP row is not a stock and never fills a slot. */
export function myDraftedSoFar(
  picks: ReadonlyMap<number, { symbol: string; source: string; price?: number | null }>,
  order: readonly string[],
  userId: string,
): { symbols: string[]; prices: (number | null)[] } {
  const mine = [...picks.entries()]
    .filter(([n, p]) => order.length > 0 && managerAtPick(n, order as string[]) === userId && p.source !== 'skip')
    .sort((a, b) => a[0] - b[0]);
  return { symbols: mine.map(([, p]) => p.symbol), prices: mine.map(([, p]) => p.price ?? null) };
}

/** "Budget left $1,240" in a budget-cap league (UX rule 4): the cap minus what
 * your picks cost. Null when the cap or any pick's price is unknown: the number
 * is real or absent, never estimated. */
export function budgetLeftLine(budget: number | null | undefined, prices: readonly (number | null)[]): string | null {
  if (typeof budget !== 'number' || !Number.isFinite(budget)) return null;
  if (prices.some((p) => p === null)) return null;
  const spent = prices.reduce<number>((sum, p) => sum + (p as number), 0);
  return `Budget left ${dollars(Math.max(0, Math.round((budget - spent) * 100) / 100))}`;
}

/** The pick clock as m:ss (P0, Design Lead audit: it rendered `0:${secondsLeft}`,
 * so a 75 s or 90 s clock read "0:75" / "0:90"). Idle and auto-picking show no
 * clock (the headline says what's happening). Clocks run 30–90 s (pick_seconds). */
export function pickClockLabel(clock: ClockState): string {
  if (clock.kind === 'idle' || clock.kind === 'auto_picking' || clock.secondsLeft === null) return '';
  const s = Math.max(0, Math.floor(clock.secondsLeft));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The pick refusals the app has always shown, VERBATIM (existing copy, from the
 * legacy draft route). The never-skips reasons (would_strand_slot,
 * budget_reserve) carry the board's ruled copy below (pickRefusalLine). */
const PICK_REFUSAL_LINES: Record<string, string> = {
  not_your_turn: "It's not your turn to pick",
  draft_complete: 'The draft is already complete',
  draft_not_in_progress: 'The draft is not in progress',
  symbol_owned: 'That stock is already owned in this league',
  not_draftable: "That stock isn't in this league's draftable universe",
  no_eligible_slot: 'No open roster slot accepts a stock at this price',
  over_budget: 'That stock is over your remaining budget',
  no_price: 'No recent price available for that stock',
  pick_conflict: 'Someone picked at the same moment — refresh and try again',
  rate_limited: 'Too many picks too quickly — wait a moment and try again',
  draft_not_complete: 'The draft is not finished yet',
  forbidden_target: "You can't pick on that player's behalf",
  not_a_member: "You're not a member of this league",
};

/** What the refusal is about: the stock the player tried (always known on the
 * phone), and, only if the server ever returns them, the manager and the slot
 * it would strand. validate-and-record-pick returns the reason code alone
 * today, so the GENERIC lines are what players see. */
export interface PickRefusalContext {
  stock: string | null;
  manager?: string | null;
  slot?: string | null;
}

const GENERIC_REFUSAL = "That pick can't be made.";

/** The line for a refused pick: its own copy, or one honest generic line, never
 * a raw reason. would_strand_slot / budget_reserve: the board's "Pick refused"
 * frames (#game), specific when the names are known, else generic. */
export function pickRefusalLine(reason: string, ctx: PickRefusalContext = { stock: null }): string {
  const stock = ctx.stock?.toUpperCase() || null;
  if (reason === 'would_strand_slot') {
    if (stock && ctx.manager && ctx.slot) {
      return `Taking ${stock} would leave ${ctx.manager} with no stock that fits their ${ctx.slot} slot. Every slot has to be fillable.`;
    }
    return stock ? `Taking ${stock} would leave another manager with no stock for one of their slots.` : GENERIC_REFUSAL;
  }
  if (reason === 'budget_reserve') {
    return stock ? `${stock} would leave too little budget for your remaining picks.` : GENERIC_REFUSAL;
  }
  return PICK_REFUSAL_LINES[reason] ?? GENERIC_REFUSAL;
}

/** Under a never-skips refusal, the next step (board "Pick refused" frames). */
export const PICK_REFUSAL_NEXT_STEP = 'Your clock is still running. Pick from the list, or let your queue pick for you.';

export function pickRefusalNextStep(reason: string): string | null {
  return reason === 'would_strand_slot' || reason === 'budget_reserve' ? PICK_REFUSAL_NEXT_STEP : null;
}
