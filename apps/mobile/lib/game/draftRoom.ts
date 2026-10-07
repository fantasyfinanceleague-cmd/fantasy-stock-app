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

/** The pick-log label. `mine`: the pick is the viewer's own, so a queue
 * auto-pick says "from your queue" (G-4, ruled); "best available" is the same
 * for everyone. */
export function pickLogLine(source: string, mine = false): string {
  if (mine && source === 'auto_queue') return 'Auto-picked · from your queue';
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
export function pickRowView(p: { symbol: string; source: string }, mine = false): { symbolCell: string; symbolLabel: string; label: string | null; auto: boolean; countsAsPick: boolean } {
  // The Design Lead's addition: VoiceOver reads "No pick" for the dash cell, never "dash" or nothing.
  if (isLegacySkip(p)) return { symbolCell: '—', symbolLabel: 'No pick', label: null, auto: false, countsAsPick: false };
  return { symbolCell: p.symbol, symbolLabel: p.symbol, label: pickLogLine(p.source, mine), auto: isAutoPick(p.source), countsAsPick: true };
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
export function roundPickLine(round: number, rounds: number, pick: number, thenPick: number | null = null): string {
  return `Round ${round} of ${rounds} · Pick ${pick}${thenPick !== null ? `, then ${thenPick}` : ''}`;
}

/** The snake's turn (board key screen 4, "Pick 12, then 13"): the next pick when
 * the manager on the clock holds it too, else null (and null past the last pick). */
export function snakeThenPick(order: readonly string[], pick: number, totalPicks: number): number | null {
  if (order.length === 0 || pick + 1 > totalPicks) return null;
  return managerAtPick(pick + 1, order as string[]) === managerAtPick(pick, order as string[]) ? pick + 1 : null;
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
): { symbols: string[]; prices: (number | null)[]; sources: string[] } {
  const mine = [...picks.entries()]
    .filter(([n, p]) => order.length > 0 && managerAtPick(n, order as string[]) === userId && p.source !== 'skip')
    .sort((a, b) => a[0] - b[0]);
  return { symbols: mine.map(([, p]) => p.symbol), prices: mine.map(([, p]) => p.price ?? null), sources: mine.map(([, p]) => p.source) };
}

/** The budget left in a budget-cap league (UX rule 4): the cap minus what
 * your picks cost. Null when the cap or any pick's price is unknown: the number
 * is real or absent, never estimated. */
export function budgetLeft(budget: number | null | undefined, prices: readonly (number | null)[]): number | null {
  if (typeof budget !== 'number' || !Number.isFinite(budget)) return null;
  if (prices.some((p) => p === null)) return null;
  const spent = prices.reduce<number>((sum, p) => sum + (p as number), 0);
  return Math.max(0, Math.round((budget - spent) * 100) / 100);
}

/** The room's roster strip header (board key screen 4). */
export const YOUR_ROSTER = 'Your roster';

/** The strip's caption (board key screen 4, U-06): "1 of 6 · $2,000 per slot" in
 * an equal-stakes league; budget-cap shows what's left, "1 of 6 · $1,240 left"
 * (ruled). Price tiers have no one per-slot amount, and an unknown amount is
 * never "$0": the count alone. */
export function rosterCaption(
  count: number,
  rounds: number,
  stakes: { stakeMode: string | null; notionalPerSlot?: number | null; budgetLeft?: number | null },
): string {
  const base = `${count} of ${rounds}`;
  const ok = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n);
  if (stakes.stakeMode === 'budget_cap' && ok(stakes.budgetLeft)) return `${base} · ${dollars(stakes.budgetLeft)} left`;
  if (stakes.stakeMode === 'fixed_notional' && ok(stakes.notionalPerSlot) && stakes.notionalPerSlot > 0) {
    return `${base} · ${dollars(stakes.notionalPerSlot)} per slot`;
  }
  return base;
}

/** The board's "After the pick" clock card (key screen 4, U-09 corrected): once
 * your pick is RECORDED (read back from the board, never from the button), while
 * you wait: "You took AAPL · you're up in 2 picks" (Home's wording); your last
 * pick: "You took AAPL · that's your team". `picksAway` is picksUntilTurn now (-1 =
 * no pick left). Null on your turn (0): the on-clock card shows instead, which is
 * the board's equivalent of the snake's "you pick again" case. */
export function afterPickLine(symbol: string, picksAway: number, auto = false): string | null {
  const s = symbol.toUpperCase();
  // Your pick made by auto-pick reads differently (Design Lead, ruled); the pick log keeps its source tag.
  const lead = auto ? `Auto-picked ${s} for you` : `You took ${s}`;
  if (picksAway < 0) return `${lead} · that's your team`; // auto: ruled (pairs with "You took … · that's your team")
  if (picksAway === 0) return null;
  return `${lead} · you're up in ${picksAway} ${picksAway === 1 ? 'pick' : 'picks'}`;
}

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

/** The shared next step under a refused pick, shown when it's your turn (the
 * audit's Rule 8 table, "Shared next step for a refused pick"). */
export const PICK_ANOTHER_NEXT_STEP = 'Your clock is still running. Pick another stock.';

/** One row of the audit's Rule 8 table › validate-and-record-pick
 * (docs/design/reviews/ux-audit-2026-10.md, Design Lead rulings; the Message
 * column VERBATIM). `{S}` is the stock you tried, `{M}` the manager on the
 * clock. `shared`: the shared next step follows when it's your turn.
 * `refresh`: the room re-reads (the board / its state speaks next). */
interface RefusalRow {
  line: (s: string, m: string) => string;
  next: 'shared' | null;
  refresh?: boolean;
}

const DIDNT_GO_THROUGH = "That pick didn't go through.";

const PICK_REFUSALS: Record<string, RefusalRow> = {
  would_strand_slot: { line: (s) => `Taking ${s} would leave another manager with no stock for one of their slots.`, next: 'shared' },
  budget_reserve: { line: (s) => `${s} would leave too little budget for your remaining picks.`, next: 'shared' },
  symbol_owned: { line: (s) => `${s} is already taken.`, next: 'shared' },
  no_eligible_slot: { line: (s) => `${s} doesn't fit any of your open slots.`, next: 'shared' },
  over_budget: { line: (s) => `${s} costs more than your budget left.`, next: 'shared' },
  not_draftable: { line: (s) => `${s} isn't in this league's list of stocks.`, next: 'shared' },
  no_price: { line: (s) => `${s} has no usable price right now.`, next: 'shared' },
  invalid_price: { line: (s) => `${s} has no usable price right now.`, next: 'shared' },
  not_your_turn: { line: (_s, m) => `It's ${m}'s pick now.`, next: null },
  pick_conflict: { line: () => 'Someone picked at the same moment. Pick again.', next: 'shared', refresh: true },
  draft_complete: { line: () => 'The draft is over. Your team is set.', next: null, refresh: true },
  draft_not_in_progress: { line: () => "The draft isn't running right now.", next: null, refresh: true },
  rate_limited: { line: () => 'Too many tries at once. Wait a moment, then pick again.', next: 'shared' },
  not_a_member: { line: () => DIDNT_GO_THROUGH, next: 'shared' },
  forbidden_target: { line: () => DIDNT_GO_THROUGH, next: 'shared' },
  target_not_member: { line: () => DIDNT_GO_THROUGH, next: 'shared' },
  league_not_found: { line: () => DIDNT_GO_THROUGH, next: 'shared' },
  bad_request: { line: () => DIDNT_GO_THROUGH, next: 'shared' },
  not_authenticated: { line: () => 'Your session ended. Sign in again.', next: null },
};

/** Every reason the table covers (the rule-8 test reads it). */
export const PICK_REFUSAL_REASONS: readonly string[] = Object.keys(PICK_REFUSALS);

/** Server faults (and network): the pick may have landed, so never "can't be
 * made": "Couldn't confirm your pick. Checking…" and re-read (U-04, P0). */
const SERVER_FAULTS = new Set(['draft_order_invalid', 'server_config_error', 'unhandled']);

export interface PickRefusalContext {
  /** The stock you tried (always known on the phone). */
  stock: string | null;
  /** The manager on the clock, for not_your_turn. */
  manager?: string | null;
  /** The shared next step only shows on your turn. */
  isMyTurn?: boolean;
}

export interface PickRefusalView {
  line: string;
  next: string | null;
  /** The outcome is unknown: the room re-reads and the board says what happened. */
  checking: boolean;
  /** The room re-reads (checking, or a refusal whose answer is the new board). */
  refresh: boolean;
}

/** A refused or unconfirmed pick, as the room shows it (audit Rule 8 table).
 * `reason` null = transport (no answer); `status` the HTTP status of a non-2xx. */
export function pickRefusalView(reason: string | null, status: number | null, ctx: PickRefusalContext): PickRefusalView {
  if (reason === null || (status !== null && status >= 500) || SERVER_FAULTS.has(reason)) {
    return { line: PICK_UNCONFIRMED, next: null, checking: true, refresh: true };
  }
  const key = status === 401 ? 'not_authenticated' : reason;
  const row = PICK_REFUSALS[key] ?? { line: () => DIDNT_GO_THROUGH, next: 'shared' as const };
  const stock = ctx.stock?.toUpperCase() || 'That stock';
  const manager = ctx.manager?.trim() || 'another manager';
  return {
    line: row.line(stock, manager),
    next: row.next === 'shared' && ctx.isMyTurn ? PICK_ANOTHER_NEXT_STEP : null,
    checking: false,
    refresh: row.refresh === true,
  };
}

/** The draft room's auto-pick backstop came back "price_unavailable" (audit
 * Rule 8 table, NEW): shown in the clock card, no next step. */
export const AUTO_PICK_WAITING_FOR_PRICES = 'Auto-pick is waiting for prices. Nobody is skipped.';
