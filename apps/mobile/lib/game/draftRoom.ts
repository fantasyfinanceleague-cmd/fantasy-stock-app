/**
 * draftRoom (3c): the rules the draft room shows. The pick-log line for each
 * pick_source (the board's words; a skip is a skip, never a pick), the Auto
 * badge (every auto_%), and the clock state from the SERVER's deadline and
 * server time, so a skewed device clock never changes what the room says.
 */

const PICK_LOG: Record<string, string> = {
  auto_queue: 'Auto-picked · from their queue',
  auto_best: 'Auto-picked · best available',
  auto_skip: 'Skipped',
  skip: 'Skipped',
  manual: 'Picked',
  bot: 'Picked',
};

export function pickLogLine(source: string): string {
  return PICK_LOG[source] ?? 'Picked';
}

/** The Auto badge: every pick the server made for the manager (auto_%). */
export function isAutoPick(source: string): boolean {
  return source.startsWith('auto_');
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
