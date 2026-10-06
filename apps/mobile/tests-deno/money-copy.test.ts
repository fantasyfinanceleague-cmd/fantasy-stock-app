/**
 * Pins the 3e copy rulings in lib/money/moneyCopy.ts. Run with:
 * cd apps/mobile/tests-deno && deno test .
 *   - D3 closed: no user-visible copy says "skip" (a pick is never unused).
 *   - D4 (A): budget/tier leagues show "Cash from sales" and the header says
 *     "includes cash".
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { COPY } from '../lib/money/moneyCopy.ts';

Deno.test('D3: no user-visible string says "skip"', () => {
  for (const [key, value] of Object.entries(COPY)) {
    const text = typeof value === 'function' ? (value as (...a: string[]) => string)('X', 'Y') : value;
    assert(!/skip/i.test(String(text)), `copy "${key}" says skip: ${text}`);
  }
});

Deno.test('D4 (A): budget leagues show the cash line and the header says includes cash', () => {
  assertEquals(COPY.cashFromSales, 'Cash from sales');
  assertEquals(COPY.portfolioValueIncludesCash, 'Portfolio value · includes cash');
});
