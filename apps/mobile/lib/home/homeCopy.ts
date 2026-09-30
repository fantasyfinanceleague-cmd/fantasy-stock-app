/**
 * Home's visible strings, in one module (Phase 3b-2 spec: "Keep the hero's
 * labels in one string module ... so copy review has one place to look").
 *
 * Every export is tagged with its provenance, for the copy audit in the
 * worker's DONE report:
 *   verbatim-existing  already shipped elsewhere in the app, unchanged.
 *   verbatim-giorgio    Giorgio's own words, from the spec/board, unchanged.
 *   board               the design board's copy (docs/design/screens/), verbatim.
 *   new-flagged         proposed by this worker; the spec says "flag it" —
 *                       these are NOT final until the Design Lead approves.
 */

import { formatSignedCurrency } from '../weekStatus';
import type { PhaseResult } from './homePhase';

// ── D1 hero (Concept A, decided 2026-09-29) — board, verbatim ─────────────
// "+$343.59 · +2.86% season gain · +$121.26 today"
export const HERO_SEASON_GAIN_LABEL = 'season gain'; // board
export const HERO_TODAY_LABEL = 'today'; // board
export const SEASON_CARD_TITLE = 'Season'; // board
export const SEASON_CARD_CAPTION = 'Season gain, week by week'; // board
export const STANDINGS_CARD_TITLE = 'Standings'; // board
/** `throughWeek` is the already-resolved "last completed week" (week - 1
 * for a live week), NOT the league's total week count — code review
 * (2026-09-29) found the caller passing `numWeeks`, so this always read
 * "Through Week 14" regardless of which week was actually live. */
export function standingsThroughWeekCaption(throughWeek: number): string {
  // board: "Through Week N−1"
  return `Through Week ${throughWeek}`;
}

// ── This-week card (state 1/2/3/4) — board, verbatim ───────────────────────
export const THIS_WEEK_TAG = 'This week'; // board
export function thisWeekLiveChip(week: number): string {
  return `Week ${week} · Live`; // board
}
export const YOU_LABEL = 'You'; // board
export function vsOpponentLabel(oppName: string): string {
  return `vs ${oppName}`; // board
}
export function leadLabel(ahead: boolean): string {
  return ahead ? 'You lead by' : 'You trail by'; // board
}
const ET_WEEKDAY_TIME: Intl.DateTimeFormatOptions = {
  timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit',
};

/** "Ends Fri 4:00 PM" from the matchup's real `week_end`, always in ET
 * regardless of the viewer's own timezone (board: "Ends Fri 4:00 PM ET").
 * Fixed in code review (2026-09-29): this used to be a hardcoded literal
 * ("Ends Fri 4:00 PM ET" every week), wrong on any holiday-shifted week. */
export function endsAtLabel(weekEndIso: string): string {
  const d = new Date(weekEndIso);
  if (Number.isNaN(d.getTime())) return '';
  const formatted = new Intl.DateTimeFormat('en-US', ET_WEEKDAY_TIME).format(d);
  return `Ends ${formatted} ET`;
}

// ── State 2: market closed — board, verbatim ────────────────────────────────
export const MARKET_CLOSED_CHIP = 'Market closed'; // board
/** "…at Thursday's close" from the matchup's `week_end` — the last
 * trading day the score is frozen at, in ET (board: "…at Thursday's close"). */
export function marketClosedAt(weekEndIso: string): string {
  const d = new Date(weekEndIso);
  if (Number.isNaN(d.getTime())) return '';
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long' }).format(d);
  return `…at ${weekday}'s close`;
}
/** "Resumes Fri 9:30 AM ET" from market_session_status's own next-open
 * timestamp — never a hardcoded weekday (board: "Resumes Fri 9:30 AM ET"). */
export function marketResumesAt(resumesAtIso: string | null): string {
  if (!resumesAtIso) return '';
  const d = new Date(resumesAtIso);
  if (Number.isNaN(d.getTime())) return '';
  const formatted = new Intl.DateTimeFormat('en-US', ET_WEEKDAY_TIME).format(d);
  return `Resumes ${formatted} ET`;
}

// ── State 3: scoring — board, verbatim ──────────────────────────────────────
export const SCORING_CHIP = 'Scoring…'; // board
export const SCORING_MESSAGE = "Results post a few minutes after Friday's close."; // board

// ── State 4: week final, scored — NOT on the board. new-flagged. ───────────
export const SCORED_CHIP = 'Final'; // new-flagged
export function scoredResultLine(won: boolean, week: number, opponentName?: string): string {
  // spec: "You win Week 6" / "{opponent} wins Week 6" — board copy pattern
  // (onboarding card 3), reused verbatim; the subject swap is new-flagged.
  return won ? `You win Week ${week}` : `${opponentName ?? 'Your opponent'} wins Week ${week}`;
}
/** `when` is the next week's real `week_start` ISO timestamp, or null when
 * it isn't known yet (formats to "" rather than leaking a raw ISO string
 * — fixed in code review, 2026-09-29, which found the raw timestamp
 * reaching the screen: "Week 7 starts 2026-09-28T13:30:00+00:00"). */
export function nextWeekStartsLabel(week: number, when: string | null): string {
  if (!when) return `Week ${week} starts soon`; // new-flagged, mirrors board's "Resumes" pattern
  const d = new Date(when);
  if (Number.isNaN(d.getTime())) return `Week ${week} starts soon`;
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit',
  }).format(d);
  return `Week ${week} starts ${formatted} ET`; // new-flagged, mirrors board's "Resumes" pattern
}

// ── State 5: before the season — board, verbatim ───────────────────────────
export const PRE_SEASON_NO_LEADER = 'No leader yet.'; // board
export const PRE_SEASON_SCORING_STARTS = "Scoring starts at Monday's open."; // board

// ── States 6/7: pre-draft / drafting — board, verbatim where noted ─────────
// Housekeeping (Design Lead, 2026-09-29): these three headings lived as
// literal strings in their own cards instead of here — moved in so the
// module really is the one place for Home's copy, per its own doc above.
export const BEFORE_THE_DRAFT_TITLE = 'Before the draft'; // board
export const DRAFT_IN_PROGRESS_TITLE = 'Draft in progress'; // board
export function pickClockLine(pickSeconds: number, rounds: number): string {
  return `${pickSeconds}-second picks · ${rounds} rounds`; // board ("60-second picks · 6 rounds")
}
export const BUILD_YOUR_QUEUE = 'Build your queue'; // board
export const YOURE_ON_THE_CLOCK = "You're on the clock"; // board
export function onTheClockLine(round: number, pick: number, secondsLeft: number): string {
  const m = Math.floor(secondsLeft / 60);
  const s = secondsLeft % 60;
  return `Round ${round} · Pick ${pick} · ${m}:${String(s).padStart(2, '0')} left`; // board
}
export function upNextLine(round: number, pick: number, picksAway: number): string {
  // spec: "new copy: flag it"
  return `Round ${round} · Pick ${pick} · you're up in ${picksAway} ${picksAway === 1 ? 'pick' : 'picks'}`; // new-flagged
}
export const GO_TO_DRAFT_ROOM = 'Go to the draft room'; // board
export const YOUR_TEAM_SO_FAR = 'Your team so far'; // board

// ── State 9: bye week — NOT on the board. new-flagged. ──────────────────────
export const BYE_MESSAGE = 'No matchup this week'; // new-flagged
/** Same formatting/null-handling as {@link nextWeekStartsLabel} — a bye's
 * `nextStart` is null whenever there's no schedule row after it yet. */
export function byeNextWeekLabel(week: number, when: string | null): string {
  return nextWeekStartsLabel(week, when); // new-flagged (same pattern as scored -> next)
}

// ── State 10: playoffs — NOT on the board. new-flagged. ─────────────────────
export function byeToRoundLabel(round: string | null): string {
  return round ? `Bye to the ${round}` : 'Bye this round'; // new-flagged
}
export function eliminatedLabel(round: string | null): string {
  return round ? `Out in the ${round}` : 'Out of the playoffs'; // new-flagged
}
export const SEE_THE_BRACKET = 'See the bracket'; // new-flagged
export const MISSED_PLAYOFFS_MESSAGE = 'Missed the playoffs'; // new-flagged
/** A current-week playoff row with no opponent yet — the previous round
 * hasn't posted its results (Design Lead ruling, 2026-09-30). NEW COPY,
 * not on the board — flagged for review. */
export function playoffPendingLine(previousRound: string | null): string {
  return `Your opponent is set when the ${previousRound ?? 'previous round'} results post.`; // new-flagged
}

// ── State 8: season complete — mapping rules from the RPC author, relayed
// by the Orchestrator (2026-09-29); render only fields get_season_result
// actually returns. ───────────────────────────────────────────────────────
export const SEASON_COMPLETE_TITLE = 'Season complete'; // board
export function playoffTileLine(
  result: 'champion' | 'runner_up' | 'eliminated' | 'missed' | null,
  exitRoundLabel: string | null,
): string | null {
  switch (result) {
    case 'champion': return 'won the Final';
    case 'runner_up': return 'lost in the Final';
    case 'eliminated': return exitRoundLabel ? `lost in the ${exitRoundLabel}` : null;
    case 'missed': return 'missed the playoffs';
    default: return null; // unknown (standings_only, or absent) — hide the tile, never guess
  }
}
export const REGULAR_SEASON_TILE_TITLE = 'Regular season'; // new-flagged
export const PLAYOFFS_TILE_TITLE = 'Playoffs'; // new-flagged
export const BEST_WEEK_TILE_TITLE = 'Best week'; // new-flagged
export const SEASON_GAIN_TILE_TITLE = 'Season gain'; // board, reused

// ── Money-side helpers (existing formatters live in weekStatus.ts /
// components/sp/logic/money.ts — Home reuses them, does not redefine them). ─
export { formatSignedCurrency };

// ── Hero meta row's week/round segment (Design Lead ruling, 2026-09-30) ────
// "Week N of M" only means something during the regular season. During
// playoffs it's replaced by the round name (e.g. "Semifinals"), and once
// the season is past playing entirely (missed the playoffs, complete) the
// segment is dropped rather than showing a stale or meaningless week
// number ("Week 0 of 14", "Week 15 of 14") -- found in code review,
// 2026-09-30, during the capture pass.
export function heroWeekOrRoundLabel(phase: PhaseResult): string | null {
  switch (phase.kind) {
    case 'pre_season':
      return `Week 1 of ${phase.numWeeks ?? '?'}`;
    case 'bye':
      return `Week ${phase.week} of ${phase.numWeeks ?? '?'}`;
    case 'scoring':
    case 'scored':
    case 'live_open':
    case 'live_closed':
      return phase.isPlayoff ? phase.round : `Week ${phase.week} of ${phase.numWeeks ?? '?'}`;
    case 'playoff_bye':
    case 'playoff_pending':
    case 'eliminated':
      return phase.round;
    default:
      // missed_playoffs, complete: the season is past playing entirely --
      // drop the segment. pre_draft/drafting never reach the hero at all.
      return null;
  }
}

// ── Season chart scrub label (Orchestrator ruling, 2026-09-30) ─────────────
// A 'weekly' point (a past week's single real point, or the Week-1-open
// anchor) is never labelled with a date -- there is no second real point
// nearby to make a date meaningful, only a straight line to it. It reads
// "Week N" plus that WEEK's OWN gain (the delta since the previous real
// point), not the chart's cumulative y-value. A 'daily' point (the live
// week only) keeps a date, formatted rather than a raw ISO string
// (code review, 2026-09-29, found the raw "2026-09-22" reaching the UI).
const SCRUB_DATE_FORMAT: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' };

export function seasonScrubLabel(
  point: { date: string; week: number; gain: number; kind: 'weekly' | 'daily' },
  previousPointGain: number | null,
): { primary: string; money: string } {
  if (point.kind === 'weekly') {
    const delta = point.gain - (previousPointGain ?? 0);
    return { primary: `Week ${point.week}`, money: formatSignedCurrency(delta) };
  }
  const d = new Date(`${point.date}T00:00:00Z`);
  const primary = Number.isNaN(d.getTime()) ? point.date : new Intl.DateTimeFormat('en-US', { ...SCRUB_DATE_FORMAT, timeZone: 'UTC' }).format(d);
  return { primary, money: formatSignedCurrency(point.gain) };
}

// ── Unpriced-symbol captions (Design Lead ruling, 2026-09-29, I12) ─────────
// Reuses plCoverage.ts's `unpricedNote` wording (already approved, already
// on main via fix/mobile-home-pl-partial-basis) rather than authoring new
// copy: "N holding(s) counted at cost (no live price yet)".
import { unpricedNote } from '../plCoverage';

function distinctSymbolCount(...lists: string[][]): number {
  return new Set(lists.flat().map((s) => s.toUpperCase())).size;
}

/** Hero caption: one line under the gain row when the hero's value and/or
 * today segment assumed a cost basis for any symbol. Counts each symbol
 * once even when it appears in both lists (a missing price affects both). */
export function heroUnpricedCaption(unpricedValue: string[], unpricedToday: string[]): string | null {
  return unpricedNote(distinctSymbolCount(unpricedValue, unpricedToday));
}

/** ThisWeekCard caption: "{name}: N holding(s) counted at cost (no live
 * price yet)" for one side. `name` is new-flagged copy (the prefix) — the
 * note itself is not. */
export function sideUnpricedCaption(name: string, unpriced: string[]): string | null {
  const note = unpricedNote(distinctSymbolCount(unpriced));
  return note ? `${name}: ${note}` : null;
}

// ── VoiceOver strings (spec §Accessibility) — new-flagged ──────────────────
/** The hero's WHOLE-element VoiceOver label (Design Lead ruling,
 * 2026-09-29, Blocking 2, code review): the value, the season-gain row,
 * today's segment and the unpriced caption were four separately
 * focusable elements, and RollingMoney renders one Text per character,
 * so VoiceOver could land on a single digit. `todayText`/`caption` are
 * both null when that segment is hidden — the label then simply omits
 * that sentence rather than reading "null" or an empty one. */
export function heroAccessibilityLabel(
  valueText: string,
  gainDollarsText: string,
  gainPctText: string,
  todayText: string | null,
  caption: string | null,
): string {
  const parts = [
    `Your team, ${valueText}.`,
    `${gainDollarsText}, ${gainPctText} ${HERO_SEASON_GAIN_LABEL}.`,
  ];
  if (todayText) parts.push(`${todayText} ${HERO_TODAY_LABEL}.`);
  if (caption) parts.push(caption);
  return parts.join(' ');
}
export function thisWeekAccessibilityLabel(
  week: number,
  isLive: boolean,
  yourScore: string,
  opponentName: string,
  opponentScore: string,
  marginText: string,
  ahead: boolean,
  endsText: string,
): string {
  const liveWord = isLive ? 'live' : 'final';
  return (
    `Week ${week}, ${liveWord}. You ${yourScore}, ${opponentName} ${opponentScore}. ` +
    `${ahead ? 'You lead by' : 'You trail by'} ${marginText}. ${endsText}.`
  );
}
