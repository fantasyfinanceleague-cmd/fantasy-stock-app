/**
 * The draft room's capture variants (3c-2), pure. EXPO_PUBLIC_DRAFT_ROOM_FIXTURE
 * picks how far the board's draft has gone, so the room's new states can be
 * captured: the on-clock card (the default: 10 picks made, you're on pick 11),
 * the board's "After the pick" card (you took pick 11; Paolo picks 12, then 13),
 * the same after YOUR auto-pick, and the draft's ending (all 36 picks in).
 * 'turn_arrives' is the your-turn signal's capture: the room first reads pick 10
 * (Alessandro's) overdue, its auto-pick backstop asks the seam, and the re-read
 * is 'on_clock', so the turn becomes yours AFTER the first reading (the first
 * reading never fires the signal) the way it does in a real draft.
 * DEV-only: read through the seam, which is off outside a dev build.
 */
export type DraftRoomVariant = 'on_clock' | 'after_pick' | 'after_auto_pick' | 'complete' | 'turn_arrives';

const VARIANTS: readonly DraftRoomVariant[] = ['on_clock', 'after_pick', 'after_auto_pick', 'complete', 'turn_arrives'];

/** The variant after the room's auto-pick backstop reaches the seam: 'turn_arrives'
 * becomes 'on_clock' (Alessandro's overdue pick 10 lands; you're on pick 11). */
export function roomVariantAfterAutoPick(variant: DraftRoomVariant): DraftRoomVariant {
  return variant === 'turn_arrives' ? 'on_clock' : variant;
}

export function parseDraftRoomVariant(raw: string | null | undefined): DraftRoomVariant {
  return raw && (VARIANTS as readonly string[]).includes(raw) ? (raw as DraftRoomVariant) : 'on_clock';
}

interface PickRow {
  pick_number: number;
  symbol: string;
  pick_source: string;
  entry_price?: number;
}

// The board's first picks (Paolo 1, you 2 …); pick 4 is a legacy SKIP row from an old test league.
const FIRST_TEN: PickRow[] = [
  { pick_number: 1, symbol: 'MSFT', pick_source: 'manual', entry_price: 421.0 },
  { pick_number: 2, symbol: 'NVDA', pick_source: 'manual', entry_price: 318.37 },
  { pick_number: 3, symbol: 'META', pick_source: 'manual', entry_price: 508.0 },
  { pick_number: 4, symbol: 'SKIP', pick_source: 'skip' },
  { pick_number: 5, symbol: 'AMZN', pick_source: 'manual', entry_price: 236.4 },
  { pick_number: 6, symbol: 'GOOGL', pick_source: 'manual', entry_price: 166.0 },
  { pick_number: 7, symbol: 'COIN', pick_source: 'manual', entry_price: 210.0 },
  { pick_number: 8, symbol: 'JPM', pick_source: 'manual', entry_price: 215.45 },
  { pick_number: 9, symbol: 'AMD', pick_source: 'manual', entry_price: 160.0 },
  { pick_number: 10, symbol: 'PLTR', pick_source: 'auto_queue', entry_price: 65.0 },
];

// Your seat is 2 of 6: picks 2, 11, 14, 23, 26, 35 (the board's DraftComplete roster).
const YOURS: Record<number, [string, number]> = {
  11: ['AAPL', 211.42], 14: ['CRM', 274.1], 23: ['TSLA', 251.6], 26: ['COST', 912.3], 35: ['V', 291.4],
};
const OTHERS = ['AVGO', 'NFLX', 'ORCL', 'ADBE', 'INTC', 'QCOM', 'TXN', 'IBM', 'UBER', 'SHOP', 'SNOW', 'PYPL', 'DIS', 'NKE', 'SBUX', 'MCD', 'KO', 'PEP', 'WMT', 'HD', 'BAC', 'GS', 'MA', 'UNH', 'LLY'];

/** The drafts rows for a variant. */
export function draftRoomPicks(variant: DraftRoomVariant): PickRow[] {
  if (variant === 'on_clock') return FIRST_TEN;
  if (variant === 'turn_arrives') return FIRST_TEN.slice(0, 9);
  if (variant === 'after_pick' || variant === 'after_auto_pick') {
    return [...FIRST_TEN, { pick_number: 11, symbol: 'AAPL', pick_source: variant === 'after_pick' ? 'manual' : 'auto_queue', entry_price: 211.42 }];
  }
  const rows = [...FIRST_TEN];
  let o = 0;
  for (let n = 11; n <= 36; n++) {
    const mine = YOURS[n];
    rows.push(mine
      ? { pick_number: n, symbol: mine[0], pick_source: 'manual', entry_price: mine[1] }
      : { pick_number: n, symbol: OTHERS[o++], pick_source: 'manual', entry_price: 100 + n });
  }
  return rows;
}

/** get_draft_clock's row for a variant: picks made, and the draft finished for 'complete'. */
export function draftRoomClock(variant: DraftRoomVariant, nowMs: number): Record<string, unknown> {
  const picks = draftRoomPicks(variant).length;
  const done = variant === 'complete';
  const now = new Date(nowMs).toISOString();
  return {
    league_id: 'fixture-draft',
    draft_status: done ? 'completed' : 'in_progress',
    clock_running: !done,
    pick_seconds: 60,
    picks_made: picks,
    turn_started_at: now,
    // 'turn_arrives': pick 10's deadline has just passed (the room's backstop asks for it).
    deadline_at: done ? null : new Date(nowMs + (variant === 'turn_arrives' ? -1_000 : 42_000)).toISOString(),
    server_now: now,
  };
}
