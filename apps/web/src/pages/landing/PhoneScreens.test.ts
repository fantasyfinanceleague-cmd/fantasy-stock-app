import { describe, expect, it } from 'vitest';
import { PHONE_SCORES, SCORE_EM_PER_CHAR, SCORE_ROW, SCORE_ROW_PX, fitScoreSize } from './PhoneScreens';

// Design Lead A.3a: the two scores on a phone screen never touch — a gap of
// at least 16px at the widest pair the data ever shows, both at one size.

describe('ScoreRow sizing', () => {
  it('fits the widest pair in the data with a ≥16px gap', () => {
    const widest = Math.max(...PHONE_SCORES.map((s) => s.length));
    const each = widest * SCORE_EM_PER_CHAR * SCORE_ROW_PX;
    expect(SCORE_ROW.gapPx).toBeGreaterThanOrEqual(16);
    expect(2 * each + SCORE_ROW.gapPx).toBeLessThanOrEqual(SCORE_ROW.contentPx);
  });

  it('stays a headline size (≥ 28px), never the old 40px that collided', () => {
    expect(SCORE_ROW_PX).toBeGreaterThanOrEqual(28);
    expect(SCORE_ROW_PX).toBeLessThan(40);
  });

  it('shrinks for wider values and caps at the row max', () => {
    expect(fitScoreSize(['+$1,351.80'])).toBeLessThan(fitScoreSize(['+$351.80']));
    expect(fitScoreSize(['$0'])).toBe(SCORE_ROW.maxPx);
  });
});
