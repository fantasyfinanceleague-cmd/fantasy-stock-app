/**
 * C-9 (Design Lead gate, confirmed as defect fixes against Giorgio-approved
 * board frames, not new design): the "Buy a stock" row's icon tile + accent
 * title, the search screen's page-title size, and the stock sheet's × close
 * icon. All three components are React Native (JSX, some Reanimated) and
 * aren't Deno-testable directly; these are source guards, the established
 * pattern in this suite (e.g. C-1's quiet-wiring test, C-2's ownership-row
 * wiring tests).
 * Run with: cd apps/mobile/tests-deno && deno test .
 */
import { assertEquals } from 'jsr:@std/assert';
import portfolioScreenSrc from '../components/money/PortfolioScreen.tsx' with { type: 'text' };
import stockSearchScreenSrc from '../components/money/StockSearchScreen.tsx' with { type: 'text' };
import stockSheetBodySrc from '../components/money/StockSheetBody.tsx' with { type: 'text' };

Deno.test('wiring: the Buy a stock row has a search-icon tile in accent-tint, board #buy-a-stock', () => {
  assertEquals(portfolioScreenSrc.includes('name="search"'), true);
  assertEquals(portfolioScreenSrc.includes('colors.accentTint'), true);
});

Deno.test('wiring: the Buy a stock row title is in the accent colour, not the plain primary tone', () => {
  assertEquals(portfolioScreenSrc.includes('color={colors.accent}'), true);
});

Deno.test("wiring: the search screen's title uses the board's page-title size, not headline", () => {
  assertEquals(stockSearchScreenSrc.includes('variant="title">{COPY.stockSearchTitle}'), true);
  assertEquals(stockSearchScreenSrc.includes('variant="headline">{COPY.stockSearchTitle}'), false);
});

Deno.test("wiring: the stock sheet closes with the × icon, not \"Done\" text, key screen 5", () => {
  assertEquals(stockSheetBodySrc.includes('<Icon name="close" size="body" tone="text2" />'), true);
  assertEquals(stockSheetBodySrc.includes('>Done</Text>'), false);
  assertEquals(stockSheetBodySrc.includes('accessibilityLabel="Close"'), true);
});
