/**
 * scoreTone: which colour token a side's score takes (B6, Design Lead gate,
 * 2026-10-05). A $0.00 score is neutral (the zero token) whichever side it
 * belongs to. Only a non-zero score takes its side's colour, so an opponent
 * at $0.00 never reads in the opponent's orange.
 */
export type ScoreSide = 'you' | 'opp';
export type ScoreTone = 'zero' | ScoreSide;

export function scoreTone(gain: number, side: ScoreSide): ScoreTone {
  return Math.round(gain * 100) === 0 ? 'zero' : side;
}
