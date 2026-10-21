/**
 * A DELETED seat in an UNCLOCKED draft (account deletion, supabase-reviewer P2-5).
 *
 * An account deleted in the order-set or live-draft window keeps its seat
 * (league_members.deleted_at is set by scrub_deleted_manager). In a CLOCKED draft the
 * clock expiry auto-picks for it like any absent manager. In an UNCLOCKED draft
 * (pick_clock_enabled = false) auto-pick never fires (decideAutoPickGate), so the draft
 * would wait forever for a person who no longer exists. Giorgio's standing rule decides
 * it: "there can never be an instance where a player doesn't get a pick ... like fantasy
 * football, you run out of time and it auto drafts for you". So the sweep picks for a
 * DELETED seat in an unclocked draft as soon as it is that seat's turn, through the same
 * autoPickTurn (the same legality gate, queue, best available) as any other auto-pick.
 *
 * What makes this safe is how narrow it is, and every edge of that is pinned in
 * deleted-seat.test.ts:
 *   - a LIVE manager's seat in an unclocked draft is NEVER auto-picked (their pick is
 *     theirs and has no deadline);
 *   - only THIS turn's picker is looked at, so a deleted seat elsewhere in the order
 *     does not trigger a pick for someone else;
 *   - the deleted_at read fails CLOSED (an unreadable seat is treated as live);
 *   - a clocked draft is unchanged.
 *
 * Whose turn it is stays in draft-validation.ts currentTurn (NO TURN MATH IN SQL: the
 * SQL side, unclocked_deleted_seat_turns(), only says "an unclocked live draft has a
 * deleted seat somewhere"; this module decides whether it is that seat's turn).
 */
import { type AutoPickGate, decideAutoPickGate, type DraftClock } from './auto-pick.ts';
import { currentTurn, type PickRow } from './draft-validation.ts';

// deno-lint-ignore no-explicit-any
type Admin = any;

export interface SeatRead {
  deleted: boolean;
  /** the read failed: treated as NOT deleted, and surfaced as an error by the caller */
  error: boolean;
}

/** league_members.deleted_at for (league, user). Destructure-and-check: .from() resolves { error }. */
export function seatReader(admin: Admin, leagueId: string): (userId: string) => Promise<SeatRead> {
  return async (userId) => {
    try {
      const { data, error } = await admin
        .from('league_members')
        .select('deleted_at')
        .eq('league_id', leagueId)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) {
        console.error('deleted-seat: seat read failed', error.code ?? '');
        return { deleted: false, error: true };
      }
      return { deleted: !!data?.deleted_at, error: false };
    } catch (e) {
      console.error('deleted-seat: seat read threw', e instanceof Error ? e.name : 'error');
      return { deleted: false, error: true };
    }
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DeletedSeatTurn {
  leagueId: string;
  /** the pick the list asserted was next; the sweep acts only if the fresh state still agrees */
  pickNumber: number;
}

/**
 * The turns the sweep should look at: public.unclocked_deleted_seat_turns() (W2, service_role
 * only): every in_progress draft with pick_clock_enabled = false that has at least one deleted
 * seat, with the next pick number. It does not say whose turn it is (NO TURN MATH IN SQL), and
 * neither does this: the sweep decides in JS, per league, from fresh state. An error is returned,
 * never read as "none": the caller reports it and carries on with the overdue pass (live clocked
 * drafts must keep moving). A malformed row is dropped, never guessed at.
 */
export async function listUnclockedDeletedSeatTurns(
  admin: Admin,
): Promise<{ turns: DeletedSeatTurn[]; error: boolean }> {
  const { data, error } = await admin.rpc('unclocked_deleted_seat_turns');
  if (error) {
    console.error('unclocked_deleted_seat_turns failed', error.code ?? '');
    return { turns: [], error: true };
  }
  // Same verdict-scope rule as the heal's result: a body that is not an array, or ANY row that does not
  // parse, is FLAGGED (error: true), never read as "none". The valid rows are still returned, so one bad row
  // cannot hide a real deleted seat, and the sweep reports the problem instead of stalling silently.
  if (!Array.isArray(data)) {
    console.error('unclocked_deleted_seat_turns: unexpected result');
    return { turns: [], error: true };
  }
  const rows: unknown[] = data;
  let dropped = 0;
  const turns: DeletedSeatTurn[] = [];
  for (const r of rows) {
    const row = r as { league_id?: unknown; pick_number?: unknown } | null;
    const id = row?.league_id;
    const n = Number(row?.pick_number);
    if (typeof id === 'string' && UUID_RE.test(id) && Number.isInteger(n) && n >= 1) {
      turns.push({ leagueId: id, pickNumber: n });
    } else {
      dropped++;
    }
  }
  if (dropped > 0) console.error('unclocked_deleted_seat_turns: malformed rows dropped', dropped);
  return { turns, error: dropped > 0 };
}

/**
 * Which listed turns the sweep takes this tick: the list minus any league the overdue pass already
 * has, in a RANDOM order, capped. The shuffle is the liveness guarantee: the list holds every
 * unclocked live draft with a deleted seat ANYWHERE, and most of those rows are a live manager's
 * turn (which never picks, 'seat_live'). Taking a fixed first N would let more than N such leagues
 * crowd out, forever, one that genuinely waits on a deleted seat, and "a player always gets a pick".
 * `rng` is injectable for tests.
 */
export function selectSeatTurns(
  turns: DeletedSeatTurn[],
  skipLeagueIds: Set<string>,
  cap: number,
  rng: () => number = Math.random,
): DeletedSeatTurn[] {
  const pool = turns.filter((t) => !skipLeagueIds.has(t.leagueId));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.max(0, cap));
}

export type DeletedSeatDecision =
  | { kind: 'go'; pickerId: string }
  | { kind: 'skip'; why: 'no_turn' | 'seat_live' | 'seat_read_failed' | AutoPickGate['kind'] };

/**
 * Should the sweep auto-pick this league's current turn BECAUSE its seat is deleted?
 * 'go' only when the picker's seat reads as deleted AND the shared gate then agrees
 * (in_progress, the right pick number, and either unclocked or, for a clocked draft, an
 * expired clock: the gate's own rules, unchanged).
 */
export async function decideDeletedSeatPick(
  state: { picks: PickRow[]; order: string[]; numRounds: number },
  clock: DraftClock,
  readSeat: (userId: string) => Promise<SeatRead>,
): Promise<DeletedSeatDecision> {
  // The context and the clock are two reads. If a pick landed between them, the picker
  // computed from `state` is not the turn the clock (and autoPickTurn) are about.
  if (state.picks.length !== clock.picksMade) return { kind: 'skip', why: 'stale_pick_number' };
  const turn = currentTurn(state.picks.length, state.order, state.numRounds);
  if (!turn) return { kind: 'skip', why: 'no_turn' };
  const seat = await readSeat(turn.pickerId);
  if (seat.error) return { kind: 'skip', why: 'seat_read_failed' };
  if (!seat.deleted) return { kind: 'skip', why: 'seat_live' };
  const gate = decideAutoPickGate(clock.picksMade + 1, clock, { seatDeleted: true });
  return gate.kind === 'go' ? { kind: 'go', pickerId: turn.pickerId } : { kind: 'skip', why: gate.kind };
}
