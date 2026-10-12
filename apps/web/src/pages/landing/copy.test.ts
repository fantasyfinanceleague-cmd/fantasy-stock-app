// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { how, why, hero, leagues, faq, footer, cta } from './copy';

// Giorgio (2026-09-27): the live page's copy verbatim, with ONLY these
// changes — performance (not "return") wording, and "Real" (not
// "Real-time") market data. These pin the changed sentences exactly.

const src = readFileSync(fileURLToPath(new URL('./copy.ts', import.meta.url)), 'utf-8');
const code = src.replace(/\/\/.*$/gm, '');

describe('Giorgio’s wording decisions', () => {
  it('"Best performance wins the matchup."', () => {
    expect(how.steps[1].body).toBe(
      'Monday to Friday, your portfolio runs head-to-head against an opponent. Best performance wins the matchup.'
    );
  });

  it('"your score is your portfolio’s actual performance"', () => {
    expect(how.lede).toBe(
      'Three steps. No fantasy points, no proxies — your score is your portfolio’s actual performance, pulled from real market data every weekday.'
    );
  });

  it('"Every score is your portfolio’s real performance"', () => {
    expect(why.cells[0].body).toBe(
      'Every score is your portfolio’s real performance — pulled from live market data. No fantasy points, no proxies. If your picks go up, you win.'
    );
  });

  it('"Real market data" (was "Real-time market data")', () => {
    expect(hero.meta[2]).toEqual({ strong: 'Real', rest: ' market data' });
  });

  it('no "return" or "real-time" claim is left anywhere in the copy', () => {
    expect(code).not.toMatch(/\breturns?\b/i);
    expect(code).not.toMatch(/real-?time/i);
  });

  it('kept verbatim: "Live prices stream from the open to the close" and the delayed-data disclaimer', () => {
    expect(leagues.bullets[0]).toBe('Live prices stream from the open to the close');
    expect(footer.disclaimer('X')).toBe('X is for entertainment purposes only. Not investment advice. Market data delayed.');
  });
});

describe('verbatim anchors from the live page', () => {
  it('hero, CTA and FAQ', () => {
    expect(hero.lines).toEqual(['Draft stocks.', 'Beat your friends.', 'Win the league.']);
    expect(hero.lede('X')).toBe(
      'X is fantasy sports for the stock market. Build a portfolio, go head-to-head with friends, and prove who really knows the market.'
    );
    expect(cta.body('X')).toBe('X is almost ready. The first opening bell is just around the corner.');
    expect(faq.items('X').map((i) => i.q)).toEqual([
      'When does X launch?', 'How do I get access?', 'Is this real investing?', 'Does it cost anything?', 'Do I win money?',
    ]);
  });

  it('section numbering', () => {
    expect([how.kicker, leagues.kicker, why.kicker('X'), faq.kicker]).toEqual([
      '/ 01 — How it works', '/ 02 — Leagues in action', '/ 03 — Why X', '/ 04 — FAQ',
    ]);
  });

  it('the product name is never spelled out (brand.name only)', () => {
    expect(code).not.toMatch(/Stockpile/);
  });
});
