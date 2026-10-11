/**
 * MatchScoreboard's model (3c): the one place a matchup's score row is worked
 * out, for Matchup (hero), All matchups (compact) and the playoff cards. It
 * reuses Home's rules so the two cannot drift: scoreTone for zero, sp's
 * tugRatio/leaderOf for the tug, sp's formatMoney for money (U+2212 minus),
 * and gameCopy for the lead line and the tiebreak.
 */
import { formatMoney } from '../../components/sp/logic/money';
import { leaderOf, tugRatio, type Leader } from '../../components/sp/logic/tug';
import { scoreTone, type ScoreTone } from '../home/scoreTone';
import { COPY, leadLine, tiebreakLine, wonByLine } from './gameCopy';

export interface ScoreboardSide {
  name: string;
  gain: number;
  /** The percent behind the tiebreak. Null when it is not known (a final
   * matchup has no week-end percent on the server row): the tiebreak is then
   * left off, never guessed. */
  pct: number | null;
}

export interface MatchScoreboardInput {
  week: number;
  /** False means the week is FINAL (the result is posted): the lead line then
   * says "won by" / "Tied", never "leads by" (GS-1). Pre-season passes
   * `noLeader`, so it has no lead line either way. */
  live: boolean;
  /** Pre-season and any "no leader yet" state: level tug, no lead, no tiebreak. */
  noLeader?: boolean;
  me: ScoreboardSide;
  /** Null for a bye (no opponent). */
  opp: ScoreboardSide | null;
  /** The spoken "ends" phrase for VoiceOver, e.g. "Ends Friday 4 PM Eastern". */
  endsLabel: string;
}

export interface MatchScoreboardModel {
  mineText: string;
  oppText: string | null;
  mineTone: ScoreTone;
  oppTone: ScoreTone | null;
  tugRatio: number;
  leader: Leader;
  /** "{leader} leads by $X" while live; "{winner} won by $X" or "Tied" once final. */
  leadLine: string | null;
  tiebreakLine: string | null;
  a11yLabel: string;
}

export function buildMatchScoreboardModel(input: MatchScoreboardInput): MatchScoreboardModel {
  const { me, opp, week, live, noLeader, endsLabel } = input;
  const mineText = formatMoney(me.gain, { sign: 'always' });
  const oppText = opp ? formatMoney(opp.gain, { sign: 'always' }) : null;
  const oppGain = opp ? opp.gain : 0;
  const leader: Leader = opp && !noLeader ? leaderOf(me.gain, oppGain) : 'tie';
  const showLead = opp !== null && !noLeader && leader !== 'tie';
  const dollars = Math.abs(me.gain - oppGain);
  const leaderName = leader === 'you' ? me.name : opp?.name ?? '';
  const final = !live;
  let lead: string | null = null;
  if (showLead) lead = final ? wonByLine(leaderName, dollars) : leadLine(leaderName, dollars);
  else if (final && opp !== null && !noLeader) lead = COPY.finalTied; // a finished tie (GS-1)

  let a11yLead = '';
  if (opp && !noLeader) {
    const verb = final
      ? (leader === 'you' ? 'You won' : `${opp.name} won`)
      : (leader === 'you' ? 'You lead' : `${opp.name} leads`);
    a11yLead = leader === 'tie' ? 'Tied.' : `${verb} by ${formatMoney(dollars, {})}.`;
  }
  // Spec wording: "Week 6, live. You +$213.60, Gianluigi B. +$90.44. You lead by …".
  const scores = opp && oppText ? `You ${mineText}, ${opp.name} ${oppText}.` : `You ${mineText}.`;
  const a11yLabel = [`Week ${week}, ${live ? 'live' : 'final'}.`, scores, a11yLead, `${endsLabel}.`]
    .filter((part) => part.length > 0)
    .join(' ');

  return {
    mineText,
    oppText,
    mineTone: scoreTone(me.gain, 'you'),
    oppTone: opp ? scoreTone(opp.gain, 'opp') : null,
    tugRatio: noLeader || !opp ? 0.5 : tugRatio(me.gain, oppGain),
    leader,
    leadLine: lead,
    tiebreakLine: showLead && opp && me.pct !== null && opp.pct !== null ? tiebreakLine(me.pct, opp.pct) : null,
    a11yLabel,
  };
}
