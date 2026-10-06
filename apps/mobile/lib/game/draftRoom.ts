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

/** After your own pick lands, a line in the clock card for a few seconds (UX
 * rule 11; NEW, the Design Lead's): "NVDA is yours. Next pick in 3 turns."; your
 * last pick: "NVDA is yours. That's your team." `picksAway` is picksUntilTurn
 * AFTER this pick (-1 = no pick left). At the turn of the snake you pick again
 * at once (0): "You pick again next." (NEW, flagged: not in the ruling). */
export function pickConfirmedLine(symbol: string, picksAway: number): string {
  const s = symbol.toUpperCase();
  if (picksAway < 0) return `${s} is yours. That's your team.`;
  if (picksAway === 0) return `${s} is yours. You pick again next.`;
  return `${s} is yours. Next pick in ${picksAway} ${picksAway === 1 ? 'turn' : 'turns'}.`;
}

/** How long the confirmation stays (ms): about 3 s, no animation. */
export const PICK_CONFIRMED_MS = 3000;

/** The Draft button while the pick is on its way (UX rule 9). NEW. */
export const PICK_SENDING = 'Sending…';
/** The pick's outcome is unknown (a transport error, no answer): never "That pick
 * can't be made." The room re-reads and the refreshed board says what happened
 * (UX rule 9). NEW. */
export const PICK_UNCONFIRMED = "Couldn't confirm your pick. Checking…";

/** The pick clock as m:ss (P0, Design Lead audit: it rendered `0:${secondsLeft}`,
 * so a 75 s or 90 s clock read "0:75" / "0:90"). Idle and auto-picking show no
 * clock (the headline says what's happening). Clocks run 30–90 s (pick_seconds). */
export function pickClockLabel(clock: ClockState): string {
  if (clock.kind === 'idle' || clock.kind === 'auto_picking' || clock.secondsLeft === null) return '';
  const s = Math.max(0, Math.floor(clock.secondsLeft));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** A pick refusal: its line, and the next step shown under it (UX rule 8).
 * `another`: the clock keeps running and another stock would do, so the
 * shared next step "Your clock is still running. Pick another stock." follows. */
interface RefusalEntry {
  line: string;
  next: 'another' | null;
}

/** The pick refusals (UX rule 8: whole sentences, the shared next step, no em
 * dashes). STRUCTURE ONLY for now: the lines are the existing copy, verbatim,
 * until the Design Lead's exact table is relayed; then the table replaces
 * `line` (and `next` where it differs) and the pending test below goes live.
 * The never-skips reasons (would_strand_slot, budget_reserve) are built in
 * pickRefusalLine with the board's copy and their own next step. */
const PICK_REFUSALS: Record<string, RefusalEntry> = {
  not_your_turn: { line: "It's not your turn to pick", next: null },
  draft_complete: { line: 'The draft is already complete', next: null },
  draft_not_in_progress: { line: 'The draft is not in progress', next: null },
  symbol_owned: { line: 'That stock is already owned in this league', next: 'another' },
  not_draftable: { line: "That stock isn't in this league's draftable universe", next: 'another' },
  no_eligible_slot: { line: 'No open roster slot accepts a stock at this price', next: 'another' },
  over_budget: { line: 'That stock is over your remaining budget', next: 'another' },
  no_price: { line: 'No recent price available for that stock', next: 'another' },
  pick_conflict: { line: 'Someone picked at the same moment — refresh and try again', next: null },
  rate_limited: { line: 'Too many picks too quickly — wait a moment and try again', next: null },
  draft_not_complete: { line: 'The draft is not finished yet', next: null },
  forbidden_target: { line: "You can't pick on that player's behalf", next: null },
  not_a_member: { line: "You're not a member of this league", next: null },
};

/** Every reason the table covers (for the rule-8 test once the table lands). */
export const PICK_REFUSAL_REASONS: readonly string[] = Object.keys(PICK_REFUSALS);

/** The shared next step under a refusal where another stock would do (UX rule 8). */
export const PICK_ANOTHER_NEXT_STEP = 'Your clock is still running. Pick another stock.';

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
  return PICK_REFUSALS[reason]?.line ?? GENERIC_REFUSAL;
}

/** Under a never-skips refusal, the next step (board "Pick refused" frames). */
export const PICK_REFUSAL_NEXT_STEP = 'Your clock is still running. Pick from the list, or let your queue pick for you.';

export function pickRefusalNextStep(reason: string): string | null {
  if (reason === 'would_strand_slot' || reason === 'budget_reserve') return PICK_REFUSAL_NEXT_STEP;
  return PICK_REFUSALS[reason]?.next === 'another' ? PICK_ANOTHER_NEXT_STEP : null;
}
