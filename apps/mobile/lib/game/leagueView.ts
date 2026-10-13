/**
 * League on Game Night (W4, DESIGN_DIRECTION §9C; the board's "League › Standings in full").
 * The pure decisions behind the League tab's rows, so Deno tests them:
 *   - which week the standings are "Through" (it must agree with Home's Standings card);
 *   - when a manager list stacks its rows (name over the numbers), list-wide;
 *   - the stacked row's Dynamic Type cap, so no name, record or tag outgrows the row's
 *     season gain (the checklist's "The standout stays loudest");
 *   - the playoff rounds with the byes as rows of their round (GS-6) and the champion
 *     row under the Final (GS-7);
 *   - whether the segment tabs need to scroll sideways.
 */
import type { SeasonPhase } from '../weekStatus';
import { estimateNameWidth, stackedNameCap, TAB_LABEL_MAX_SCALE, TAB_LABEL_PAD, TAB_MIN } from '../../components/sp/logic/gameNight';
import { isLargeText } from '../../components/sp/logic/largeText';
import { throughWeekShown } from '../home/calmHome';
import { standingsThroughWeekCaption } from '../home/homeCopy';
import type { Bracket, BracketGame, BracketSide } from './bracket';

// ── Copy (Giorgio, 2026-10-13, approved verbatim; PRODUCT_RULES) ──────────────────

export const HISTORY_LOAD_FAILED = "Your league's history didn't load.";
export const BRACKET_LOAD_FAILED = "The bracket didn't load.";

// ── "Through Week N" ─────────────────────────────────────────────────────────────

/** The last COMPLETED week, the way Home's card counts it (homeCopy standingsThroughWeek):
 * week − 1 in the regular season; the whole regular season (numWeeks) once the playoffs
 * start or the season is over; 0 before the first week is done. */
export function leagueThroughWeek(input: { phase: SeasonPhase; week: number | null; numWeeks: number | null }): number {
  const numWeeks = input.numWeeks ?? 0;
  if (input.phase === 'playoffs' || input.phase === 'completed') return numWeeks;
  if (input.phase !== 'regular') return 0;
  const week = input.week ?? 0;
  if (numWeeks > 0 && week > numWeeks) return numWeeks;
  return Math.max(0, week - 1);
}

/** The column head's label: "Through Week N", or null at N = 0 (nothing has been scored,
 * so the label has nothing to name; the checklist's "Labels that can read as nonsense"). */
export function standingsColumnLabel(throughWeek: number): string | null {
  return throughWeekShown(throughWeek) ? standingsThroughWeekCaption(throughWeek) : null;
}

// ── The manager row's one-line layout ────────────────────────────────────────────

/** ManagerRow's fixed parts (ManagerRow.tsx styles): 12pt padding each side, an 8pt gap,
 * the 22pt rank and movement cells, the 32pt avatar. */
export const ROW_PAD = 12;
export const ROW_GAP = 8;
export const RANK_CELL = 22;
export const MOVE_CELL = 22;
export const AVATAR = 32;
/** The season gain's column: never narrower than the board's 86pt. */
export const GAIN_MIN = 86;
/** Below this, the name's column is too narrow to read: the list stacks. */
export const NAME_ROOM_MIN = 64;
/** Name 15 (body), record 13 (callout), gain 15 (score.sm, capped 1.3). */
export const NAME_PT = 15;
export const RECORD_PT = 13;
export const GAIN_PT = 15;
export const GAIN_MAX_SCALE = 1.3;

/** A tabular figure string's width: figures ≈ 0.72em, "," "." ≈ 0.3em (stackedNameCap's estimate). */
export function figureWidth(text: string, pt: number): number {
  let em = 0;
  for (const ch of text) em += ch === ',' || ch === '.' ? 0.3 : 0.72;
  return em * pt;
}

export interface RowFigures {
  record: string;
  gainText: string;
}

/** The name column's width in a one-line row, at this text size. */
export function nameRoom(input: { rowWidth: number; fontScale: number; move: boolean; rows: readonly RowFigures[]; leading?: number }): number {
  const s = Math.max(1, input.fontScale);
  const gainScale = Math.min(s, GAIN_MAX_SCALE);
  const record = Math.max(0, ...input.rows.map((r) => figureWidth(r.record, RECORD_PT * s)));
  const gain = Math.max(GAIN_MIN, ...input.rows.map((r) => figureWidth(r.gainText, GAIN_PT * gainScale)));
  const leading = input.leading ?? RANK_CELL;
  // Cells: rank, [movement], avatar, name, record, gain; a gap between each pair.
  const gaps = (input.move ? 5 : 4) * ROW_GAP;
  return input.rowWidth - ROW_PAD * 2 - gaps - leading - (input.move ? MOVE_CELL : 0) - AVATAR - record - gain;
}

/** One answer for the whole list (so the columns never change shape row to row): stack
 * at the large sizes (isLargeText, the open P2: "names wrap onto two lines") or when the
 * widest record and gain leave the name less than NAME_ROOM_MIN (≥ $1M gains at Large). */
export function managerListStacks(input: { rowWidth: number; fontScale: number; move: boolean; rows: readonly RowFigures[]; leading?: number }): boolean {
  if (isLargeText(input.fontScale)) return true;
  return nameRoom(input) < NAME_ROOM_MIN;
}

/** A stacked row's text cap (name, record, tag, movement): never larger than the row's
 * season gain AS FITTED (a $1M gain shrinks to its line), at most 1.3×, at least 1×. The
 * gain's own line is the row's inner width less the rank, movement and avatar cells. */
export function stackedRowTextCap(input: { gainText: string; fontScale: number; rowWidth: number; move: boolean; leading?: number }): number {
  const leading = input.leading ?? RANK_CELL;
  const inner = input.rowWidth - ROW_PAD * 2 - leading - (input.move ? MOVE_CELL + ROW_GAP : 0) - AVATAR - ROW_GAP * 2;
  const totalPt = GAIN_PT * Math.min(Math.max(1, input.fontScale), GAIN_MAX_SCALE);
  return stackedNameCap({ totalText: input.gainText, totalPt, innerWidth: inner, namePt: NAME_PT });
}

/** Whether a one-line name still fits beside the numbers without a second line. Used by the
 * one-line row to allow a second line rather than an ellipsis ("Gianluigi" / "B." at most). */
export function nameNeedsTwoLines(name: string, room: number, fontScale: number): boolean {
  return estimateNameWidth(name, NAME_PT * Math.max(1, fontScale)) > room;
}

// ── The playoffs (GS-6, GS-7) ────────────────────────────────────────────────────

export type RoundItem =
  | { kind: 'bye'; side: BracketSide; advancesTo: string | null }
  | { kind: 'game'; game: BracketGame };

export interface RoundView {
  round: number;
  label: string;
  items: RoundItem[];
}

/** One heading per round; the first-round byes are rows OF that round, first (top seeds),
 * each saying where it goes ("Advances to the Semifinals", the board's Playoffs6). A round
 * with nothing to show is left out. */
export function bracketRounds(bracket: Bracket): RoundView[] {
  return bracket.rounds
    .map((r, i): RoundView => {
      const byes: RoundItem[] = r.round === 1 ? bracket.byes.map((side) => ({ kind: 'bye', side, advancesTo: bracket.rounds[i + 1]?.label ?? null })) : [];
      const games: RoundItem[] = r.games.map((game) => ({ kind: 'game', game }));
      return { round: r.round, label: r.label, items: [...byes, ...games] };
    })
    .filter((r) => r.items.length > 0);
}

/** The bye row's line: "Advances to the Semifinals" (board), or null with no next round. */
export function advancesLine(next: string | null): string | null {
  return next ? `Advances to the ${next}` : null;
}

/** GS-7: the champion, once the Final (the last round's one game) is scored with a winner. */
export function bracketChampion(bracket: Bracket): BracketSide | null {
  const last = bracket.rounds[bracket.rounds.length - 1];
  if (!last || last.games.length !== 1) return null;
  const final = last.games[0];
  if (!final.scored || !final.winnerUserId) return null;
  const side = [final.a, final.b].find((s) => s?.userId === final.winnerUserId) ?? null;
  return side;
}

/** The champion row's words: "{name} · Champion" (the existing "Champion"; GS-7). */
export function championLine(name: string, champion: string): string {
  return `${name} · ${champion}`;
}

// ── The segment tabs ─────────────────────────────────────────────────────────────

/** A tab's label width at 13pt (the RangePills face), capped at 1.3×; the estimate errs wide. */
export function segmentTabWidth(label: string, fontScale: number): number {
  const s = Math.min(Math.max(1, fontScale), TAB_LABEL_MAX_SCALE);
  return Math.max(TAB_MIN, Math.ceil(estimateNameWidth(label, 13 * s) * 1.08) + TAB_LABEL_PAD);
}

/** The tab row scrolls sideways only when its tabs are wider than the screen's content width
 * (four tabs at XL on the 17e); otherwise it sits still, left-aligned. */
export function segmentTabsScroll(labels: readonly string[], fontScale: number, width: number): boolean {
  const total = labels.reduce((sum, l) => sum + segmentTabWidth(l, fontScale), 0);
  return total > width;
}
