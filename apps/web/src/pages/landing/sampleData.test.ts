// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { formatMoney } from '../../design/lib/money';
import {
  BOARD_FRAMES,
  CLIMB_FRAMES,
  DAILY_MOVES,
  DRAFT_PICKS,
  MATCHUP_FRAMES,
  MOVERS_FRAMES,
  PLAYERS,
  PORTFOLIO_FRAMES,
  TAPE,
  WEEK_CLOSES,
  boardMoves,
  boardRanked,
  moversRanked,
} from './sampleData';

// The mock data is the live landing page's own (Stock Scudetto, Week 6),
// extended into animation frames. These pin the parts that must stay true.

describe('reused from the live page, verbatim', () => {
  it('tape: the same 12 symbols and prices', () => {
    expect(TAPE.map((t) => `${t.t} ${t.p} ${t.d}`)).toEqual([
      'NVDA 318.37 +3.81%', 'AAPL 211.42 +1.24%', 'MSFT 421.62 +0.88%', 'TSLA 248.36 −0.52%',
      'GOOGL 179.01 +0.41%', 'META 498.50 +1.92%', 'AMZN 236.40 −1.18%', 'AMD 172.95 −0.31%',
      'AVGO 1124.20 +0.84%', 'COIN 212.07 +2.04%', 'PLTR 34.18 +5.12%', 'JPM 215.45 +0.22%',
    ]);
  });

  it('portfolio card first frame: $12,430.55, ▲ $284.10 · +2.34%, NVDA/AAPL/TSLA', () => {
    const f = PORTFOLIO_FRAMES[0];
    expect(formatMoney(f.value)).toBe('$12,430.55');
    expect(formatMoney(f.today)).toBe('$284.10');
    expect(f.todayPct).toBe(2.34);
    expect(f.holdings.map((h) => `${h.t} ${h.sh} ${formatMoney(h.value)} ${h.pct}`)).toEqual([
      'NVDA 12 $3,820.40 3.81', 'AAPL 10 $2,114.22 1.24', 'TSLA 6 $1,490.18 -0.52',
    ]);
  });

  it('matchup first frame: Roberto +2.34% vs Gianluigi −0.91%', () => {
    expect([MATCHUP_FRAMES[0].youPct, MATCHUP_FRAMES[0].oppPct]).toEqual([2.34, -0.91]);
  });

  it('movers first frame: the old list', () => {
    expect(MOVERS_FRAMES[0].map((m) => `${m.t} ${m.pct}`)).toEqual(['NVDA 3.81', 'PLTR 5.12', 'META 1.92', 'TSLA -0.52', 'AMZN -1.18']);
  });

  it('standings first frame: the old board, same order, records and percentages', () => {
    expect(boardRanked(0).map((r) => `${r.rank} ${r.name} ${r.rec} ${r.pct}`)).toEqual([
      '1 Paolo M. 5–0 8.42', '2 Roberto B. 4–1 5.1', '3 Alessandro D. 4–1 4.88',
      '4 Francesco T. 3–2 2.31', '5 Gianluigi B. 2–3 -1.04', '6 Andrea P. 1–4 -2.88',
    ]);
  });
});

describe('no win probability, and the matchup lead is in dollars', () => {
  it('the sample data never mentions a probability', () => {
    const src = readFileSync(fileURLToPath(new URL('./sampleData.ts', import.meta.url)), 'utf-8');
    expect(src.replace(/\/\/.*$/gm, '')).not.toMatch(/prob|odds|chance/i);
  });

  it('every matchup frame has a dollar leader', () => {
    for (const f of MATCHUP_FRAMES) expect(f.you).not.toBe(f.opp);
  });

  it('the week story is won on dollars by the dollar leader at Friday close', () => {
    const fri = WEEK_CLOSES[WEEK_CLOSES.length - 1];
    expect(fri.day).toBe('Fri');
    expect(fri.you).toBeGreaterThan(fri.opp);
    expect(WEEK_CLOSES[0]).toMatchObject({ you: 0, opp: 0 });
  });
});

describe('live frames are consistent', () => {
  it('the movers card re-ranks by percent each frame', () => {
    for (let f = 0; f < MOVERS_FRAMES.length; f++) {
      const r = moversRanked(f).map((m) => m.pct);
      expect([...r].sort((a, b) => b - a)).toEqual(r);
    }
  });

  it('each board frame covers every player', () => {
    for (const f of BOARD_FRAMES) {
      expect(Object.keys(f.pct).sort()).toEqual(PLAYERS.map((p) => p.id).sort());
      expect(Object.keys(f.rec).sort()).toEqual(PLAYERS.map((p) => p.id).sort());
    }
  });

  it('a board frame names a move exactly when the order changes', () => {
    BOARD_FRAMES.forEach((f, i) => {
      if (i === 0) return;
      const moved = Object.keys(boardMoves(i)).length;
      expect(moved > 0).toBe(Boolean(f.chyron));
    });
  });

  it('the FINAL frame is last, and records move by exactly one game: three wins, three losses', () => {
    const last = BOARD_FRAMES[BOARD_FRAMES.length - 1];
    expect(last.final).toBe(true);
    const before = BOARD_FRAMES[BOARD_FRAMES.length - 2].rec;
    const games = (r: string) => r.split('–').map(Number);
    let wins = 0;
    let losses = 0;
    for (const id of Object.keys(before)) {
      const [w0, l0] = games(before[id]);
      const [w1, l1] = games(last.rec[id]);
      expect(w1 + l1).toBe(w0 + l0 + 1);
      if (w1 > w0) wins++;
      else losses++;
    }
    expect([wins, losses]).toEqual([3, 3]);
  });

  it('the FINAL puts Roberto B. (you) in 1st', () => {
    expect(boardRanked(BOARD_FRAMES.length - 1)[0].id).toBe('roberto');
  });

  it('the draft is a true snake: round 2 runs in reverse order', () => {
    const r1 = DRAFT_PICKS.slice(0, 6).map((p) => p.player);
    const r2 = DRAFT_PICKS.slice(6).map((p) => p.player);
    expect(r2).toEqual([...r1].reverse());
    expect(new Set(DRAFT_PICKS.map((p) => p.t)).size).toBe(DRAFT_PICKS.length);
  });

  it('the climb: Roberto from 4th to 2nd, one more game played by everyone', () => {
    expect(CLIMB_FRAMES[0].findIndex((r) => r.you)).toBe(3);
    expect(CLIMB_FRAMES[1].findIndex((r) => r.you)).toBe(1);
  });

  it('the "Real prices" bars are signed daily dollar moves summing to the week', () => {
    expect(DAILY_MOVES.map((d) => d.l)).toEqual(['M', 'T', 'W', 'T', 'F']);
    expect(DAILY_MOVES.some((d) => d.v < 0)).toBe(true);
    expect(formatMoney(DAILY_MOVES.reduce((a, d) => a + d.v, 0), { sign: 'always' })).toBe('+$512.40');
  });
});
