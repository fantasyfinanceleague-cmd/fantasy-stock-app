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
import { estimateNameWidth } from '../../components/sp/logic/gameNight';

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

/** The column header's name: the first name, as the board draws it ("Paolo"). */
export function boardFirstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}

/** The header's first name: the board frame's 11pt, growing with Dynamic Type to the tile's cap. */
export const HEADER_NAME_PT = 11;

/** The widest header name's width at its full size (`estimateNameWidth`, conservative: bold
 * Archivo, so a medium-weight name always fits where the estimate does). */
export function headerNameWidth(names: readonly string[], fontScale: number): number {
  const pt = HEADER_NAME_PT * Math.min(Math.max(fontScale, 1), TILE_MAX_SCALE);
  return names.reduce((w, n) => Math.max(w, estimateNameWidth(boardFirstName(n), pt)), 0);
}

/** A header name's size in its column: its full size when it fits, else shrunk to fit, but
 * never under 11pt (past that the ellipsis takes it). Computed here because iOS's
 * adjustsFontSizeToFit goes BELOW minimumFontScale when the text still doesn't fit
 * (gameNight.ts, stackedNameCap), so it can't hold a floor. */
export function headerNamePt(name: string, columnWidth: number, fontScale: number): number {
  const full = HEADER_NAME_PT * Math.min(Math.max(fontScale, 1), TILE_MAX_SCALE);
  const w = estimateNameWidth(boardFirstName(name), full);
  if (w <= columnWidth || w === 0) return full;
  return Math.max(HEADER_NAME_PT, full * (columnWidth / w));
}

/** `available` is the width the columns may fill, their outer pads included. `nameWidth`
 * (headerNameWidth): a board that scrolls anyway widens its columns to its widest first name,
 * so no header is cut ("Robertino", not "Robert…"); a board that fits keeps its width and
 * lets a long name shrink (to 11pt) and then ellipsize. */
export function boardLayout(opts: { columns: number; available: number; fontScale: number; nameWidth?: number }): BoardLayout {
  const n = Math.max(1, Math.floor(opts.columns));
  const floor = TILE_MIN * Math.min(Math.max(opts.fontScale, 1), TILE_MAX_SCALE);
  const fit = opts.available / n - 2 * COLUMN_PAD;
  const named = Math.max(floor, (opts.nameWidth ?? 0) - 2 * COLUMN_PAD);
  const tileWidth = fit >= floor ? fit : named;
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
