/**
 * The week's ending band on Matchup (G3; its look restored by the game-screens gate,
 * GS-2). The board's `.ks-winner`: "Roberto B. wins Week 6" on the left, the record on
 * the right ("W · 5–1"). Pure, so tests-deno can check the words and the outcome that
 * picks the band's fill (your colour when you won, neutral when you lost or tied).
 */
import { formatRecord } from '../shell/leagueSheet';

export type FinalOutcome = 'won' | 'lost' | 'tied';

export interface FinalBannerInput {
  week: number;
  /** The two posted gains: dollars decide, as everywhere. */
  me: number;
  opp: number;
  youName: string;
  oppName: string;
  /** Your record with this week counted; null when it isn't known. */
  record: { wins: number; losses: number; ties: number } | null;
  /** A playoff game: the standings record is the regular season's, so only the letter shows. */
  isPlayoff: boolean;
}

export interface FinalBannerModel {
  outcome: FinalOutcome;
  /** "Roberto B. wins Week 6" / "Tied in Week 6". */
  text: string;
  /** "W · 5–1" (board), or the bare letter when no record applies. */
  recordText: string;
  a11yLabel: string;
}

const LETTER: Record<FinalOutcome, string> = { won: 'W', lost: 'L', tied: 'T' };
const SPOKEN: Record<FinalOutcome, string> = { won: 'Win', lost: 'Loss', tied: 'Tie' };

export function buildFinalBanner(input: FinalBannerInput): FinalBannerModel {
  const { week, me, opp, youName, oppName, record, isPlayoff } = input;
  const outcome: FinalOutcome = me === opp ? 'tied' : me > opp ? 'won' : 'lost';
  const text = outcome === 'tied' ? `Tied in Week ${week}` : `${outcome === 'won' ? youName : oppName} wins Week ${week}`;
  const recordPart = record && !isPlayoff ? formatRecord(record.wins, record.losses, record.ties) : null;
  return {
    outcome,
    text,
    recordText: recordPart ? `${LETTER[outcome]} · ${recordPart}` : LETTER[outcome],
    a11yLabel: recordPart ? `${text}. ${SPOKEN[outcome]}, record ${recordPart}.` : `${text}. ${SPOKEN[outcome]}.`,
  };
}
