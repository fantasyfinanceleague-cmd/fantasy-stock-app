/**
 * draftBoardLayout (W4 Draft, Game Night §9C): the board laid out by COLUMN (one per manager,
 * the snake's seats), so your column can sit on one `youTint` slab from its header to its last
 * round (shading B: "it's you … Not whoever's winning"; the Matchup roster column's treatment).
 *
 * Six tiles share a phone's width (the board's frame). A bigger league doesn't squeeze its
 * tiles until the ticker no longer fits: past the floor the board keeps the floor and scrolls
 * sideways, and it opens on the pick that's on the clock. Pure, so tests-deno pins it.
 */
import { boardRows, type BoardCell } from './draftBoard';

/** The space between tiles, both ways (the board's `gap: 4`). */
export const BOARD_GAP = 4;
/** Each column's inset around its tiles: half the gap, so neighbouring tiles sit BOARD_GAP
 * apart and your slab shows 2pt around your tiles. */
export const COLUMN_PAD = BOARD_GAP / 2;
/** The narrowest tile that holds a five-letter ticker (GOOGL) at 13/800 with its 6pt sides,
 * at 1×. It grows with Dynamic Type up to the tile's own cap (DraftTile's 1.2×). */
export const TILE_MIN = 54;
export const TILE_MAX_SCALE = 1.2;

export interface BoardLayout {
  /** One column's width: the tile plus its two COLUMN_PADs. */
  columnWidth: number;
  tileWidth: number;
  /** All the columns side by side. */
  contentWidth: number;
  /** The columns don't fit the width at the floor: the board scrolls sideways. */
  scrolls: boolean;
}

/** `available` is the width the columns may fill, their outer pads included. */
export function boardLayout(opts: { columns: number; available: number; fontScale: number }): BoardLayout {
  const n = Math.max(1, Math.floor(opts.columns));
  const floor = TILE_MIN * Math.min(Math.max(opts.fontScale, 1), TILE_MAX_SCALE);
  const fit = opts.available / n - 2 * COLUMN_PAD;
  const tileWidth = fit >= floor ? fit : floor;
  const columnWidth = tileWidth + 2 * COLUMN_PAD;
  return { columnWidth, tileWidth, contentWidth: columnWidth * n, scrolls: fit < floor };
}

/** Every tile's height, the same in every column, so the rounds line up across columns that
 * lay out on their own (an empty tile has no ticker line to grow). 44pt at 1× (the board's,
 * and the target floor); at larger text, the two 16pt lines at the tile's cap plus its pads
 * (4 over, 4 + the 3pt line under). */
export const TILE_HEIGHT = 44;
export function tileHeight(fontScale: number): number {
  const s = Math.min(Math.max(fontScale, 1), TILE_MAX_SCALE);
  return Math.max(TILE_HEIGHT, Math.ceil(2 * 16 * s + 4 + 4 + 3));
}

/** The board's columns: cells[i] is seat i's pick in each round, top to bottom. */
export function boardColumns(
  order: string[],
  rounds: number,
  picks: Map<number, { symbol: string; source: string }>,
  onClockPick: number,
): BoardCell[][] {
  const rows = boardRows(order, rounds, picks, onClockPick);
  return order.map((_, i) => rows.map((row) => row[i]));
}

/** Where a scrolling board opens: the column on the clock in view, centred where it can be,
 * never past either end. A board that fits never scrolls (0). */
export function scrollXForColumn(column: number, layout: BoardLayout, viewport: number): number {
  if (!layout.scrolls || column < 0) return 0;
  const centre = column * layout.columnWidth + layout.columnWidth / 2 - viewport / 2;
  return Math.max(0, Math.min(centre, layout.contentWidth - viewport));
}

/** The column header's name: the first name, as the board draws it ("Paolo"). */
export function boardFirstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}
