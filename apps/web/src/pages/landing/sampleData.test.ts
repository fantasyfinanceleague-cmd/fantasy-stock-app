import { describe, expect, it } from 'vitest';
import { tugRatio } from '../../design/lib/tugRatio';
import { formatMoney } from '../../design/lib/money';
import {
  BUDGET,
  HERO,
  PORTFOLIO,
  STANDINGS_ROWS,
  STANDINGS_SNAPSHOTS,
  STEPS,
  TICKER,
  WEEK_PANELS,
  WEEK_STATES,
} from './sampleData';
import { stateIndexAt } from './WeekSection';

// Product rules the sample data must obey (phase3a-landing.md, "Product
// facts you must keep"): matchups are won on DOLLAR gain, and with every
// league on the same budget the percent order agrees with the dollar order.

const order = (gains: Record<string, number>) =>
  Object.keys(gains).sort((a, b) => gains[b] - gains[a]);

describe('hero sample', () => {
  it('is the brief’s matchup: You +$56.80 vs Priya +$39.40, lead $17.40, tug 0.59', () => {
    expect(formatMoney(HERO.you.gain, { sign: 'always' })).toBe('+$56.80');
    expect(formatMoney(HERO.opponent.gain, { sign: 'always' })).toBe('+$39.40');
    expect(formatMoney(HERO.you.gain - HERO.opponent.gain)).toBe('$17.40');
    expect(tugRatio(HERO.you.gain, HERO.opponent.gain)).toBeCloseTo(0.59, 2);
    expect(HERO.live.clock).toBe('2d 5h to Friday close');
  });

  it('matches the Wednesday state of the How-a-week-works story', () => {
    const wed = WEEK_STATES.find((s) => s.id === 'wed')!;
    expect([wed.you, wed.opponent]).toEqual([HERO.you.gain, HERO.opponent.gain]);
    expect(wed.chyron).toBe(HERO.chyron);
  });
});

describe('week story', () => {
  it('starts at $0.00 for both sides on Monday’s open', () => {
    const open = WEEK_STATES.find((s) => s.id === 'open')!;
    expect([open.you, open.opponent]).toEqual([0, 0]);
  });

  it('has Priya ahead Monday–Tuesday and you ahead from Wednesday (one lead change back)', () => {
    const lead = (id: string) => {
      const s = WEEK_STATES.find((x) => x.id === id)!;
      return s.you > s.opponent ? 'you' : 'priya';
    };
    expect(['mon', 'tue', 'wed', 'thu', 'fri'].map(lead)).toEqual(['priya', 'priya', 'you', 'you', 'you']);
  });

  it('is won on dollars, and percent (same budget) agrees', () => {
    const fri = WEEK_STATES.find((s) => s.id === 'fri')!;
    expect(fri.you).toBeGreaterThan(fri.opponent);
    expect(fri.you / BUDGET).toBeGreaterThan(fri.opponent / BUDGET);
    expect(WEEK_PANELS.at(-1)!.note).toContain(formatMoney(fri.you - fri.opponent));
  });

  it('has the four sequential steps from the brief', () => {
    expect(STEPS.map((s) => s.title)).toEqual(['Draft', 'Monday open', 'The week', 'Friday close']);
  });

  it('maps scroll progress onto every state in order, ending on Friday', () => {
    const seen: number[] = [];
    for (let p = 0; p <= 1.0001; p += 0.01) seen.push(stateIndexAt(p));
    expect(seen[0]).toBe(0);
    expect(seen.at(-1)).toBe(WEEK_STATES.length - 1);
    expect(new Set(seen).size).toBe(WEEK_STATES.length);
    expect(seen.every((v, i) => i === 0 || v >= seen[i - 1])).toBe(true);
  });
});

describe('standings snapshots', () => {
  it('cover every row', () => {
    for (const snap of STANDINGS_SNAPSHOTS) {
      expect(Object.keys(snap.gains).sort()).toEqual(STANDINGS_ROWS.map((r) => r.id).sort());
    }
  });

  it('change the order by exactly one move per named chyron, and not at all without one', () => {
    STANDINGS_SNAPSHOTS.forEach((snap, i) => {
      const prev = STANDINGS_SNAPSHOTS[(i - 1 + STANDINGS_SNAPSHOTS.length) % STANDINGS_SNAPSHOTS.length];
      const a = order(prev.gains);
      const b = order(snap.gains);
      const moved = a.filter((id, k) => b[k] !== id).length;
      expect(moved).toBe(snap.chyron ? 2 : 0);
    });
  });

  it('first snapshot agrees with the hero (You +$56.80, Priya +$39.40)', () => {
    expect(STANDINGS_SNAPSHOTS[0].gains.you).toBe(HERO.you.gain);
    expect(STANDINGS_SNAPSHOTS[0].gains.priya).toBe(HERO.opponent.gain);
  });
});

describe('portfolio chart', () => {
  it('is cumulative gain from a $0 baseline, ending on week 2 + this week', () => {
    expect(PORTFOLIO.cumulative[0]).toBe(0);
    const end = PORTFOLIO.cumulative.at(-1)!;
    const endOfWeek2 = PORTFOLIO.cumulative[9];
    expect(end - endOfWeek2).toBeCloseTo(PORTFOLIO.weekGain, 6);
    expect(PORTFOLIO.value).toBeCloseTo(BUDGET + end, 6);
    // Week 3's daily points are the week story's closes on top of week 2.
    const week3 = PORTFOLIO.cumulative.slice(10).map((v) => Math.round((v - endOfWeek2) * 100) / 100);
    expect(week3).toEqual(['mon', 'tue', 'wed', 'thu', 'fri'].map((id) => WEEK_STATES.find((s) => s.id === id)!.you));
  });

  it('dips below zero (so both the gain and loss colours are exercised)', () => {
    expect(Math.min(...PORTFOLIO.cumulative)).toBeLessThan(0);
  });
});

describe('ticker', () => {
  it('has no tie (a tie would need the percent tiebreak to name a leader)', () => {
    for (const [a, b] of TICKER) expect(a.gain).not.toBe(b.gain);
  });
});
