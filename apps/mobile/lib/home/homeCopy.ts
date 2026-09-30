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

// ── D1 hero (Concept A, decided 2026-09-29) — board, verbatim ─────────────
// "+$343.59 · +2.86% season gain · +$121.26 today"
export const HERO_SEASON_GAIN_LABEL = 'season gain'; // board
export const HERO_TODAY_LABEL = 'today'; // board
export const SEASON_CARD_TITLE = 'Season'; // board
export const SEASON_CARD_CAPTION = 'Season gain, week by week'; // board
export const STANDINGS_CARD_TITLE = 'Standings'; // board
export function standingsThroughWeekCaption(numWeeks: number): string {
  // board: "Through Week N−1"
  return `Through Week ${numWeeks}`;
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
export const ENDS_FRIDAY_LABEL = 'Ends Fri 4:00 PM ET'; // board (literal week-end time varies by row; formatted from matchup.week_end)

// ── State 2: market closed — board, verbatim ────────────────────────────────
export const MARKET_CLOSED_CHIP = 'Market closed'; // board
export function marketClosedAt(when: string): string {
  return `…at ${when}'s close`; // board ("…at Thursday's close")
}
export function marketResumesAt(when: string): string {
  return `Resumes ${when}`; // board ("Resumes Fri 9:30 AM ET")
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
export function nextWeekStartsLabel(week: number, when: string): string {
  return `Week ${week} starts ${when}`; // new-flagged, mirrors board's "Resumes" pattern
}

// ── State 5: before the season — board, verbatim ───────────────────────────
export const PRE_SEASON_NO_LEADER = 'No leader yet.'; // board
export const PRE_SEASON_SCORING_STARTS = "Scoring starts at Monday's open."; // board

// ── States 6/7: pre-draft / drafting — board, verbatim where noted ─────────
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
export function byeNextWeekLabel(week: number, when: string): string {
  return `Week ${week} starts ${when}`; // new-flagged (same pattern as scored → next)
}

// ── State 10: playoffs — NOT on the board. new-flagged. ─────────────────────
export function byeToRoundLabel(round: string): string {
  return `Bye to the ${round}`; // new-flagged
}
export function eliminatedLabel(round: string): string {
  return `Out in the ${round}`; // new-flagged
}
export const SEE_THE_BRACKET = 'See the bracket'; // new-flagged

// ── State 8: season complete — mapping rules from the RPC author, relayed
// by the Orchestrator (2026-09-29); render only fields get_season_result
// actually returns. ───────────────────────────────────────────────────────
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
export { formatSignedCurrency } from '../weekStatus';

// ── VoiceOver strings (spec §Accessibility) — new-flagged ──────────────────
export function heroAccessibilityLabel(valueText: string, gainText: string, gainLabel: string): string {
  return `Your team, ${valueText}, ${gainText} ${gainLabel}`;
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
