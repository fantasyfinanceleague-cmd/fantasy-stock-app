/**
 * draftRoom (3c): the rules the draft room shows. The pick-log line for each
 * pick_source (the board's words; a skip is a skip, never a pick), the Auto
 * badge (every auto_%), and the clock state from the SERVER's deadline and
 * server time, so a skewed device clock never changes what the room says.
 */

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

/** The pick refusals the app has always shown, VERBATIM (existing copy, from the
 * legacy draft route). The never-skips reasons are flagged placeholders. */
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
  would_strand_slot: '[new copy: would_strand_slot]',
  budget_reserve: '[new copy: budget_reserve]',
};

/** The line for a refused pick: its own copy, or one honest generic line, never a raw reason. */
export function pickRefusalLine(reason: string): string {
  return PICK_REFUSAL_LINES[reason] ?? "That pick can't be made.";
}
