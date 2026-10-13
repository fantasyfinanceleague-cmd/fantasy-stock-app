/**
 * A calm Home (Giorgio, option A, 2026-10-12; PRODUCT_RULES "A calm Home"): the rules
 * the build spec states as rules, pure so they're tested under Deno
 * (tests-deno/home-calm.test.ts). Team value is the ONE standout number; This week and
 * Standings are two quiet cards that open Matchup and League › Standings; sections never
 * touch (24pt between blocks); one primary action per screen.
 */

/** The season chart's PLOT height on Home (Game Night, W4): the W/L marks and the two
 * end dates add their rows under it, so the whole chart is about 142pt, the board's
 * Line(h 142). Never compressed to win back the 17e's fold (the spec's ruling), nor is
 * the 24pt block gap (index.tsx). */
export const HOME_CHART_HEIGHT = 108;

// ── Tap through ────────────────────────────────────────────────────────────
/** This week opens Matchup, in every state the card shows. */
export const THIS_WEEK_HREF = '/(tabs)/matchup' as const;
export const OPENS_MATCHUP_HINT = 'Opens Matchup';
/** Standings opens League on Standings, even if League was left on another segment. */
export const STANDINGS_HREF = { pathname: '/(tabs)/league', params: { segment: 'standings' } } as const;

export type LeagueSegment = 'standings' | 'schedule' | 'playoffs' | 'history';
const LEAGUE_SEGMENTS: readonly LeagueSegment[] = ['standings', 'schedule', 'playoffs', 'history'];

/** League's `?segment=` route param (Home's Standings card sends 'standings'), as
 * Matchup reads 'all'. Anything else, or no param, changes nothing. */
export function leagueSegmentFromParam(param: string | string[] | undefined): LeagueSegment | null {
  const v = Array.isArray(param) ? param[0] : param;
  return (LEAGUE_SEGMENTS as readonly string[]).includes(v ?? '') ? (v as LeagueSegment) : null;
}

// ── Season over: one primary ───────────────────────────────────────────────
/**
 * The season-over screen's one primary: Run it back for the commissioner, the ask for a
 * member of a renewed league, or none. "See the final standings" is a row in the result
 * card, never a filled button, so it never competes with either.
 */
export function seasonOverPrimary(args: { runItBackOn: boolean; isCommissioner: boolean; hasSuccessor: boolean }): 'run_it_back' | 'renewal_ask' | null {
  if (!args.runItBackOn) return null;
  if (args.isCommissioner) return 'run_it_back';
  return args.hasSuccessor ? 'renewal_ask' : null;
}

// ── Before the draft: the draft card's order ───────────────────────────────
export type PreDraftBlock =
  | 'postponedTitle'
  | 'postponedLine'
  | 'noDate'
  | 'roomOpenTag'
  | 'countdown'
  | 'date'
  | 'starting'
  | 'pick'
  | 'pickClock'
  | 'orderSet'
  | 'waiting'
  | 'buttons'
  | 'noBuying';

export interface PreDraftFlags {
  memberPostponed: boolean;
  /** No draft time yet (its block is held back while a renewal's replies are pending). */
  noDate: boolean;
  date: boolean;
  roomOpenTag: boolean;
  countdown: boolean;
  starting: boolean;
  pick: boolean;
  pickClock: boolean;
  orderSet: boolean;
  waiting: boolean;
  buttons: boolean;
}

/**
 * The draft card's blocks, top to bottom (the tag sits above them all). With a draft
 * time, the countdown leads (score.xl, the screen's one big number), then the date,
 * the pick clock, the order line and the button(s). The no-buying line is a caption
 * directly under the button, still hidden while waiting for managers.
 */
export function preDraftBlocks(f: PreDraftFlags): PreDraftBlock[] {
  const out: PreDraftBlock[] = [];
  if (f.memberPostponed) out.push('postponedTitle', 'postponedLine');
  else if (f.noDate) out.push('noDate');
  else {
    if (f.roomOpenTag) out.push('roomOpenTag');
    if (f.countdown) out.push('countdown');
    if (f.date) out.push('date');
    if (f.starting) out.push('starting');
    if (f.pick) out.push('pick');
  }
  if (f.pickClock) out.push('pickClock');
  if (f.orderSet) out.push('orderSet');
  if (f.waiting) out.push('waiting');
  if (f.buttons) out.push('buttons');
  if (f.buttons && !f.waiting) out.push('noBuying');
  return out;
}

/** The draft card's chip: only "Postponed" is left (the "Pre-draft" chip went). */
export function preDraftChipShown(postponed: boolean): boolean {
  return postponed;
}
