/**
 * C-6 (Design Lead gate, M3, rule 5): every money figure on Portfolio that
 * changes on a quote refresh rolls, matching Home's hero -- not just the
 * header value. PortfolioScreen.tsx is a React Native component and isn't
 * Deno-testable directly; this is a source guard, the established pattern
 * in this suite.
 * Run with: cd apps/mobile/tests-deno && deno test .
 */
import { assertEquals } from 'jsr:@std/assert';
import portfolioScreenSrc from '../components/money/PortfolioScreen.tsx' with { type: 'text' };

Deno.test('wiring: the gain and today lines roll (money and percent, each their own RollingMoney)', () => {
  const rollingMoneyCount = (portfolioScreenSrc.match(/<RollingMoney/g) ?? []).length;
  // valueText, gainMoneyText, gainPctText, todayMoneyText, todayPctText.
  assertEquals(rollingMoneyCount >= 5, true);
  assertEquals(portfolioScreenSrc.includes('v.gainMoneyText'), true);
  assertEquals(portfolioScreenSrc.includes('v.gainPctText'), true);
  assertEquals(portfolioScreenSrc.includes('v.todayMoneyText'), true);
  assertEquals(portfolioScreenSrc.includes('v.todayPctText'), true);
});

Deno.test('wiring: the gain/today rows are each one accessible element, not loose rolling digits', () => {
  assertEquals(portfolioScreenSrc.includes('accessible accessibilityLabel={`${v.gainText}'), true);
  assertEquals(portfolioScreenSrc.includes('accessible accessibilityLabel={`${v.todayText}'), true);
});
