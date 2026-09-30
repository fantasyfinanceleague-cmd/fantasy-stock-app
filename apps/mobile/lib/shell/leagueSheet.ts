// Phase 3b-1 — the league sheet's pure logic: which group a league sits in,
// which PhaseChip it shows, and its "2nd of 6 · 4–1" meta line.
//
// Pure (no React Native imports) so tests-deno can exercise it hermetically.
// The phase itself always comes from the shared getSeasonPhase helper
// (lib/weekStatus.ts, §3 "one league-lifecycle model"); nothing here infers
// a phase on its own.

import type { SeasonPhase } from '../weekStatus';
import { playoffRoundLabelForWeek } from '../playoffs';
import { PHASE_LABELS, phaseChipText, type LeaguePhase } from '../../components/sp/logic/phaseChip';

/** The PhaseChip phases this sheet renders (the shared pure union, minus week_final). */
export type ChipPhase = Exclude<LeaguePhase, 'week_final'>;

export type SheetGroupKey = 'live' | 'upcoming' | 'finished';

export interface SheetLeague {
  id: string;
  name: string;
  seasonPhase: SeasonPhase;
  /** From market_session_status; decides Live vs Closed for a regular-season league. */
  marketOpen: boolean;
  /** league_standings_ranked position for the caller, via get_home_summary; null when unknown. */
  rank: number | null;
  rankCount: number | null;
  wins: number;
  losses: number;
  ties: number;
  /** Rows in league_members; null when the count couldn't be read. */
  membersJoined: number | null;
  capacity: number;
  /** league_seasons.champion_user_id is the caller (never inferred from rank). */
  isChampion: boolean;
  /** The existing getSeasonLabel() text, used verbatim for pre-season ("Starts Tue, Sep 29"). */
  seasonLabel: string;
  /** leagues.current_week / num_weeks / playoff_teams / draft_date, for the chip's label. */
  currentWeek: number;
  numWeeks: number | null;
  playoffTeams: number | null;
  draftDate: string | null;
}

export interface SheetGroup {
  key: SheetGroupKey;
  title: string;
  leagues: SheetLeague[];
}

const GROUP_ORDER: SheetGroupKey[] = ['live', 'upcoming', 'finished'];

const GROUP_TITLE: Record<SheetGroupKey, string> = {
  live: 'Live this week',
  upcoming: 'Upcoming',
  finished: 'Finished',
};

/** A live draft is happening this week, so it groups with the live leagues. */
export function sheetGroupFor(phase: SeasonPhase): SheetGroupKey {
  switch (phase) {
    case 'regular':
    case 'playoffs':
    case 'drafting':
      return 'live';
    case 'pre_draft':
    case 'pre_season':
      return 'upcoming';
    case 'completed':
      return 'finished';
  }
}

export function chipPhaseFor(phase: SeasonPhase, marketOpen: boolean): ChipPhase {
  switch (phase) {
    case 'regular':
      return marketOpen ? 'live_open' : 'live_closed';
    case 'completed':
      return 'season_complete';
    default:
      return phase;
  }
}

/** Live leagues first, then upcoming, then finished; empty groups omitted; input order kept. */
export function groupLeagues(leagues: SheetLeague[]): SheetGroup[] {
  return GROUP_ORDER.map((key) => ({
    key,
    title: GROUP_TITLE[key],
    leagues: leagues.filter((l) => sheetGroupFor(l.seasonPhase) === key),
  })).filter((g) => g.leagues.length > 0);
}

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** numeric(5,1) columns can arrive as strings ("4.0") from PostgREST. */
function count(value: number | string): string {
  const n = Number(value);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** "4–1", or "4–1–1" only when there are ties. A bye is no result, so it never appears here. */
export function formatRecord(wins: number, losses: number, ties: number): string {
  const base = `${count(wins)}–${count(losses)}`;
  return Number(ties) > 0 ? `${base}–${count(ties)}` : base;
}

/** The row's second line. Returns '' rather than inventing a rank or a count it doesn't have. */
export function formatLeagueMeta(l: SheetLeague): string {
  switch (l.seasonPhase) {
    case 'pre_draft':
    case 'drafting':
      return l.membersJoined === null ? '' : `${l.membersJoined} of ${l.capacity} joined`;
    case 'pre_season':
      return l.seasonLabel;
    default: {
      if (l.rank === null || l.rankCount === null) return '';
      const standing = `${ordinal(l.rank)} of ${l.rankCount} · ${formatRecord(l.wins, l.losses, l.ties)}`;
      return l.seasonPhase === 'completed' && l.isChampion ? `Champion · ${standing}` : standing;
    }
  }
}

/** "Sat 7:00 PM" in US Eastern time (the market's clock), whatever the phone's zone. */
function easternDayTime(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  })
    .format(d)
    .replace(/[\u202f\u00a0]/g, ' ') // ICU puts a narrow no-break space before AM/PM
    .replace(',', '');
}

/** The specific label, when the league has one (undefined otherwise). */
function specificChipLabel(l: SheetLeague): string | undefined {
  switch (l.seasonPhase) {
    case 'regular':
      return l.currentWeek > 0 ? `Week ${l.currentWeek}` : undefined;
    case 'playoffs':
      return playoffRoundLabelForWeek(l.currentWeek, l.numWeeks, l.playoffTeams) ?? undefined;
    case 'pre_draft': {
      const when = l.draftDate ? easternDayTime(l.draftDate) : null;
      return when ? `Draft ${when} ET` : undefined;
    }
    case 'completed':
      return 'Final';
    default:
      return undefined;
  }
}

/**
 * The PhaseChip's text for a league row / header (Design Lead ruling): the
 * phase keeps deciding the chip's style; this only names it better.
 *   live → "Week 6" · playoffs → the round ("Semifinals", from lib/playoffs)
 *   pre-draft with a date → "Draft Sat 7:00 PM ET" · finished → "Final"
 * Anything else ("Drafting", "Pre-draft" with no date, a playoff week with
 * no round) gets the phase's own name — always passed as a label, so every
 * shell chip is sentence case; the ALL-CAPS default is for game surfaces.
 */
export function chipLabelFor(l: SheetLeague): string {
  return specificChipLabel(l) ?? PHASE_LABELS[chipPhaseFor(l.seasonPhase, l.marketOpen)];
}

function plural(n: number, one: string, many: string): string {
  return `${count(n)} ${n === 1 ? one : many}`;
}

/** Spec a11y: "sheet rows announce name, rank, record and phase" — record in words, not "4–1". */
export function accessibleLeagueRow(l: SheetLeague, selected: boolean): string {
  const parts = [l.name];
  const ranked = l.seasonPhase !== 'pre_draft' && l.seasonPhase !== 'drafting' && l.seasonPhase !== 'pre_season';
  if (ranked && l.rank !== null && l.rankCount !== null) {
    if (l.seasonPhase === 'completed' && l.isChampion) parts.push('Champion');
    parts.push(`${ordinal(l.rank)} of ${l.rankCount}`);
    parts.push(plural(Number(l.wins), 'win', 'wins'), plural(Number(l.losses), 'loss', 'losses'));
    if (Number(l.ties) > 0) parts.push(plural(Number(l.ties), 'tie', 'ties'));
  } else {
    const meta = formatLeagueMeta(l);
    if (meta) parts.push(meta);
  }
  parts.push(phaseChipText(chipPhaseFor(l.seasonPhase, l.marketOpen), chipLabelFor(l)));
  if (selected) parts.push('selected');
  return parts.join(', ');
}

/** The pill's "+N" hint: how many OTHER leagues the sheet holds (hidden at 0). */
export function moreLeaguesCount(totalLeagues: number): number {
  return Math.max(0, totalLeagues - 1);
}

/** Spec a11y: the pill announces "{league}, {N} more leagues, button" (the role adds "button"). */
export function pillAccessibilityLabel(name: string, more: number): string {
  if (more <= 0) return name;
  return `${name}, ${more} more ${more === 1 ? 'league' : 'leagues'}`;
}
